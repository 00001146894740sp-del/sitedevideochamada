// Serviço de mensagens: criação, serialização em lote e eventos em tempo real
const db = require('./db');
const hub = require('./hub');
const { publicUser, fileUrl } = require('./util');
const { getPreview, firstUrl } = require('./linkpreview');
const { notify, awardBadge } = require('./notify');

async function serializeMessages(rows, viewerId) {
  if (!rows.length) return [];
  const ids = rows.map(m => m.id);
  const senderIds = [...new Set(rows.map(m => m.sender_id).filter(Boolean))];
  const replyIds = [...new Set(rows.map(m => m.reply_to_id).filter(Boolean))];
  const [senders, atts, reacts, pins, favs, replies] = await Promise.all([
    db.many('SELECT * FROM users WHERE id = ANY($1)', [senderIds]),
    db.many(`SELECT a.message_id, f.id, f.filename, f.mime, f.size, f.kind FROM message_attachments a JOIN files f ON f.id=a.file_id
             WHERE a.message_id = ANY($1) AND f.deleted_at IS NULL ORDER BY a.position`, [ids]),
    db.many(`SELECT message_id, emoji, count(*)::int AS n, bool_or(user_id=$2) AS me, array_agg(user_id ORDER BY created_at) AS users
             FROM message_reactions WHERE message_id = ANY($1) GROUP BY message_id, emoji ORDER BY min(created_at)`, [ids, viewerId]),
    db.many('SELECT message_id FROM message_pins WHERE message_id = ANY($1)', [ids]),
    db.many('SELECT message_id FROM message_favorites WHERE user_id=$2 AND message_id = ANY($1)', [ids, viewerId]),
    replyIds.length ? db.many(`SELECT m.id, m.content, m.type, m.deleted_at, m.sender_id, u.display_name,
             (SELECT f.kind FROM message_attachments a JOIN files f ON f.id=a.file_id WHERE a.message_id=m.id LIMIT 1) AS att_kind
             FROM messages m LEFT JOIN users u ON u.id=m.sender_id WHERE m.id = ANY($1)`, [replyIds]) : []
  ]);
  const byId = Object.fromEntries(senders.map(u => [u.id, u]));
  const pinSet = new Set(pins.map(p => p.message_id));
  const favSet = new Set(favs.map(p => p.message_id));
  const repById = Object.fromEntries(replies.map(r => [r.id, r]));
  return rows.map(m => {
    const deleted = !!m.deleted_at;
    const rep = m.reply_to_id && repById[m.reply_to_id];
    return {
      id: m.id,
      conversationId: m.conversation_id,
      sender: publicUser(byId[m.sender_id]) || (m.sender_id ? null : null),
      type: m.type,
      content: deleted ? '' : m.content,
      meta: deleted ? {} : m.meta,
      replyTo: rep ? {
        id: rep.id, senderName: rep.display_name, senderId: rep.sender_id,
        content: rep.deleted_at ? 'Mensagem apagada' : (rep.content || (rep.att_kind ? `[${rep.att_kind}]` : (rep.type === 'sticker' ? '[figurinha]' : rep.type === 'gif' ? '[GIF]' : ''))).slice(0, 160)
      } : null,
      forwarded: m.forwarded,
      attachments: deleted ? [] : atts.filter(a => a.message_id === m.id).map(a => ({ id: a.id, url: fileUrl(a.id), name: a.filename, mime: a.mime, size: a.size, kind: a.kind })),
      reactions: deleted ? [] : reacts.filter(r => r.message_id === m.id).map(r => ({ emoji: r.emoji, count: r.n, me: r.me, users: r.users.slice(0, 20) })),
      pinned: pinSet.has(m.id),
      favorite: favSet.has(m.id),
      linkPreview: deleted ? null : m.link_preview,
      editedAt: m.edited_at,
      deleted,
      createdAt: m.created_at
    };
  });
}

async function serializeOne(id, viewerId) {
  const m = await db.one('SELECT * FROM messages WHERE id=$1', [id]);
  return m ? (await serializeMessages([m], viewerId))[0] : null;
}

