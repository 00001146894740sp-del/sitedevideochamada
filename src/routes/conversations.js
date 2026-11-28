const express = require('express');
const db = require('../db');
const hub = require('../hub');
const { upload, storeFile } = require('../files');
const { conversationAccess, communityContext, canViewChannel } = require('../permissions');
const { createMessage, serializeMessages, serializeOne, broadcast, systemMessage } = require('../messages');
const { notify, activity } = require('../notify');
const { withPresence } = require('./users');
const { getSetting } = require('../settings');
const {
  ah, err, str, int, bool, oneOf, idArray, randomToken, publicUser, fileUrl,
  DEFAULT_PRIVACY, mergeDeep
} = require('../util');

const r = express.Router();

// ---------- anti-spam: limite de mensagens por usuário ----------
const rate = new Map();
function spamGuard(userId) {
  const now = Date.now();
  const arr = (rate.get(userId) || []).filter(t => now - t < 10000);
  if (arr.length >= 15) throw err(429, 'Você está enviando mensagens rápido demais. Aguarde um pouco.');
  arr.push(now); rate.set(userId, arr);
}
setInterval(() => { const now = Date.now(); for (const [k, v] of rate) if (!v.some(t => now - t < 10000)) rate.delete(k); }, 60000).unref();

const dmKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);

async function convSummary(userId, convIds = null) {
  const rows = await db.many(`
    SELECT c.*, cm.archived, cm.notif_muted, cm.last_read_id, cm.cleared_before_id, cm.role AS my_role,
      (SELECT json_build_object('id', m.id, 'content', CASE WHEN m.deleted_at IS NULL THEN left(m.content, 140) ELSE '' END,
              'type', m.type, 'senderId', m.sender_id, 'createdAt', m.created_at, 'deleted', m.deleted_at IS NOT NULL,
              'attKind', (SELECT f.kind FROM message_attachments a JOIN files f ON f.id=a.file_id WHERE a.message_id=m.id LIMIT 1))
         FROM messages m WHERE m.conversation_id=c.id AND m.id>cm.cleared_before_id
          AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.user_id=$1 AND h.message_id=m.id)
         ORDER BY m.id DESC LIMIT 1) AS last,
      (SELECT count(*)::int FROM messages m WHERE m.conversation_id=c.id AND m.id>GREATEST(cm.last_read_id, cm.cleared_before_id)
          AND m.sender_id IS DISTINCT FROM $1 AND m.type<>'system' AND m.deleted_at IS NULL) AS unread,
      (SELECT count(*)::int FROM conversation_members x WHERE x.conversation_id=c.id AND x.status='active') AS member_count,
      (SELECT x.user_id FROM conversation_members x WHERE x.conversation_id=c.id AND x.user_id<>$1 LIMIT 1) AS other_id
    FROM conversation_members cm JOIN conversations c ON c.id=cm.conversation_id
    WHERE cm.user_id=$1 AND cm.status='active' AND c.type IN ('dm','group') AND c.removed_at IS NULL
      ${convIds ? 'AND c.id = ANY($2)' : ''}
    ORDER BY c.last_message_at DESC`, convIds ? [userId, convIds] : [userId]);
  const otherIds = rows.filter(c => c.type === 'dm' && c.other_id).map(c => c.other_id);
  const others = otherIds.length ? await withPresence(await db.many('SELECT * FROM users WHERE id = ANY($1)', [otherIds])) : [];
  return rows.map(c => ({
    id: c.id, type: c.type,
    name: c.type === 'dm' ? (others.find(o => o.id === c.other_id)?.displayName || 'Usuário') : c.name,
    avatar: c.type === 'dm' ? others.find(o => o.id === c.other_id)?.avatar : fileUrl(c.avatar_file_id),
    other: c.type === 'dm' ? others.find(o => o.id === c.other_id) || null : null,
    memberCount: c.member_count, myRole: c.my_role,
    archived: c.archived, muted: c.notif_muted, unread: c.unread, last: c.last, lastMessageAt: c.last_message_at
  }));
}

// ===================== LISTA E CRIAÇÃO =====================
r.get('/conversations', ah(async (req, res) => {
  res.json(await convSummary(req.user.id));
}));

r.post('/conversations/dm', ah(async (req, res) => {
  const otherId = int(req.body.userId, { name: 'Usuário', min: 1 });
  if (otherId === req.user.id) throw err(400, 'Escolha outro usuário.');
  const other = await db.one(`SELECT * FROM users WHERE id=$1 AND status='active'`, [otherId]);
  if (!other) throw err(404, 'Usuário não encontrado.');
  const blocked = await db.one(`SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)`, [req.user.id, otherId]);
  if (blocked) throw err(403, 'Não é possível conversar com esse usuário.');
  const key = dmKey(req.user.id, otherId);
  let conv = await db.one('SELECT * FROM conversations WHERE dm_key=$1', [key]);
  if (!conv) {
    await assertCanMessage(req.user.id, other);
    conv = await db.tx(async t => {
      const c = await t.one(`INSERT INTO conversations (type, dm_key) VALUES ('dm',$1) ON CONFLICT (dm_key) DO UPDATE SET dm_key=EXCLUDED.dm_key RETURNING *`, [key]);
      await t.query(`INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1,$2),($1,$3) ON CONFLICT DO NOTHING`, [c.id, req.user.id, otherId]);
      return c;
    });
  } else {
    await db.query(`UPDATE conversation_members SET status='active', archived=false WHERE conversation_id=$1 AND user_id=$2`, [conv.id, req.user.id]);
  }
  hub.joinConv(req.user.id, conv.id); hub.joinConv(otherId, conv.id);
  const [s] = await convSummary(req.user.id, [conv.id]);
  res.json(s);
}));

async function assertCanMessage(fromId, target) {
  const priv = mergeDeep(DEFAULT_PRIVACY, target.privacy);
  if (priv.whoCanMessage === 'everyone') return;
  const friend = await db.one('SELECT 1 FROM friends WHERE user_id=$1 AND friend_id=$2', [target.id, fromId]);
  if (priv.whoCanMessage === 'nobody' || !friend) {
    throw err(403, priv.whoCanMessage === 'nobody' ? 'Esse usuário não recebe mensagens diretas.' : 'Esse usuário só recebe mensagens de amigos.');
  }
}

