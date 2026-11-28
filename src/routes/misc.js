// Notificações, pesquisa global, denúncias, arquivos, chamadas (histórico), figurinhas e GIFs
const express = require('express');
const db = require('../db');
const config = require('../config');
const { upload, storeFile } = require('../files');
const { serialize: serializeNotif } = require('../notify');
const { conversationAccess, accessibleConversationIds, communityContext, canViewChannel } = require('../permissions');
const { serializeMessages } = require('../messages');
const { canSeeStory } = require('./stories');
const { withPresence } = require('./users');
const { rank } = require('../security');
const { ah, err, str, int, oneOf, idArray, publicUser, fileUrl } = require('../util');

const r = express.Router();

// ===================== NOTIFICAÇÕES =====================
r.get('/notifications', ah(async (req, res) => {
  const params = [req.user.id];
  let where = '';
  if (req.query.before) { params.push(int(req.query.before, { min: 1 })); where = 'AND n.id < $2'; }
  const rows = await db.many(`SELECT n.*, u.id AS a_id, u.username, u.display_name, u.avatar_file_id, u.profile_color, u.global_role
    FROM notifications n LEFT JOIN users u ON u.id=n.actor_id WHERE n.user_id=$1 ${where} ORDER BY n.id DESC LIMIT 50`, params);
  const unread = await db.one('SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND read_at IS NULL', [req.user.id]);
  res.json({ items: rows.map(n => serializeNotif(n, n.a_id ? { ...n, id: n.a_id } : null)), unread: unread.n });
}));
r.post('/notifications/read', ah(async (req, res) => {
  if (req.body.all) await db.query('UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL', [req.user.id]);
  else await db.query('UPDATE notifications SET read_at=now() WHERE user_id=$1 AND id = ANY($2)', [req.user.id, idArray(req.body.ids || [], 'Notificações')]);
  res.json({ ok: true });
}));
r.delete('/notifications/:id', ah(async (req, res) => {
  await db.query('DELETE FROM notifications WHERE id=$1 AND user_id=$2', [int(req.params.id, { min: 1 }), req.user.id]);
  res.json({ ok: true });
}));
r.delete('/notifications', ah(async (req, res) => {
  await db.query('DELETE FROM notifications WHERE user_id=$1', [req.user.id]);
  res.json({ ok: true });
}));