// emite a mensagem já serializada para cada usuário da sala (reações/favoritos são por usuário,
// então enviamos a versão "neutra" e o cliente recalcula o campo "me")
async function broadcast(convId, event, msgId) {
  const msg = await serializeOne(msgId, 0);
  if (msg) hub.toConv(convId, event, msg);
  return msg;
}

async function createMessage({ convId, senderId, type = 'text', content = '', replyToId = null, fileIds = [], meta = {}, forwarded = false, access }) {
  const msg = await db.tx(async t => {
    const m = await t.one(
      `INSERT INTO messages (conversation_id, sender_id, type, content, reply_to_id, meta, forwarded)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [convId, senderId, type, content, replyToId, meta, forwarded]);
    let pos = 0;
    for (const fid of fileIds) {
      await t.query('INSERT INTO message_attachments (message_id, file_id, position) VALUES ($1,$2,$3)', [m.id, fid, pos++]);
    }
    await t.query('UPDATE conversations SET last_message_at=now() WHERE id=$1', [convId]);
    if (senderId) {
      await t.query(`UPDATE conversation_members SET last_read_id=$1, last_delivered_id=GREATEST(last_delivered_id,$1), archived=false
                      WHERE conversation_id=$2 AND user_id=$3`, [m.id, convId, senderId]);
      // desarquiva a conversa para todos quando chega mensagem nova
      await t.query(`UPDATE conversation_members SET archived=false WHERE conversation_id=$1 AND archived AND NOT notif_muted`, [convId]);
    }
    return m;
  });
  const out = await broadcast(convId, 'message:new', msg.id);

  if (senderId) {
    const earlier = await db.one(`SELECT 1 FROM messages WHERE sender_id=$1 AND id<$2 LIMIT 1`, [senderId, msg.id]);
    if (!earlier) awardBadge(senderId, 'first_message').catch(() => {});
    postProcess(msg, access).catch(e => console.error('[msg-post]', e.message));
  }
  return out;
}

// menções, respostas e pré-visualização de link (assíncrono)
async function postProcess(msg, access) {
  const conv = access?.conv;
  const ctxData = { conversationId: msg.conversation_id, messageId: msg.id, preview: msg.content.slice(0, 120), convName: conv?.name || null, convType: conv?.type, communityId: conv?.community_id || null };
  const notified = new Set();
  if (msg.reply_to_id) {
    const parent = await db.one('SELECT sender_id FROM messages WHERE id=$1', [msg.reply_to_id]);
    if (parent?.sender_id && parent.sender_id !== msg.sender_id) {
      await notify(parent.sender_id, 'reply', msg.sender_id, ctxData);
      notified.add(parent.sender_id);
    }
  }
  const names = [...new Set((msg.content.match(/@([a-zA-Z0-9_.]{3,24})/g) || []).map(s => s.slice(1).toLowerCase()))].slice(0, 20);
  if (names.length) {
    const users = await db.many(`SELECT id FROM users WHERE lower(username) = ANY($1) AND status='active'`, [names]);
    const { conversationAccess } = require('./permissions');
    for (const u of users) {
      if (u.id === msg.sender_id || notified.has(u.id)) continue;
      try { await conversationAccess(msg.conversation_id, u.id); } catch { continue; }
      await notify(u.id, 'mention', msg.sender_id, ctxData);
    }
  }
  const url = msg.type === 'text' && firstUrl(msg.content);
  if (url) {
    const p = await getPreview(url);
    if (p) {
      await db.query('UPDATE messages SET link_preview=$1 WHERE id=$2 AND deleted_at IS NULL', [p, msg.id]);
      await broadcast(msg.conversation_id, 'message:update', msg.id);
    }
  }
}

async function systemMessage(convId, text, meta = {}) {
  return createMessage({ convId, senderId: null, type: 'system', content: text, meta });
}

module.exports = { serializeMessages, serializeOne, broadcast, createMessage, systemMessage };