r.post('/conversations/group', ah(async (req, res) => {
  const name = str(req.body.name, { name: 'Nome do grupo', min: 1, max: 60 });
  const description = str(req.body.description, { name: 'Descrição', max: 500, required: false });
  const memberIds = req.body.memberIds ? idArray(req.body.memberIds, 'Participantes').filter(i => i !== req.user.id) : [];
  if (memberIds.length > 250) throw err(400, 'Máximo de 250 participantes iniciais.');
  const privacy = oneOf(req.body.privacy, ['public', 'private'], 'Privacidade', 'private');
  const allowed = [];
  for (const id of memberIds) {
    const u = await db.one(`SELECT * FROM users WHERE id=$1 AND status='active'`, [id]);
    if (!u) continue;
    const bl = await db.one(`SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)`, [req.user.id, id]);
    if (!bl) allowed.push(id);
  }
  const conv = await db.tx(async t => {
    const c = await t.one(`INSERT INTO conversations (type, name, description, owner_id, privacy, invite_code) VALUES ('group',$1,$2,$3,$4,$5) RETURNING *`,
      [name, description, req.user.id, privacy, randomToken(9)]);
    await t.query(`INSERT INTO conversation_members (conversation_id, user_id, role, can_pin) VALUES ($1,$2,'owner',true)`, [c.id, req.user.id]);
    for (const id of allowed) {
      await t.query(`INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1,$2)`, [c.id, id]);
      await t.query(`INSERT INTO member_history (conversation_id, user_id, actor_id, action) VALUES ($1,$2,$3,'added')`, [c.id, id, req.user.id]);
    }
    await t.query(`INSERT INTO member_history (conversation_id, user_id, actor_id, action) VALUES ($1,$2,$2,'created')`, [c.id, req.user.id]);
    return c;
  });
  for (const id of [req.user.id, ...allowed]) hub.joinConv(id, conv.id);
  await systemMessage(conv.id, `${req.user.display_name} criou o grupo "${name}"`);
  for (const id of allowed) {
    await notify(id, 'group_invite', req.user.id, { conversationId: conv.id, name });
    hub.toUser(id, 'conversations:changed', {});
  }
  await activity(req.user.id, 'group_created', { name });
  const [s] = await convSummary(req.user.id, [conv.id]);
  res.status(201).json(s);
}));

// ===================== DETALHES =====================
r.get('/conversations/:id', ah(async (req, res) => {
  const a = await conversationAccess(int(req.params.id, { min: 1 }), req.user.id);
  const c = a.conv;
  const base = {
    id: c.id, type: c.type, name: c.name, description: c.description, avatar: fileUrl(c.avatar_file_id), banner: fileUrl(c.banner_file_id),
    privacy: c.privacy, joinApproval: c.join_approval, onlyAdminsSend: c.only_admins_send, notice: c.notice, topic: c.topic,
    category: c.category, communityId: c.community_id, isPrivate: c.is_private, createdAt: c.created_at,
    perms: { canSend: a.canSend, canSendMedia: a.canSendMedia, canModerate: a.canModerate, canPin: a.canPin, canManage: a.canManage, silenced: !!a.silenced },
    me: a.member ? { role: a.member.role, archived: a.member.archived, muted: a.member.notif_muted, lastReadId: a.member.last_read_id, canInvite: a.member.can_invite } : null
  };
  if (c.type === 'group' || c.type === 'dm') {
    const members = await db.many(`SELECT u.*, cm.role AS member_role, cm.status AS member_status, cm.can_send, cm.can_send_media, cm.can_invite, cm.can_pin,
        cm.silenced_until, cm.last_read_id, cm.last_delivered_id, cm.joined_at
      FROM conversation_members cm JOIN users u ON u.id=cm.user_id
      WHERE cm.conversation_id=$1 AND cm.status IN ('active','pending') ORDER BY
        CASE cm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'moderator' THEN 2 ELSE 3 END, lower(u.display_name)`, [c.id]);
    const pres = await withPresence(members);
    base.members = members.map((m, i) => {
      const priv = mergeDeep(DEFAULT_PRIVACY, m.privacy);
      return {
        ...pres[i], memberRole: m.member_role, status: m.member_status, joinedAt: m.joined_at,
        perms: { canSend: m.can_send, canSendMedia: m.can_send_media, canInvite: m.can_invite, canPin: m.can_pin },
        silencedUntil: m.silenced_until,
        lastDeliveredId: m.last_delivered_id,
        lastReadId: priv.readReceipts ? m.last_read_id : null
      };
    });
    if (c.type === 'dm') {
      base.other = base.members.find(m => m.id !== req.user.id) || null;
      base.name = base.other?.displayName; base.avatar = base.other?.avatar;
      base.blocked = a.blocked;
      // confirmação de leitura é recíproca: se eu desativei, não vejo a dos outros
      if (!mergeDeep(DEFAULT_PRIVACY, req.user.privacy).readReceipts) base.members.forEach(m => { if (m.id !== req.user.id) m.lastReadId = null; });
    } else if (a.canManage || (a.member && a.member.can_invite)) {
      base.inviteCode = c.invite_code;
    }
  }
  res.json(base);
}));

r.patch('/conversations/:id', ah(async (req, res) => {
  const a = await conversationAccess(int(req.params.id, { min: 1 }), req.user.id);
  if (a.conv.type !== 'group') throw err(400, 'Apenas grupos podem ser editados aqui.');
  if (!a.canManage) throw err(403, 'Apenas administradores podem alterar o grupo.');
  const b = req.body; const sets = []; const vals = [];
  const add = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
  if (b.name !== undefined) add('name', str(b.name, { name: 'Nome', min: 1, max: 60 }));
  if (b.description !== undefined) add('description', str(b.description, { name: 'Descrição', max: 500, required: false }));
  if (b.notice !== undefined) add('notice', str(b.notice, { name: 'Aviso', max: 500, required: false }));
  if (b.privacy !== undefined) add('privacy', oneOf(b.privacy, ['public', 'private'], 'Privacidade'));
  if (b.joinApproval !== undefined) add('join_approval', bool(b.joinApproval));
  if (b.onlyAdminsSend !== undefined) add('only_admins_send', bool(b.onlyAdminsSend));
  if (!sets.length) return res.json({ ok: true });
  vals.push(a.conv.id);
  await db.query(`UPDATE conversations SET ${sets.join(',')} WHERE id=$${vals.length}`, vals);
  if (b.notice) await systemMessage(a.conv.id, `📢 Aviso do grupo: ${b.notice}`, { notice: true });
  else if (b.name && b.name !== a.conv.name) await systemMessage(a.conv.id, `${req.user.display_name} renomeou o grupo para "${b.name}"`);
  hub.toConv(a.conv.id, 'conversation:update', { id: a.conv.id });
  res.json({ ok: true });
}));