// ===================== PESQUISA GLOBAL =====================
r.get('/search', ah(async (req, res) => {
  const q = str(req.query.q, { name: 'Busca', min: 1, max: 80 });
  const type = oneOf(req.query.type, ['all', 'users', 'conversations', 'messages', 'groups', 'communities', 'channels', 'files'], 'Tipo', 'all');
  const like = q.replace(/[%_\\]/g, '\\$&');
  const want = t => type === 'all' || type === t;
  const lim = type === 'all' ? 6 : 40;
  const out = {};
  const me = req.user.id;
  const convIds = (want('messages') || want('files') || want('channels')) ? await accessibleConversationIds(me) : [];

  if (want('users')) {
    const rows = await db.many(`SELECT u.* FROM users u WHERE u.status='active' AND u.id<>$2
      AND (u.username ILIKE $1||'%' OR u.display_name ILIKE '%'||$1||'%')
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id=u.id AND b.blocked_id=$2) LIMIT $3`, [like, me, lim]);
    out.users = await withPresence(rows);
  }
  if (want('conversations')) {
    const rows = await db.many(`SELECT c.id, c.type, c.name, c.avatar_file_id, ou.id AS ou_id, ou.display_name, ou.username, ou.avatar_file_id AS ou_av, ou.profile_color, ou.global_role
      FROM conversation_members cm JOIN conversations c ON c.id=cm.conversation_id
      LEFT JOIN conversation_members om ON c.type='dm' AND om.conversation_id=c.id AND om.user_id<>$2
      LEFT JOIN users ou ON ou.id=om.user_id
      WHERE cm.user_id=$2 AND cm.status='active' AND c.removed_at IS NULL AND c.type IN ('dm','group')
        AND (c.name ILIKE '%'||$1||'%' OR ou.display_name ILIKE '%'||$1||'%' OR ou.username ILIKE $1||'%') LIMIT $3`, [like, me, lim]);
    out.conversations = rows.map(c => ({ id: c.id, type: c.type, name: c.type === 'dm' ? c.display_name : c.name, avatar: c.type === 'dm' ? fileUrl(c.ou_av) : fileUrl(c.avatar_file_id) }));
  }
  if (want('messages')) {
    const rows = await db.many(`SELECT m.* FROM messages m
      LEFT JOIN conversation_members cm ON cm.conversation_id=m.conversation_id AND cm.user_id=$3
      WHERE m.conversation_id = ANY($2) AND m.deleted_at IS NULL AND m.type IN ('text','story_reply') AND m.content ILIKE '%'||$1||'%'
        AND m.id > coalesce(cm.cleared_before_id, 0)
        AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.user_id=$3 AND h.message_id=m.id)
      ORDER BY m.id DESC LIMIT $4`, [like, convIds, me, lim]);
    const msgs = await serializeMessages(rows, me);
    const convs = await db.many(`SELECT c.id, c.type, c.name, c.community_id, co.name AS community_name FROM conversations c LEFT JOIN communities co ON co.id=c.community_id WHERE c.id = ANY($1)`, [rows.map(m => m.conversation_id)]);
    out.messages = msgs.map(m => {
      const c = convs.find(x => x.id === m.conversationId);
      return { ...m, conversation: c ? { id: c.id, type: c.type, name: c.name, communityId: c.community_id, communityName: c.community_name } : null };
    });
  }
  if (want('groups')) {
    const rows = await db.many(`SELECT c.*, EXISTS (SELECT 1 FROM conversation_members m WHERE m.conversation_id=c.id AND m.user_id=$2 AND m.status='active') AS joined
      FROM conversations c WHERE c.type='group' AND c.removed_at IS NULL AND c.name ILIKE '%'||$1||'%'
        AND (c.privacy='public' OR EXISTS (SELECT 1 FROM conversation_members m WHERE m.conversation_id=c.id AND m.user_id=$2 AND m.status='active'))
      LIMIT $3`, [like, me, lim]);
    out.groups = rows.map(c => ({ id: c.id, name: c.name, description: c.description, avatar: fileUrl(c.avatar_file_id), joined: c.joined }));
  }
  if (want('communities')) {
    const rows = await db.many(`SELECT c.*, EXISTS (SELECT 1 FROM community_members m WHERE m.community_id=c.id AND m.user_id=$2) AS joined
      FROM communities c WHERE c.removed_at IS NULL AND (c.name ILIKE '%'||$1||'%' OR c.description ILIKE '%'||$1||'%')
        AND (c.is_public OR EXISTS (SELECT 1 FROM community_members m WHERE m.community_id=c.id AND m.user_id=$2)) LIMIT $3`, [like, me, lim]);
    out.communities = rows.map(c => ({ id: c.id, verified: c.verified, boostLevel: c.boost_level, tag: c.tag, name: c.name, description: c.description, logo: fileUrl(c.logo_file_id), joined: c.joined }));
  }
  if (want('channels')) {
    const rows = await db.many(`SELECT c.id, c.name, c.category, c.community_id, co.name AS community_name FROM conversations c JOIN communities co ON co.id=c.community_id
      WHERE c.id = ANY($2) AND c.type='channel' AND c.name ILIKE '%'||$1||'%' LIMIT $3`, [like, convIds, lim]);
    out.channels = rows.map(c => ({ id: c.id, name: c.name, category: c.category, communityId: c.community_id, communityName: c.community_name }));
  }
  if (want('files')) {
    const rows = await db.many(`SELECT f.id, f.filename, f.mime, f.size, f.kind, m.conversation_id, m.id AS message_id, m.created_at
      FROM files f JOIN message_attachments a ON a.file_id=f.id JOIN messages m ON m.id=a.message_id
      LEFT JOIN conversation_members cm ON cm.conversation_id=m.conversation_id AND cm.user_id=$3
      WHERE m.conversation_id = ANY($2) AND f.deleted_at IS NULL AND m.deleted_at IS NULL AND f.filename ILIKE '%'||$1||'%'
        AND m.id > coalesce(cm.cleared_before_id,0)
      ORDER BY m.id DESC LIMIT $4`, [like, convIds, me, lim]);
    out.files = rows.map(f => ({ id: f.id, url: fileUrl(f.id), name: f.filename, mime: f.mime, size: f.size, kind: f.kind, conversationId: f.conversation_id, messageId: f.message_id, createdAt: f.created_at }));
  }
  res.json(out);
}));