for (const kind of ['avatar', 'banner']) {
  r.post(`/conversations/:id/${kind}`, upload.single('file'), ah(async (req, res) => {
    const a = await conversationAccess(int(req.params.id, { min: 1 }), req.user.id);
    if (a.conv.type !== 'group' || !a.canManage) throw err(403, 'Sem permissão.');
    if (!req.file) throw err(400, 'Envie uma imagem.');
    const f = await storeFile(req.file, req.user.id, 'public', { allowKinds: ['image'] });
    await db.query(`UPDATE conversations SET ${kind}_file_id=$1 WHERE id=$2`, [f.id, a.conv.id]);
    hub.toConv(a.conv.id, 'conversation:update', { id: a.conv.id });
    res.json({ url: f.url });
  }));
}

// preferências pessoais da conversa
r.patch('/conversations/:id/me', ah(async (req, res) => {
  const a = await conversationAccess(int(req.params.id, { min: 1 }), req.user.id);
  if (!a.member) throw err(400, 'Indisponível para canais.');
  if (req.body.archived !== undefined) await db.query(`UPDATE conversation_members SET archived=$1 WHERE conversation_id=$2 AND user_id=$3`, [bool(req.body.archived), a.conv.id, req.user.id]);
  if (req.body.muted !== undefined) await db.query(`UPDATE conversation_members SET notif_muted=$1 WHERE conversation_id=$2 AND user_id=$3`, [bool(req.body.muted), a.conv.id, req.user.id]);
  res.json({ ok: true });
}));

r.post('/conversations/:id/clear', ah(async (req, res) => {
  const a = await conversationAccess(int(req.params.id, { min: 1 }), req.user.id);
  if (!a.member) throw err(400, 'Indisponível para canais.');
  const last = await db.one('SELECT coalesce(max(id),0) AS id FROM messages WHERE conversation_id=$1', [a.conv.id]);
  await db.query(`UPDATE conversation_members SET cleared_before_id=$1, last_read_id=GREATEST(last_read_id,$1) WHERE conversation_id=$2 AND user_id=$3`, [last.id, a.conv.id, req.user.id]);
  res.json({ ok: true });
}));

// ===================== MEMBROS DE GRUPO =====================
async function groupAccess(req) {
  const a = await conversationAccess(int(req.params.id, { min: 1 }), req.user.id);
  if (a.conv.type !== 'group') throw err(400, 'Disponível apenas para grupos.');
  return a;
}
const ROLE_ORDER = { owner: 3, admin: 2, moderator: 1, member: 0 };

r.post('/conversations/:id/members', ah(async (req, res) => {
  const a = await groupAccess(req);
  if (!a.canManage && !a.member.can_invite) throw err(403, 'Você não pode adicionar participantes.');
  const ids = idArray(req.body.userIds, 'Participantes');
  const pending = a.conv.join_approval && !a.canManage;
  const added = [];
  for (const id of ids) {
    const u = await db.one(`SELECT * FROM users WHERE id=$1 AND status='active'`, [id]);
    if (!u) continue;
    const bl = await db.one(`SELECT 1 FROM blocks WHERE blocker_id=$1 AND blocked_id=$2`, [id, req.user.id]);
    if (bl) continue;
    const ex = await db.one(`SELECT status FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`, [a.conv.id, id]);
    if (ex?.status === 'active') continue;
    await db.query(`INSERT INTO conversation_members (conversation_id, user_id, status, role) VALUES ($1,$2,$3,'member')
      ON CONFLICT (conversation_id, user_id) DO UPDATE SET status=EXCLUDED.status, role='member', joined_at=now()`, [a.conv.id, id, pending ? 'pending' : 'active']);
    await db.query(`INSERT INTO member_history (conversation_id, user_id, actor_id, action) VALUES ($1,$2,$3,$4)`, [a.conv.id, id, req.user.id, pending ? 'requested' : 'added']);
    added.push(u);
    if (!pending) {
      hub.joinConv(id, a.conv.id);
      await notify(id, 'group_invite', req.user.id, { conversationId: a.conv.id, name: a.conv.name });
      hub.toUser(id, 'conversations:changed', {});
    }
  }
  if (added.length && !pending) await systemMessage(a.conv.id, `${req.user.display_name} adicionou ${added.map(u => u.display_name).join(', ')}`);
  if (pending && added.length) await notifyGroupAdmins(a.conv, req.user.id, added.length);
  hub.toConv(a.conv.id, 'conversation:update', { id: a.conv.id });
  res.json({ ok: true, added: added.length, pending });
}));

async function notifyGroupAdmins(conv, actorId, n) {
  const admins = await db.many(`SELECT user_id FROM conversation_members WHERE conversation_id=$1 AND role IN ('owner','admin') AND status='active'`, [conv.id]);
  for (const ad of admins) await notify(ad.user_id, 'group_join_request', actorId, { conversationId: conv.id, name: conv.name, count: n });
}

r.patch('/conversations/:id/members/:userId', ah(async (req, res) => {
  const a = await groupAccess(req);
  const targetId = int(req.params.userId, { min: 1 });
  const t = await db.one(`SELECT * FROM conversation_members WHERE conversation_id=$1 AND user_id=$2 AND status='active'`, [a.conv.id, targetId]);
  if (!t) throw err(404, 'Participante não encontrado.');
  const myRank = ROLE_ORDER[a.member.role];
  if (!a.canModerate || ROLE_ORDER[t.role] >= myRank) throw err(403, 'Você não pode alterar esse participante.');
  const b = req.body; const sets = []; const vals = [];
  const add = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
  if (b.role !== undefined) {
    const role = oneOf(b.role, ['admin', 'moderator', 'member'], 'Cargo');
    if (!a.canManage || ROLE_ORDER[role] >= myRank) throw err(403, 'Você não pode atribuir esse cargo.');
    add('role', role);
    if (role !== 'member') add('can_pin', true);
  }
  for (const [k, col] of [['canSend', 'can_send'], ['canSendMedia', 'can_send_media'], ['canInvite', 'can_invite'], ['canPin', 'can_pin']]) {
    if (b[k] !== undefined) add(col, bool(b[k]));
  }
  if (b.silenceMinutes !== undefined) {
    const m = int(b.silenceMinutes, { name: 'Tempo', min: 0, max: 60 * 24 * 30 });
    add('silenced_until', m ? new Date(Date.now() + m * 60000) : null);
  }
  if (!sets.length) return res.json({ ok: true });
  vals.push(a.conv.id, targetId);
  await db.query(`UPDATE conversation_members SET ${sets.join(',')} WHERE conversation_id=$${vals.length - 1} AND user_id=$${vals.length}`, vals);
  const target = await db.one('SELECT display_name FROM users WHERE id=$1', [targetId]);
  if (b.role) {
    await db.query(`INSERT INTO member_history (conversation_id, user_id, actor_id, action) VALUES ($1,$2,$3,$4)`, [a.conv.id, targetId, req.user.id, `role:${b.role}`]);
    await systemMessage(a.conv.id, `${req.user.display_name} definiu ${target.display_name} como ${{ admin: 'administrador', moderator: 'moderador', member: 'membro' }[b.role]}`);
  }
  if (b.silenceMinutes) await systemMessage(a.conv.id, `${target.display_name} foi silenciado por ${b.silenceMinutes} min`);
  hub.toConv(a.conv.id, 'conversation:update', { id: a.conv.id });
  res.json({ ok: true });
}));

r.delete('/conversations/:id/members/:userId', ah(async (req, res) => {
  const a = await groupAccess(req);
  const targetId = int(req.params.userId, { min: 1 });
  const t = await db.one(`SELECT * FROM conversation_members WHERE conversation_id=$1 AND user_id=$2 AND status IN ('active','pending')`, [a.conv.id, targetId]);
  if (!t) throw err(404, 'Participante não encontrado.');
  if (!a.canModerate || ROLE_ORDER[t.role] >= ROLE_ORDER[a.member.role]) throw err(403, 'Você não pode remover esse participante.');
  await db.query(`UPDATE conversation_members SET status='removed' WHERE conversation_id=$1 AND user_id=$2`, [a.conv.id, targetId]);
  await db.query(`INSERT INTO member_history (conversation_id, user_id, actor_id, action) VALUES ($1,$2,$3,'removed')`, [a.conv.id, targetId, req.user.id]);
  hub.leaveConv(targetId, a.conv.id);
  hub.toUser(targetId, 'conversations:changed', { removed: a.conv.id });
  const target = await db.one('SELECT display_name FROM users WHERE id=$1', [targetId]);
  if (t.status === 'active') await systemMessage(a.conv.id, `${req.user.display_name} removeu ${target.display_name}`);
  hub.toConv(a.conv.id, 'conversation:update', { id: a.conv.id });
  res.json({ ok: true });
}));

r.post('/conversations/:id/members/:userId/approve', ah(async (req, res) => {
  const a = await groupAccess(req);
  if (!a.canManage) throw err(403, 'Apenas administradores aprovam participantes.');
  const targetId = int(req.params.userId, { min: 1 });
  const t = await db.one(`UPDATE conversation_members SET status='active', joined_at=now() WHERE conversation_id=$1 AND user_id=$2 AND status='pending' RETURNING *`, [a.conv.id, targetId]);
  if (!t) throw err(404, 'Solicitação não encontrada.');
  await db.query(`INSERT INTO member_history (conversation_id, user_id, actor_id, action) VALUES ($1,$2,$3,'approved')`, [a.conv.id, targetId, req.user.id]);
  hub.joinConv(targetId, a.conv.id);
  const u = await db.one('SELECT display_name FROM users WHERE id=$1', [targetId]);
  await systemMessage(a.conv.id, `${u.display_name} entrou no grupo`);
  await notify(targetId, 'group_invite', req.user.id, { conversationId: a.conv.id, name: a.conv.name, approved: true });
  hub.toUser(targetId, 'conversations:changed', {});
  hub.toConv(a.conv.id, 'conversation:update', { id: a.conv.id });
  res.json({ ok: true });
}));
r.post('/conversations/:id/members/:userId/reject', ah(async (req, res) => {
  const a = await groupAccess(req);
  if (!a.canManage) throw err(403, 'Sem permissão.');
  await db.query(`UPDATE conversation_members SET status='removed' WHERE conversation_id=$1 AND user_id=$2 AND status='pending'`, [a.conv.id, int(req.params.userId, { min: 1 })]);
  await db.query(`INSERT INTO member_history (conversation_id, user_id, actor_id, action) VALUES ($1,$2,$3,'rejected')`, [a.conv.id, int(req.params.userId, { min: 1 }), req.user.id]);
  hub.toConv(a.conv.id, 'conversation:update', { id: a.conv.id });
  res.json({ ok: true });
}));

r.post('/conversations/:id/leave', ah(async (req, res) => {
  const a = await groupAccess(req);
  if (a.member.role === 'owner') {
    // transfere a posse para o admin (ou membro) mais antigo
    const heir = await db.one(`SELECT user_id FROM conversation_members WHERE conversation_id=$1 AND user_id<>$2 AND status='active'
      ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END, joined_at LIMIT 1`, [a.conv.id, req.user.id]);
    if (heir) {
      await db.query(`UPDATE conversation_members SET role='owner', can_pin=true WHERE conversation_id=$1 AND user_id=$2`, [a.conv.id, heir.user_id]);
      await db.query(`UPDATE conversations SET owner_id=$1 WHERE id=$2`, [heir.user_id, a.conv.id]);
    }
  }
  await db.query(`UPDATE conversation_members SET status='left' WHERE conversation_id=$1 AND user_id=$2`, [a.conv.id, req.user.id]);
  await db.query(`INSERT INTO member_history (conversation_id, user_id, actor_id, action) VALUES ($1,$2,$2,'left')`, [a.conv.id, req.user.id]);
  hub.leaveConv(req.user.id, a.conv.id);
  await systemMessage(a.conv.id, `${req.user.display_name} saiu do grupo`);
  hub.toConv(a.conv.id, 'conversation:update', { id: a.conv.id });
  res.json({ ok: true });
}));