// ===================== DENÚNCIAS =====================
r.post('/reports', ah(async (req, res) => {
  const targetType = oneOf(req.body.targetType, ['user', 'message', 'group', 'community', 'story'], 'Tipo');
  const targetId = int(req.body.targetId, { min: 1 });
  const reason = oneOf(req.body.reason, ['spam', 'assedio', 'odio', 'violencia', 'conteudo_sexual', 'golpe', 'falsidade', 'outro'], 'Motivo');
  const details = str(req.body.details, { name: 'Detalhes', max: 1000, required: false });
  let communityId = null;
  if (targetType === 'message') {
    const m = await db.one('SELECT * FROM messages WHERE id=$1', [targetId]);
    if (!m) throw err(404, 'Mensagem não encontrada.');
    const a = await conversationAccess(m.conversation_id, req.user.id);
    if (a.conv.type === 'channel') communityId = a.conv.community_id;
  } else if (targetType === 'user') {
    if (!await db.one('SELECT 1 FROM users WHERE id=$1', [targetId])) throw err(404, 'Usuário não encontrado.');
  } else if (targetType === 'community') {
    if (!await db.one('SELECT 1 FROM communities WHERE id=$1', [targetId])) throw err(404, 'Comunidade não encontrada.');
  } else if (targetType === 'group') {
    if (!await db.one(`SELECT 1 FROM conversations WHERE id=$1 AND type='group'`, [targetId])) throw err(404, 'Grupo não encontrado.');
  } else if (targetType === 'story') {
    const s = await db.one('SELECT * FROM stories WHERE id=$1', [targetId]);
    if (!s || !await canSeeStory(s, req.user.id)) throw err(404, 'Story não encontrado.');
  }
  const dup = await db.one(`SELECT 1 FROM reports WHERE reporter_id=$1 AND target_type=$2 AND target_id=$3 AND status IN ('open','reviewing')`, [req.user.id, targetType, targetId]);
  if (dup) return res.json({ ok: true, message: 'Você já denunciou isso. Nossa equipe está analisando.' });
  await db.query(`INSERT INTO reports (reporter_id, target_type, target_id, community_id, reason, details) VALUES ($1,$2,$3,$4,$5,$6)`,
    [req.user.id, targetType, targetId, communityId, reason, details]);
  res.status(201).json({ ok: true, message: 'Denúncia enviada. Obrigado por ajudar a manter o NEW GG seguro.' });
}));

// ===================== CHAMADAS (histórico) =====================
r.get('/calls', ah(async (req, res) => {
  const rows = await db.many(`SELECT c.*, cv.type AS conv_type, cv.name AS conv_name, p.state AS my_state,
      (SELECT json_agg(json_build_object('id', u.id, 'displayName', u.display_name, 'avatar', CASE WHEN u.avatar_file_id IS NULL THEN NULL ELSE '/api/files/' || u.avatar_file_id END))
         FROM call_participants x JOIN users u ON u.id=x.user_id WHERE x.call_id=c.id AND x.user_id<>$1) AS others
    FROM call_participants p JOIN calls c ON c.id=p.call_id JOIN conversations cv ON cv.id=c.conversation_id
    WHERE p.user_id=$1 ORDER BY c.started_at DESC LIMIT 100`, [req.user.id]);
  res.json(rows.map(c => ({
    id: c.id, conversationId: c.conversation_id, convType: c.conv_type, convName: c.conv_name, media: c.media, status: c.status,
    outgoing: c.initiator_id === req.user.id, myState: c.my_state, startedAt: c.started_at, answeredAt: c.answered_at, endedAt: c.ended_at,
    duration: c.answered_at && c.ended_at ? Math.round((new Date(c.ended_at) - new Date(c.answered_at)) / 1000) : 0,
    others: c.others || []
  })));
}));
r.get('/calls/ice', ah(async (req, res) => {
  const servers = [{ urls: config.stunUrls }];
  if (config.turn.urls.length) servers.push({ urls: config.turn.urls, username: config.turn.username, credential: config.turn.credential });
  res.json({ iceServers: servers });
}));