r.get('/conversations/:id/history', ah(async (req, res) => {
  const a = await groupAccess(req);
  const rows = await db.many(`SELECT h.action, h.created_at, u.display_name AS user_name, h.user_id, ac.display_name AS actor_name
    FROM member_history h JOIN users u ON u.id=h.user_id LEFT JOIN users ac ON ac.id=h.actor_id
    WHERE h.conversation_id=$1 ORDER BY h.id DESC LIMIT 200`, [a.conv.id]);
  res.json(rows);
}));

r.post('/conversations/:id/invite-link', ah(async (req, res) => {
  const a = await groupAccess(req);
  if (!a.canManage) throw err(403, 'Apenas administradores podem redefinir o link.');
  const code = randomToken(9);
  await db.query('UPDATE conversations SET invite_code=$1 WHERE id=$2', [code, a.conv.id]);
  res.json({ inviteCode: code });
}));

// convite por link
r.get('/invites/group/:code', ah(async (req, res) => {
  const c = await db.one(`SELECT c.*, (SELECT count(*)::int FROM conversation_members m WHERE m.conversation_id=c.id AND m.status='active') AS n
    FROM conversations c WHERE c.invite_code=$1 AND c.type='group' AND c.removed_at IS NULL`, [str(req.params.code, { max: 40 })]);
  if (!c) throw err(404, 'Convite inválido ou expirado.');
  const me = await db.one(`SELECT status FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`, [c.id, req.user.id]);
  res.json({ id: c.id, name: c.name, description: c.description, avatar: fileUrl(c.avatar_file_id), memberCount: c.n, joinApproval: c.join_approval, myStatus: me?.status || null });
}));
r.post('/invites/group/:code/join', ah(async (req, res) => {
  const c = await db.one(`SELECT * FROM conversations WHERE invite_code=$1 AND type='group' AND removed_at IS NULL`, [str(req.params.code, { max: 40 })]);
  if (!c) throw err(404, 'Convite inválido ou expirado.');
  return joinGroup(req, res, c);
}));
// grupos públicos podem ser encontrados e acessados sem convite
r.post('/groups/:id/join', ah(async (req, res) => {
  const c = await db.one(`SELECT * FROM conversations WHERE id=$1 AND type='group' AND privacy='public' AND removed_at IS NULL`, [int(req.params.id, { min: 1 })]);
  if (!c) throw err(404, 'Grupo não encontrado.');
  return joinGroup(req, res, c);
}));
async function joinGroup(req, res, c) {
  const ex = await db.one(`SELECT status FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`, [c.id, req.user.id]);
  if (ex?.status === 'active') return res.json({ ok: true, conversationId: c.id, status: 'active' });
  if (ex?.status === 'removed') {
    const lastAction = await db.one(`SELECT action FROM member_history WHERE conversation_id=$1 AND user_id=$2 ORDER BY id DESC LIMIT 1`, [c.id, req.user.id]);
    if (lastAction?.action === 'removed') throw err(403, 'Você foi removido deste grupo e não pode entrar novamente pelo link.');
  }
  const status = c.join_approval ? 'pending' : 'active';
  await db.query(`INSERT INTO conversation_members (conversation_id, user_id, status) VALUES ($1,$2,$3)
    ON CONFLICT (conversation_id, user_id) DO UPDATE SET status=EXCLUDED.status, role='member', joined_at=now()`, [c.id, req.user.id, status]);
  await db.query(`INSERT INTO member_history (conversation_id, user_id, actor_id, action) VALUES ($1,$2,$2,$3)`, [c.id, req.user.id, status === 'active' ? 'joined_link' : 'requested']);
  if (status === 'active') {
    hub.joinConv(req.user.id, c.id);
    await systemMessage(c.id, `${req.user.display_name} entrou pelo link de convite`);
  } else await notifyGroupAdmins(c, req.user.id, 1);
  hub.toConv(c.id, 'conversation:update', { id: c.id });
  res.json({ ok: true, conversationId: c.id, status });
}

r.get('/groups/public', ah(async (req, res) => {
  const q = str(req.query.q, { max: 60, required: false }).replace(/[%_]/g, '');
  const rows = await db.many(`SELECT c.*, (SELECT count(*)::int FROM conversation_members m WHERE m.conversation_id=c.id AND m.status='active') AS n
    FROM conversations c WHERE c.type='group' AND c.privacy='public' AND c.removed_at IS NULL AND ($1='' OR c.name ILIKE '%'||$1||'%')
    ORDER BY n DESC LIMIT 30`, [q]);
  res.json(rows.map(c => ({ id: c.id, name: c.name, description: c.description, avatar: fileUrl(c.avatar_file_id), memberCount: c.n, joinApproval: c.join_approval })));
}));

// ===================== MENSAGENS =====================
async function visibleFloor(a) {
  return a.member ? a.member.cleared_before_id : 0;
}

r.get('/conversations/:id/messages', ah(async (req, res) => {
  const a = await conversationAccess(int(req.params.id, { min: 1 }), req.user.id);
  const limit = int(req.query.limit, { min: 1, max: 100, def: 50 });
  const floor = await visibleFloor(a);
  const params = [a.conv.id, floor, req.user.id, limit];
  let where = '';
  if (req.query.before) { params.push(int(req.query.before, { min: 1 })); where = `AND m.id < $${params.length}`; }
  let rows;
  if (req.query.around) {
    const around = int(req.query.around, { min: 1 });
    const older = await db.many(`SELECT m.* FROM messages m WHERE m.conversation_id=$1 AND m.id>$2 AND m.id<=$5
      AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.user_id=$3 AND h.message_id=m.id) ORDER BY m.id DESC LIMIT $4`, [...params, around]);
    const newer = await db.many(`SELECT m.* FROM messages m WHERE m.conversation_id=$1 AND m.id>$2 AND m.id>$5
      AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.user_id=$3 AND h.message_id=m.id) ORDER BY m.id ASC LIMIT $4`, [...params, around]);
    rows = [...older.reverse(), ...newer];
  } else {
    rows = (await db.many(`SELECT m.* FROM messages m WHERE m.conversation_id=$1 AND m.id>$2 ${where}
      AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.user_id=$3 AND h.message_id=m.id)
      ORDER BY m.id DESC LIMIT $4`, params)).reverse();
  }
  res.json({ messages: await serializeMessages(rows, req.user.id), hasMore: rows.length >= limit });
}));

r.post('/uploads', upload.array('files', 10), ah(async (req, res) => {
  if (!req.files?.length) throw err(400, 'Nenhum arquivo enviado.');
  const out = [];
  for (const f of req.files) out.push(await storeFile(f, req.user.id, 'message'));
  res.json(out);
}));

r.post('/conversations/:id/messages', ah(async (req, res) => {
  const a = await conversationAccess(int(req.params.id, { min: 1 }), req.user.id);
  if (!a.canSend) {
    if (a.blocked) throw err(403, 'Não é possível enviar mensagens para este usuário.');
    if (a.silenced) throw err(403, 'Você está silenciado neste grupo.');
    throw err(403, 'Você não tem permissão para enviar mensagens aqui.');
  }
  if (a.conv.type === 'dm') {
    const other = await db.one('SELECT * FROM users WHERE id=$1', [a.otherId]);
    const hasHistory = await db.one(`SELECT 1 FROM messages WHERE conversation_id=$1 AND sender_id=$2 LIMIT 1`, [a.conv.id, a.otherId]);
    if (!hasHistory) await assertCanMessage(req.user.id, other);
  }
  spamGuard(req.user.id);
  const maxLen = Number(await getSetting('max_message_length')) || 4000;
  const type = oneOf(req.body.type, ['text', 'sticker', 'gif', 'voice'], 'Tipo', 'text');
  const content = str(req.body.content, { name: 'Mensagem', max: maxLen, required: false, trim: type === 'text' ? false : true }).replace(/^\s+|\s+$/g, '');
  const fileIds = Array.isArray(req.body.fileIds) ? [...new Set(req.body.fileIds.map(String))].slice(0, 10) : [];
  let meta = {};
  if (type === 'sticker') {
    const st = await db.one('SELECT s.* FROM stickers s WHERE s.id=$1', [int(req.body.stickerId, { min: 1 })]);
    if (!st) throw err(404, 'Figurinha não encontrada.');
    meta = { stickerId: st.id, url: fileUrl(st.file_id) };
  } else if (type === 'gif') {
    const url = str(req.body.gifUrl, { name: 'GIF', min: 10, max: 500 });
    if (!/^https:\/\/(media\d*\.giphy\.com|i\.giphy\.com)\//.test(url)) throw err(400, 'GIF inválido.');
    meta = { url, width: int(req.body.width, { def: 0, min: 0, max: 4000 }), height: int(req.body.height, { def: 0, min: 0, max: 4000 }) };
  }
  if (fileIds.length) {
    if (!a.canSendMedia) throw err(403, 'Você não tem permissão para enviar arquivos aqui.');
    const files = await db.many(`SELECT f.id, f.kind FROM files f WHERE f.id = ANY($1::uuid[]) AND f.owner_id=$2 AND f.scope='message' AND f.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM message_attachments a WHERE a.file_id=f.id)`, [fileIds, req.user.id]);
    if (files.length !== fileIds.length) throw err(400, 'Arquivo inválido ou já utilizado.');
    if (type === 'voice' && (files.length !== 1 || files[0].kind !== 'audio')) throw err(400, 'Mensagem de voz inválida.');
    if (type === 'voice') meta = { duration: Number(req.body.duration) || 0 };
  }
  if (!content && !fileIds.length && type === 'text') throw err(400, 'Mensagem vazia.');
  let replyToId = null;
  if (req.body.replyToId) {
    const rep = await db.one('SELECT id FROM messages WHERE id=$1 AND conversation_id=$2', [int(req.body.replyToId, { min: 1 }), a.conv.id]);
    replyToId = rep?.id || null;
  }
  const msg = await createMessage({ convId: a.conv.id, senderId: req.user.id, type, content, replyToId, fileIds, meta, access: a });
  if (a.conv.type === 'channel') await markChannelRead(a.conv.id, req.user.id, msg.id);
  res.status(201).json(msg);
}));

async function messageWithAccess(req) {
  const m = await db.one('SELECT * FROM messages WHERE id=$1', [int(req.params.mid, { min: 1 })]);
  if (!m) throw err(404, 'Mensagem não encontrada.');
  const a = await conversationAccess(m.conversation_id, req.user.id);
  if (a.member && m.id <= a.member.cleared_before_id) throw err(404, 'Mensagem não encontrada.');
  return { m, a };
}

r.patch('/messages/:mid', ah(async (req, res) => {
  const { m, a } = await messageWithAccess(req);
  if (m.sender_id !== req.user.id) throw err(403, 'Você só pode editar suas próprias mensagens.');
  if (m.deleted_at || m.type !== 'text') throw err(400, 'Essa mensagem não pode ser editada.');
  const maxLen = Number(await getSetting('max_message_length')) || 4000;
  const content = str(req.body.content, { name: 'Mensagem', min: 1, max: maxLen });
  await db.query(`UPDATE messages SET content=$1, edited_at=now(), link_preview=NULL WHERE id=$2`, [content, m.id]);
  const out = await broadcast(a.conv.id, 'message:update', m.id);
  res.json(out);
}));

async function deleteForAll(m, a, actorId) {
  await db.query(`UPDATE messages SET deleted_at=now(), content='', link_preview=NULL WHERE id=$1`, [m.id]);
  await db.query(`UPDATE files SET deleted_at=now() WHERE id IN (SELECT file_id FROM message_attachments WHERE message_id=$1)`, [m.id]);
  await db.query(`DELETE FROM message_pins WHERE message_id=$1`, [m.id]);
  if (a.conv.type === 'channel' && m.sender_id !== actorId) {
    await db.query(`INSERT INTO community_audit (community_id, actor_id, action, target, data) VALUES ($1,$2,'message_deleted',$3,$4)`,
      [a.conv.community_id, actorId, String(m.id), { channelId: a.conv.id, authorId: m.sender_id }]);
  }
  await broadcast(a.conv.id, 'message:update', m.id);
}

r.delete('/messages/:mid', ah(async (req, res) => {
  const { m, a } = await messageWithAccess(req);
  const forAll = bool(req.query.forAll);
  if (forAll) {
    if (m.sender_id !== req.user.id && !a.canModerate) throw err(403, 'Você não pode apagar esta mensagem para todos.');
    await deleteForAll(m, a, req.user.id);
  } else {
    if (!a.member) throw err(400, 'Em canais só é possível apagar para todos.');
    await db.query(`INSERT INTO message_hidden (user_id, message_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [req.user.id, m.id]);
  }
  res.json({ ok: true });
}));

r.post('/messages/bulk-delete', ah(async (req, res) => {
  const ids = idArray(req.body.messageIds, 'Mensagens').slice(0, 100);
  const forAll = bool(req.body.forAll);
  let done = 0;
  for (const id of ids) {
    try {
      const { m, a } = await messageWithAccess({ ...req, params: { mid: id } });
      if (forAll) {
        if (m.sender_id !== req.user.id && !a.canModerate) continue;
        if (!m.deleted_at) await deleteForAll(m, a, req.user.id);
      } else {
        if (!a.member) continue;
        await db.query(`INSERT INTO message_hidden (user_id, message_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [req.user.id, m.id]);
      }
      done++;
    } catch { /* ignora mensagens sem acesso */ }
  }
  res.json({ ok: true, deleted: done });
}));