// ===================== FIGURINHAS E GIFS =====================
r.get('/stickers', ah(async (req, res) => {
  const rows = await db.many(`SELECT s.*, EXISTS (SELECT 1 FROM sticker_favorites f WHERE f.sticker_id=s.id AND f.user_id=$1) AS fav
    FROM stickers s WHERE s.owner_id=$1 OR s.id IN (SELECT sticker_id FROM sticker_favorites WHERE user_id=$1) ORDER BY s.created_at DESC`, [req.user.id]);
  res.json(rows.map(s => ({ id: s.id, name: s.name, url: fileUrl(s.file_id), mine: s.owner_id === req.user.id, favorite: s.fav })));
}));
r.post('/stickers', upload.single('file'), ah(async (req, res) => {
  if (!req.file) throw err(400, 'Envie uma imagem.');
  const n = await db.one('SELECT count(*)::int AS n FROM stickers WHERE owner_id=$1', [req.user.id]);
  if (n.n >= 120) throw err(400, 'Limite de 120 figurinhas.');
  if (req.file.size > 2 * 1024 * 1024) throw err(413, 'Figurinhas podem ter até 2 MB.');
  const f = await storeFile(req.file, req.user.id, 'public', { allowKinds: ['image'] });
  const s = await db.one('INSERT INTO stickers (owner_id, file_id, name) VALUES ($1,$2,$3) RETURNING *', [req.user.id, f.id, str(req.body.name, { max: 40, required: false })]);
  res.status(201).json({ id: s.id, url: f.url, name: s.name, mine: true });
}));
r.delete('/stickers/:id', ah(async (req, res) => {
  await db.query('DELETE FROM stickers WHERE id=$1 AND owner_id=$2', [int(req.params.id, { min: 1 }), req.user.id]);
  res.json({ ok: true });
}));
r.post('/stickers/:id/favorite', ah(async (req, res) => {
  const id = int(req.params.id, { min: 1 });
  if (!await db.one('SELECT 1 FROM stickers WHERE id=$1', [id])) throw err(404, 'Figurinha não encontrada.');
  const ex = await db.one('SELECT 1 FROM sticker_favorites WHERE user_id=$1 AND sticker_id=$2', [req.user.id, id]);
  if (ex) await db.query('DELETE FROM sticker_favorites WHERE user_id=$1 AND sticker_id=$2', [req.user.id, id]);
  else await db.query('INSERT INTO sticker_favorites (user_id, sticker_id) VALUES ($1,$2)', [req.user.id, id]);
  res.json({ favorite: !ex });
}));

// GIFs via GIPHY (chave beta gratuita: 100 chamadas/hora — por isso há cache de 10 min)
const gifCache = new Map();
r.get('/gifs', ah(async (req, res) => {
  if (!config.giphyApiKey) throw err(503, 'GIFs não configurados (GIPHY_API_KEY).');
  const q = str(req.query.q, { max: 60, required: false }).toLowerCase();
  const hit = gifCache.get(q);
  if (hit && Date.now() - hit.t < 600000) return res.json(hit.data);
  const params = new URLSearchParams({ api_key: config.giphyApiKey, limit: '24', rating: 'pg-13', bundle: 'messaging_non_clips' });
  if (q) { params.set('q', q); params.set('lang', 'pt'); }
  const r0 = await fetch(`https://api.giphy.com/v1/gifs/${q ? 'search' : 'trending'}?${params}`);
  if (r0.status === 429) throw err(429, 'Limite de buscas de GIF atingido. Tente em alguns minutos.');
  const data = await r0.json();
  const out = (data.data || []).map(g => ({
    id: g.id, title: g.title,
    preview: g.images?.fixed_width_small?.url || g.images?.fixed_height_small?.url,
    url: g.images?.fixed_height?.url || g.images?.original?.url,
    width: Number(g.images?.fixed_height?.width) || 0, height: Number(g.images?.fixed_height?.height) || 0
  })).filter(g => g.url);
  gifCache.set(q, { t: Date.now(), data: out });
  if (gifCache.size > 500) gifCache.delete(gifCache.keys().next().value);
  res.json(out);
}));