r.post('/messages/:mid/reactions', ah(async (req, res) => {
  const { m, a } = await messageWithAccess(req);
  if (m.deleted_at || m.type === 'system') throw err(400, 'Não é possível reagir a essa mensagem.');
  const emoji = str(req.body.emoji, { name: 'Emoji', min: 1, max: 16 });
  if (/[<>]/.test(emoji)) throw err(400, 'Emoji inválido.');
  const ex = await db.one('SELECT 1 FROM message_reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3', [m.id, req.user.id, emoji]);
  if (ex) await db.query('DELETE FROM message_reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3', [m.id, req.user.id, emoji]);
  else {
    const count = await db.one('SELECT count(DISTINCT emoji)::int AS n FROM message_reactions WHERE message_id=$1', [m.id]);
    if (count.n >= 20) throw err(400, 'Limite de reações atingido.');
    await db.query('INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1,$2,$3)', [m.id, req.user.id, emoji]);
    if (m.sender_id && m.sender_id !== req.user.id) {
      await notify(m.sender_id, 'reaction', req.user.id, { conversationId: a.conv.id, messageId: m.id, emoji, preview: m.content.slice(0, 80) });
    }
  }
  await broadcast(a.conv.id, 'message:update', m.id);
  res.json({ ok: true, added: !ex });
}));

r.post('/messages/:mid/pin', ah(async (req, res) => {
  const { m, a } = await messageWithAccess(req);
  if (!a.canPin) throw err(403, 'Você não pode fixar mensagens aqui.');
  if (m.deleted_at) throw err(400, 'Mensagem apagada.');
  const count = await db.one('SELECT count(*)::int AS n FROM message_pins WHERE conversation_id=$1', [a.conv.id]);
  if (count.n >= 50) throw err(400, 'Limite de 50 mensagens fixadas.');
  await db.query(`INSERT INTO message_pins (message_id, conversation_id, pinned_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [m.id, a.conv.id, req.user.id]);
  await systemMessage(a.conv.id, `${req.user.display_name} fixou uma mensagem`, { pinnedId: m.id });
  await broadcast(a.conv.id, 'message:update', m.id);
  res.json({ ok: true });
}));
r.delete('/messages/:mid/pin', ah(async (req, res) => {
  const { m, a } = await messageWithAccess(req);
  if (!a.canPin) throw err(403, 'Você não pode desafixar mensagens aqui.');
  await db.query('DELETE FROM message_pins WHERE message_id=$1', [m.id]);
  await broadcast(a.conv.id, 'message:update', m.id);
  res.json({ ok: true });
}));
r.get('/conversations/:id/pins', ah(async (req, res) => {
  const a = await conversationAccess(int(req.params.id, { min: 1 }), req.user.id);
  const rows = await db.many(`SELECT m.* FROM message_pins p JOIN messages m ON m.id=p.message_id WHERE p.conversation_id=$1 AND m.id>$2 ORDER BY p.pinned_at DESC`, [a.conv.id, await visibleFloor(a)]);
  res.json(await serializeMessages(rows, req.user.id));
}));

r.post('/messages/:mid/favorite', ah(async (req, res) => {
  const { m } = await messageWithAccess(req);
  const ex = await db.one('SELECT 1 FROM message_favorites WHERE user_id=$1 AND message_id=$2', [req.user.id, m.id]);
  if (ex) await db.query('DELETE FROM message_favorites WHERE user_id=$1 AND message_id=$2', [req.user.id, m.id]);
  else await db.query('INSERT INTO message_favorites (user_id, message_id) VALUES ($1,$2)', [req.user.id, m.id]);
  res.json({ favorite: !ex });
}));
r.get('/favorites', ah(async (req, res) => {
  const rows = await db.many(`SELECT m.* FROM message_favorites f JOIN messages m ON m.id=f.message_id WHERE f.user_id=$1 AND m.deleted_at IS NULL ORDER BY f.created_at DESC LIMIT 200`, [req.user.id]);
  const out = [];
  for (const m of rows) { try { await conversationAccess(m.conversation_id, req.user.id); out.push(m); } catch { /* perdeu acesso */ } }
  res.json(await serializeMessages(out, req.user.id));
}));

r.post('/messages/forward', ah(async (req, res) => {
  const msgIds = idArray(req.body.messageIds, 'Mensagens').slice(0, 20);
  const targets = idArray(req.body.conversationIds, 'Destinos').slice(0, 10);
  const sources = [];
  for (const id of msgIds) {
    const { m } = await messageWithAccess({ ...req, params: { mid: id } });
    if (!m.deleted_at && m.type !== 'system') sources.push(m);
  }
  let sent = 0;
  for (const cid of targets) {
    const a = await conversationAccess(cid, req.user.id);
    if (!a.canSend) continue;
    for (const m of sources) {
      spamGuard(req.user.id);
      const atts = await db.many(`SELECT f.* FROM message_attachments ma JOIN files f ON f.id=ma.file_id WHERE ma.message_id=$1 AND f.deleted_at IS NULL ORDER BY ma.position`, [m.id]);
      if (atts.length && !a.canSendMedia) continue;
      const newIds = [];
      for (const f of atts) {
        const copy = await db.one(`INSERT INTO files (owner_id, filename, mime, size, kind, scope, data) SELECT $1, filename, mime, size, kind, 'message', data FROM files WHERE id=$2 RETURNING id`, [req.user.id, f.id]);
        newIds.push(copy.id);
      }
      await createMessage({ convId: cid, senderId: req.user.id, type: m.type === 'story_reply' ? 'text' : m.type, content: m.content, fileIds: newIds, meta: m.meta, forwarded: true, access: a });
      sent++;
    }
  }
  res.json({ ok: true, sent });
}));

// ===================== CONFIRMAÇÕES / LEITURA =====================
async function markChannelRead(channelId, userId, msgId) {
  await db.query(`INSERT INTO channel_reads (channel_id, user_id, last_read_id) VALUES ($1,$2,$3)
    ON CONFLICT (channel_id, user_id) DO UPDATE SET last_read_id=GREATEST(channel_reads.last_read_id, EXCLUDED.last_read_id)`, [channelId, userId, msgId]);
}

r.post('/conversations/:id/read', ah(async (req, res) => {
  const a = await conversationAccess(int(req.params.id, { min: 1 }), req.user.id);
  const last = await db.one('SELECT coalesce(max(id),0) AS id FROM messages WHERE conversation_id=$1', [a.conv.id]);
  const upto = req.body.messageId ? Math.min(int(req.body.messageId, { min: 1 }), last.id) : last.id;
  if (a.conv.type === 'channel') { await markChannelRead(a.conv.id, req.user.id, upto); return res.json({ ok: true }); }
  await db.query(`UPDATE conversation_members SET last_read_id=GREATEST(last_read_id,$1), last_delivered_id=GREATEST(last_delivered_id,$1)
    WHERE conversation_id=$2 AND user_id=$3`, [upto, a.conv.id, req.user.id]);
  const priv = mergeDeep(DEFAULT_PRIVACY, req.user.privacy);
  hub.toConv(a.conv.id, 'receipt', { conversationId: a.conv.id, userId: req.user.id, lastReadId: priv.readReceipts ? upto : null, lastDeliveredId: upto });
  hub.toUser(req.user.id, 'conversation:read', { conversationId: a.conv.id, lastReadId: upto });
  await db.query(`UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL AND (data->>'conversationId')::bigint=$2`, [req.user.id, a.conv.id]);
  res.json({ ok: true });
}));

// ===================== PESQUISA E MÍDIA =====================
r.get('/conversations/:id/search', ah(async (req, res) => {
  const a = await conversationAccess(int(req.params.id, { min: 1 }), req.user.id);
  const q = str(req.query.q, { name: 'Busca', min: 1, max: 100 });
  const rows = await db.many(`SELECT m.* FROM messages m WHERE m.conversation_id=$1 AND m.id>$2 AND m.deleted_at IS NULL
      AND m.content ILIKE '%' || $3 || '%' AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.user_id=$4 AND h.message_id=m.id)
      ORDER BY m.id DESC LIMIT 50`, [a.conv.id, await visibleFloor(a), q.replace(/[%_\\]/g, '\\$&'), req.user.id]);
  res.json(await serializeMessages(rows, req.user.id));
}));

r.get('/conversations/:id/media', ah(async (req, res) => {
  const a = await conversationAccess(int(req.params.id, { min: 1 }), req.user.id);
  const kind = oneOf(req.query.kind, ['image', 'video', 'audio', 'document', 'media', 'all'], 'Tipo', 'all');
  const kinds = kind === 'all' ? ['image', 'video', 'audio', 'document'] : kind === 'media' ? ['image', 'video'] : [kind];
  const rows = await db.many(`SELECT f.id, f.filename, f.mime, f.size, f.kind, m.id AS message_id, m.created_at, m.sender_id
    FROM messages m JOIN message_attachments ma ON ma.message_id=m.id JOIN files f ON f.id=ma.file_id
    WHERE m.conversation_id=$1 AND m.id>$2 AND m.deleted_at IS NULL AND f.deleted_at IS NULL AND f.kind = ANY($3)
    ORDER BY m.id DESC LIMIT 200`, [a.conv.id, await visibleFloor(a), kinds]);
  res.json(rows.map(f => ({ id: f.id, url: fileUrl(f.id), name: f.filename, mime: f.mime, size: f.size, kind: f.kind, messageId: f.message_id, createdAt: f.created_at, senderId: f.sender_id })));
}));

// links compartilhados
r.get('/conversations/:id/links', ah(async (req, res) => {
  const a = await conversationAccess(int(req.params.id, { min: 1 }), req.user.id);
  const rows = await db.many(`SELECT id, content, link_preview, created_at FROM messages WHERE conversation_id=$1 AND id>$2 AND deleted_at IS NULL
    AND content ~* 'https?://' ORDER BY id DESC LIMIT 100`, [a.conv.id, await visibleFloor(a)]);
  res.json(rows.map(m => ({ messageId: m.id, url: (m.content.match(/https?:\/\/[^\s<>"']+/i) || [])[0], preview: m.link_preview, createdAt: m.created_at })));
}));

module.exports = { router: r, convSummary, markChannelRead, communityContext, canViewChannel, serializeOne, publicUser };