// ===================== ARQUIVOS =====================
async function canAccessFile(f, user) {
  if (f.scope === 'public') return true;
  if (!user) return false;
  if (f.owner_id === user.id) return true;
  if (f.scope === 'message') {
    const links = await db.many('SELECT m.conversation_id, m.id FROM message_attachments a JOIN messages m ON m.id=a.message_id WHERE a.file_id=$1 AND m.deleted_at IS NULL', [f.id]);
    for (const l of links) {
      try {
        const a = await conversationAccess(l.conversation_id, user.id);
        if (!a.member || l.id > a.member.cleared_before_id) return true;
      } catch { /* sem acesso */ }
    }
    // anexos de mensagens denunciadas podem ser vistos pela equipe de moderação
    if (rank(user) >= 2 && links.length) {
      const rep = await db.one(`SELECT 1 FROM reports WHERE target_type='message' AND target_id = ANY($1) LIMIT 1`, [links.map(l => l.id)]);
      if (rep) return true;
    }
    return false;
  }
  if (f.scope === 'story') {
    const s = await db.one('SELECT * FROM stories WHERE file_id=$1', [f.id]);
    return !!s && (await canSeeStory(s, user.id) || rank(user) >= 2);
  }
  if (f.scope === 'ticket') return rank(user) >= 1;
  return false;
}

r.get('/files/:id', ah(async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw err(404, 'Arquivo não encontrado.');
  const meta = await db.one('SELECT id, owner_id, filename, mime, size, kind, scope, deleted_at FROM files WHERE id=$1', [req.params.id]);
  if (!meta || meta.deleted_at) throw err(404, 'Arquivo não encontrado.');
  if (!await canAccessFile(meta, req.user)) throw err(req.user ? 403 : 401, 'Sem acesso a este arquivo.');
  const etag = `"${meta.id}"`;
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', meta.scope === 'public' ? 'public, max-age=604800, immutable' : 'private, max-age=3600');
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  const { data } = await db.one('SELECT data FROM files WHERE id=$1', [meta.id]);
  const inline = ['image', 'video', 'audio'].includes(meta.kind) || meta.mime === 'application/pdf';
  const download = req.query.download === '1' || !inline;
  res.setHeader('Content-Type', meta.mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(meta.filename)}`);
  res.setHeader('Accept-Ranges', 'bytes');
  // suporte a Range (necessário para vídeo/áudio no Safari)
  const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
    if (start >= data.length || start > end) { res.setHeader('Content-Range', `bytes */${data.length}`); return res.status(416).end(); }
    res.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${data.length}`);
    res.setHeader('Content-Length', end - start + 1);
    return res.end(data.subarray(start, end + 1));
  }
  res.setHeader('Content-Length', data.length);
  res.end(data);
}));

r.delete('/files/:id', ah(async (req, res) => {
  const f = await db.one('SELECT * FROM files WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL', [req.params.id, req.user.id]);
  if (!f) throw err(404, 'Arquivo não encontrado.');
  await db.query('UPDATE files SET deleted_at=now() WHERE id=$1', [f.id]);
  // atualiza a mensagem para os participantes
  const links = await db.many('SELECT message_id, m.conversation_id FROM message_attachments a JOIN messages m ON m.id=a.message_id WHERE a.file_id=$1', [f.id]);
  const { broadcast } = require('../messages');
  for (const l of links) await broadcast(l.conversation_id, 'message:update', l.message_id);
  res.json({ ok: true });
}));

r.get('/files', ah(async (req, res) => {
  const rows = await db.many(`SELECT id, filename, mime, size, kind, scope, created_at FROM files WHERE owner_id=$1 AND deleted_at IS NULL AND scope IN ('message','story') ORDER BY created_at DESC LIMIT 200`, [req.user.id]);
  res.json(rows.map(f => ({ id: f.id, url: fileUrl(f.id), name: f.filename, mime: f.mime, size: f.size, kind: f.kind, scope: f.scope, createdAt: f.created_at })));
}));

module.exports = { router: r, canAccessFile, publicUser, communityContext, canViewChannel };
