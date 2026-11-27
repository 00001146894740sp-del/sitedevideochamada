const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const hub = require('../hub');
const { upload, storeFile } = require('../files');
const { notify, awardBadge, activity } = require('../notify');
const {
  ah, err, str, int, bool, oneOf, USERNAME_RE, publicUser, fileUrl,
  DEFAULT_SETTINGS, DEFAULT_PRIVACY, mergeDeep
} = require('../util');

const r = express.Router();

// presença visível para terceiros
function presenceFor(u, online) {
  const priv = mergeDeep(DEFAULT_PRIVACY, u.privacy);
  if (!online || u.presence === 'invisible' || !priv.showOnline) return 'offline';
  return u.presence;
}
async function withPresence(users) {
  const online = await hub.onlineSet(users.map(u => u.id));
  return users.map(u => ({ ...publicUser(u), customStatus: u.custom_status, presence: presenceFor(u, online.has(u.id)) }));
}

async function relation(me, otherId) {
  const [f, out, inc, bl, blBy] = await Promise.all([
    db.one('SELECT favorite FROM friends WHERE user_id=$1 AND friend_id=$2', [me, otherId]),
    db.one(`SELECT id FROM friend_requests WHERE from_id=$1 AND to_id=$2 AND status='pending'`, [me, otherId]),
    db.one(`SELECT id FROM friend_requests WHERE from_id=$2 AND to_id=$1 AND status='pending'`, [me, otherId]),
    db.one('SELECT 1 FROM blocks WHERE blocker_id=$1 AND blocked_id=$2', [me, otherId]),
    db.one('SELECT 1 FROM blocks WHERE blocker_id=$2 AND blocked_id=$1', [me, otherId])
  ]);
  return {
    friend: !!f, favorite: !!f?.favorite, outgoingRequestId: out?.id || null, incomingRequestId: inc?.id || null,
    blocked: !!bl, blockedMe: !!blBy
  };
}

// ===== Pesquisa de usuários =====
r.get('/users/search', ah(async (req, res) => {
  const q = str(req.query.q, { name: 'Busca', max: 50 });
  if (q.length < 1) return res.json([]);
  const rows = await db.many(
    `SELECT u.* FROM users u
      WHERE u.status='active' AND u.id<>$2
        AND (lower(u.username) LIKE lower($1) || '%' OR lower(u.display_name) LIKE '%' || lower($1) || '%')
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id=u.id AND b.blocked_id=$2)
      ORDER BY (lower(u.username)=lower($1)) DESC, length(u.username) LIMIT 20`, [q.replace(/[%_]/g, ''), req.user.id]);
  res.json(await withPresence(rows));
}));

// ===== Perfil =====
r.get('/users/:id', ah(async (req, res) => {
  const id = req.params.id === 'me' ? req.user.id : int(req.params.id, { name: 'Usuário', min: 1 });
  const u = await db.one(`SELECT * FROM users WHERE id=$1 AND status <> 'deleted'`, [id]);
  if (!u) throw err(404, 'Usuário não encontrado.');
  const rel = id === req.user.id ? null : await relation(req.user.id, id);
  if (rel?.blockedMe) throw err(404, 'Usuário não encontrado.');
  const priv = mergeDeep(DEFAULT_PRIVACY, u.privacy);
  const limited = id !== req.user.id && priv.profileVisibility === 'friends' && !rel.friend;
  const [badges, mutualFriends, mutualCommunities] = await Promise.all([
    db.many(`SELECT b.code, b.name, b.description, b.icon, b.special, ub.awarded_at FROM user_badges ub JOIN badges b ON b.code=ub.badge_code WHERE ub.user_id=$1 ORDER BY b.special DESC, ub.awarded_at`, [id]),
    id === req.user.id ? [] : db.many(`SELECT u.* FROM friends a JOIN friends b ON a.friend_id=b.friend_id JOIN users u ON u.id=a.friend_id WHERE a.user_id=$1 AND b.user_id=$2 LIMIT 12`, [req.user.id, id]),
    id === req.user.id ? [] : db.many(`SELECT c.id, c.name, c.logo_file_id FROM community_members a JOIN community_members b ON a.community_id=b.community_id JOIN communities c ON c.id=a.community_id WHERE a.user_id=$1 AND b.user_id=$2 AND c.removed_at IS NULL LIMIT 12`, [req.user.id, id])
  ]);
  const online = await hub.onlineSet([id]);
  const profile = {
    ...publicUser(u, { full: !limited }),
    presence: id === req.user.id ? u.presence : presenceFor(u, online.has(id)),
    badges, limited,
    relation: rel,
    mutualFriends: mutualFriends.map(x => publicUser(x)),
    mutualCommunities: mutualCommunities.map(c => ({ id: c.id, name: c.name, logo: fileUrl(c.logo_file_id) })),
    activityVisible: priv.activityVisible
  };
  if (limited) { profile.createdAt = u.created_at; profile.customStatus = ''; }
  res.json(profile);
}));

r.get('/users/:id/activity', ah(async (req, res) => {
  const id = int(req.params.id, { min: 1 });
  const u = await db.one('SELECT privacy FROM users WHERE id=$1', [id]);
  if (!u) throw err(404, 'Usuário não encontrado.');
  const priv = mergeDeep(DEFAULT_PRIVACY, u.privacy);
  if (id !== req.user.id && !priv.activityVisible) return res.json([]);
  if (id !== req.user.id && priv.profileVisibility === 'friends' && !(await db.one('SELECT 1 FROM friends WHERE user_id=$1 AND friend_id=$2', [req.user.id, id]))) return res.json([]);
  res.json(await db.many('SELECT type, data, created_at FROM user_activity WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30', [id]));
}));

r.patch('/users/me', ah(async (req, res) => {
  const b = req.body;
  const sets = []; const vals = [];
  const add = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
  if (b.displayName !== undefined) add('display_name', str(b.displayName, { name: 'Nome de exibição', min: 1, max: 40 }));
  if (b.bio !== undefined) add('bio', str(b.bio, { name: 'Biografia', max: 500, required: false }));
  if (b.customStatus !== undefined) add('custom_status', str(b.customStatus, { name: 'Status', max: 80, required: false }));
  if (b.profileColor !== undefined) {
    if (!/^#[0-9a-fA-F]{6}$/.test(b.profileColor)) throw err(400, 'Cor inválida.');
    add('profile_color', b.profileColor);
  }
  if (b.links !== undefined) {
    if (!Array.isArray(b.links) || b.links.length > 6) throw err(400, 'Até 6 links.');
    const links = b.links.map(l => {
      const label = str(l.label, { name: 'Rótulo', max: 30, required: false });
      const url = str(l.url, { name: 'Link', min: 8, max: 300 });
      if (!/^https:\/\//i.test(url)) throw err(400, 'Os links precisam começar com https://');
      return { label: label || new URL(url).hostname, url };
    });
    add('links', JSON.stringify(links));
  }
  if (b.username !== undefined) {
    const u = str(b.username, { name: 'Nome de usuário', min: 3, max: 24 });
    if (!USERNAME_RE.test(u)) throw err(400, 'Nome de usuário inválido.');
    const ex = await db.one('SELECT 1 FROM users WHERE lower(username)=lower($1) AND id<>$2', [u, req.user.id]);
    if (ex) throw err(409, 'Esse nome de usuário já está em uso.');
    add('username', u);
  }
  if (!sets.length) return res.json({ ok: true });
  vals.push(req.user.id);
  const u = await db.one(`UPDATE users SET ${sets.join(', ')} WHERE id=$${vals.length} RETURNING *`, vals);
  if (b.bio !== undefined || b.customStatus !== undefined) await activity(req.user.id, 'profile_updated');
  broadcastProfile(u);
  res.json(publicUser(u, { full: true }));
}));

async function broadcastProfile(u) {
  const friends = await db.many('SELECT friend_id FROM friends WHERE user_id=$1', [u.id]);
  const payload = { ...publicUser(u), customStatus: u.custom_status };
  hub.toUsers([u.id, ...friends.map(f => f.friend_id)], 'user:update', payload);
}

for (const kind of ['avatar', 'banner']) {
  r.post(`/users/me/${kind}`, upload.single('file'), ah(async (req, res) => {
    if (!req.file) throw err(400, 'Envie uma imagem.');
    const f = await storeFile(req.file, req.user.id, 'public', { allowKinds: ['image'] });
    const u = await db.one(`UPDATE users SET ${kind}_file_id=$1 WHERE id=$2 RETURNING *`, [f.id, req.user.id]);
    broadcastProfile(u);
    res.json({ url: f.url });
  }));
  r.delete(`/users/me/${kind}`, ah(async (req, res) => {
    const u = await db.one(`UPDATE users SET ${kind}_file_id=NULL WHERE id=$1 RETURNING *`, [req.user.id]);
    broadcastProfile(u);
    res.json({ ok: true });
  }));
}

r.patch('/users/me/presence', ah(async (req, res) => {
  const p = oneOf(req.body.presence, ['online', 'away', 'busy', 'invisible'], 'Status');
  await db.query('UPDATE users SET presence=$1 WHERE id=$2', [p, req.user.id]);
  await emitPresence(req.user.id);
  res.json({ ok: true });
}));

async function emitPresence(userId) {
  const u = await db.one('SELECT * FROM users WHERE id=$1', [userId]);
  const online = await hub.onlineSet([userId]);
  const friends = await db.many('SELECT friend_id FROM friends WHERE user_id=$1', [userId]);
  hub.toUsers(friends.map(f => f.friend_id), 'presence', { userId, presence: presenceFor(u, online.has(userId)) });
  hub.toUser(userId, 'presence', { userId, presence: online.has(userId) ? u.presence : 'offline', self: true });
}

r.patch('/users/me/settings', ah(async (req, res) => {
  const s = req.body || {};
  const cur = mergeDeep(DEFAULT_SETTINGS, req.user.settings);
  const next = { ...cur };
  if (s.theme !== undefined) next.theme = oneOf(s.theme, ['dark', 'midnight', 'light'], 'Tema');
  if (s.accent !== undefined) { if (!/^#[0-9a-fA-F]{6}$/.test(s.accent)) throw err(400, 'Cor inválida.'); next.accent = s.accent; }
  if (s.chatBg !== undefined) next.chatBg = oneOf(s.chatBg, ['aurora', 'nebula', 'grid', 'plain', 'gold'], 'Fundo');
  if (s.bubbleStyle !== undefined) next.bubbleStyle = oneOf(s.bubbleStyle, ['rounded', 'square', 'minimal'], 'Estilo');
  if (s.fontScale !== undefined) { const f = Number(s.fontScale); if (!(f >= 0.8 && f <= 1.4)) throw err(400, 'Tamanho inválido.'); next.fontScale = f; }
  for (const k of ['compact', 'sounds', 'reduceMotion', 'highContrast']) if (s[k] !== undefined) next[k] = bool(s[k]);
  if (s.emojiFavorites !== undefined) {
    if (!Array.isArray(s.emojiFavorites) || s.emojiFavorites.length > 24) throw err(400, 'Favoritos inválidos.');
    next.emojiFavorites = s.emojiFavorites.map(e => str(e, { max: 16 })).filter(Boolean);
  }
  if (s.notifications) {
    next.notifications = { ...cur.notifications };
    for (const k of Object.keys(DEFAULT_SETTINGS.notifications)) if (s.notifications[k] !== undefined) next.notifications[k] = bool(s.notifications[k]);
  }
  await db.query('UPDATE users SET settings=$1 WHERE id=$2', [next, req.user.id]);
  res.json(next);
}));

r.patch('/users/me/privacy', ah(async (req, res) => {
  const s = req.body || {};
  const next = mergeDeep(DEFAULT_PRIVACY, req.user.privacy);
  if (s.whoCanMessage !== undefined) next.whoCanMessage = oneOf(s.whoCanMessage, ['everyone', 'friends', 'nobody'], 'Opção');
  if (s.whoCanAdd !== undefined) next.whoCanAdd = oneOf(s.whoCanAdd, ['everyone', 'friends_of_friends', 'nobody'], 'Opção');
  if (s.profileVisibility !== undefined) next.profileVisibility = oneOf(s.profileVisibility, ['everyone', 'friends'], 'Opção');
  for (const k of ['showOnline', 'readReceipts', 'activityVisible']) if (s[k] !== undefined) next[k] = bool(s[k]);
  await db.query('UPDATE users SET privacy=$1 WHERE id=$2', [next, req.user.id]);
  if (s.showOnline !== undefined) await emitPresence(req.user.id);
  res.json(next);
}));

// ===== Dados pessoais =====
r.get('/users/me/export', ah(async (req, res) => {
  const id = req.user.id;
  const [user, friends, msgs, sessions, logins, stories] = await Promise.all([
    db.one(`SELECT id, username, email, display_name, bio, custom_status, links, created_at, settings, privacy FROM users WHERE id=$1`, [id]),
    db.many(`SELECT u.username, f.created_at FROM friends f JOIN users u ON u.id=f.friend_id WHERE f.user_id=$1`, [id]),
    db.many(`SELECT conversation_id, content, created_at, edited_at FROM messages WHERE sender_id=$1 AND deleted_at IS NULL ORDER BY id LIMIT 50000`, [id]),
    db.many(`SELECT ip, user_agent, created_at, last_seen_at FROM sessions WHERE user_id=$1`, [id]),
    db.many(`SELECT method, success, ip, created_at FROM login_history WHERE user_id=$1 ORDER BY id DESC LIMIT 500`, [id]),
    db.many(`SELECT type, text, created_at FROM stories WHERE user_id=$1`, [id])
  ]);
  res.setHeader('Content-Disposition', `attachment; filename="newgg-dados-${user.username}.json"`);
  res.json({ exportedAt: new Date(), user, friends, messages: msgs, sessions, logins, stories });
}));

r.post('/users/me/delete-request', ah(async (req, res) => {
  if (req.user.global_role === 'owner') throw err(400, 'O dono da plataforma não pode excluir a própria conta.');
  if (req.user.password_hash) {
    const p = str(req.body.password, { name: 'Senha', min: 1, max: 128, trim: false });
    if (!await bcrypt.compare(p, req.user.password_hash)) throw err(400, 'Senha incorreta.');
  } else if (req.body.confirm !== req.user.username) {
    throw err(400, 'Digite seu nome de usuário para confirmar.');
  }
  await db.query('UPDATE users SET deletion_requested_at=now() WHERE id=$1', [req.user.id]);
  res.json({ ok: true, message: 'Exclusão agendada para daqui a 7 dias. Você pode cancelar até lá nas configurações.' });
}));
r.post('/users/me/delete-cancel', ah(async (req, res) => {
  await db.query('UPDATE users SET deletion_requested_at=NULL WHERE id=$1', [req.user.id]);
  res.json({ ok: true });
}));

// ===== Amigos =====
r.get('/friends', ah(async (req, res) => {
  const rows = await db.many(`SELECT u.*, f.favorite, f.created_at AS since FROM friends f JOIN users u ON u.id=f.friend_id
    WHERE f.user_id=$1 AND u.status <> 'deleted' ORDER BY f.favorite DESC, lower(u.display_name)`, [req.user.id]);
  const list = await withPresence(rows);
  res.json(list.map((x, i) => ({ ...x, favorite: rows[i].favorite, since: rows[i].since })));
}));

r.get('/friends/requests', ah(async (req, res) => {
  const load = async (mineCol, otherCol) => {
    const rows = await db.many(`SELECT id, ${otherCol} AS uid, created_at FROM friend_requests WHERE ${mineCol}=$1 AND status='pending' ORDER BY created_at DESC`, [req.user.id]);
    const users = await db.many('SELECT * FROM users WHERE id = ANY($1)', [rows.map(i => i.uid)]);
    return rows.map(i => ({ requestId: i.id, createdAt: i.created_at, user: publicUser(users.find(u => u.id === i.uid)) }));
  };
  res.json({ incoming: await load('to_id', 'from_id'), outgoing: await load('from_id', 'to_id') });
}));

async function makeFriends(a, b) {
  await db.query(`INSERT INTO friends (user_id, friend_id) VALUES ($1,$2),($2,$1) ON CONFLICT DO NOTHING`, [a, b]);
  for (const id of [a, b]) {
    const n = await db.one('SELECT count(*)::int AS n FROM friends WHERE user_id=$1', [id]);
    if (n.n >= 5) await awardBadge(id, 'social');
  }
}

r.post('/friends/requests', ah(async (req, res) => {
  let target;
  if (req.body.userId) target = await db.one(`SELECT * FROM users WHERE id=$1 AND status='active'`, [int(req.body.userId, { min: 1 })]);
  else {
    const name = str(req.body.username, { name: 'Nome de usuário', min: 3, max: 24 });
    target = await db.one(`SELECT * FROM users WHERE lower(username)=lower($1) AND status='active'`, [name]);
  }
  if (!target) throw err(404, 'Usuário não encontrado.');
  if (target.id === req.user.id) throw err(400, 'Você não pode adicionar a si mesmo.');
  const rel = await relation(req.user.id, target.id);
  if (rel.blockedMe || rel.blocked) throw err(403, 'Não é possível enviar a solicitação.');
  if (rel.friend) throw err(409, 'Vocês já são amigos.');
  if (rel.outgoingRequestId) throw err(409, 'Solicitação já enviada.');
  if (rel.incomingRequestId) { // aceita automaticamente se o outro já pediu
    await acceptRequest(rel.incomingRequestId, req.user.id);
    return res.json({ ok: true, accepted: true });
  }
  const priv = mergeDeep(DEFAULT_PRIVACY, target.privacy);
  if (priv.whoCanAdd === 'nobody') throw err(403, 'Esse usuário não aceita solicitações de amizade.');
  if (priv.whoCanAdd === 'friends_of_friends') {
    const m = await db.one(`SELECT 1 FROM friends a JOIN friends b ON a.friend_id=b.friend_id WHERE a.user_id=$1 AND b.user_id=$2 LIMIT 1`, [req.user.id, target.id]);
    if (!m) throw err(403, 'Esse usuário só aceita solicitações de amigos de amigos.');
  }
  const fr = await db.one(`INSERT INTO friend_requests (from_id, to_id) VALUES ($1,$2) RETURNING id`, [req.user.id, target.id]);
  await notify(target.id, 'friend_request', req.user.id, { requestId: fr.id });
  hub.toUser(target.id, 'friends:changed', {});
  res.json({ ok: true, requestId: fr.id });
}));

async function acceptRequest(id, userId) {
  const fr = await db.one(`UPDATE friend_requests SET status='accepted', responded_at=now() WHERE id=$1 AND to_id=$2 AND status='pending' RETURNING *`, [id, userId]);
  if (!fr) throw err(404, 'Solicitação não encontrada.');
  await makeFriends(fr.from_id, fr.to_id);
  await notify(fr.from_id, 'friend_accept', userId, {});
  await activity(userId, 'friend_added', {});
  hub.toUsers([fr.from_id, fr.to_id], 'friends:changed', {});
  return fr;
}

r.post('/friends/requests/:id/accept', ah(async (req, res) => {
  await acceptRequest(int(req.params.id, { min: 1 }), req.user.id);
  res.json({ ok: true });
}));
r.post('/friends/requests/:id/decline', ah(async (req, res) => {
  const fr = await db.one(`UPDATE friend_requests SET status='declined', responded_at=now() WHERE id=$1 AND to_id=$2 AND status='pending' RETURNING *`, [int(req.params.id, { min: 1 }), req.user.id]);
  if (!fr) throw err(404, 'Solicitação não encontrada.');
  hub.toUsers([fr.from_id, fr.to_id], 'friends:changed', {});
  res.json({ ok: true });
}));
r.delete('/friends/requests/:id', ah(async (req, res) => {
  const fr = await db.one(`UPDATE friend_requests SET status='cancelled', responded_at=now() WHERE id=$1 AND from_id=$2 AND status='pending' RETURNING *`, [int(req.params.id, { min: 1 }), req.user.id]);
  if (fr) hub.toUsers([fr.from_id, fr.to_id], 'friends:changed', {});
  res.json({ ok: true });
}));
r.delete('/friends/:userId', ah(async (req, res) => {
  const other = int(req.params.userId, { min: 1 });
  await db.query(`DELETE FROM friends WHERE (user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)`, [req.user.id, other]);
  hub.toUsers([req.user.id, other], 'friends:changed', {});
  res.json({ ok: true });
}));
r.patch('/friends/:userId', ah(async (req, res) => {
  await db.query(`UPDATE friends SET favorite=$1 WHERE user_id=$2 AND friend_id=$3`, [bool(req.body.favorite), req.user.id, int(req.params.userId, { min: 1 })]);
  res.json({ ok: true });
}));

r.get('/friends/suggestions', ah(async (req, res) => {
  const rows = await db.many(`
    WITH mine AS (SELECT friend_id FROM friends WHERE user_id=$1),
    cands AS (
      SELECT f.friend_id AS id, count(*)*2 AS score FROM friends f WHERE f.user_id IN (SELECT friend_id FROM mine) GROUP BY f.friend_id
      UNION ALL
      SELECT b.user_id, count(*) FROM community_members a JOIN community_members b ON a.community_id=b.community_id WHERE a.user_id=$1 GROUP BY b.user_id
    )
    SELECT u.*, sum(c.score) AS score FROM cands c JOIN users u ON u.id=c.id
     WHERE c.id<>$1 AND u.status='active' AND c.id NOT IN (SELECT friend_id FROM mine)
       AND NOT EXISTS (SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=u.id) OR (blocker_id=u.id AND blocked_id=$1))
       AND NOT EXISTS (SELECT 1 FROM friend_requests WHERE status='pending' AND ((from_id=$1 AND to_id=u.id) OR (from_id=u.id AND to_id=$1)))
     GROUP BY u.id ORDER BY score DESC LIMIT 10`, [req.user.id]);
  res.json(await withPresence(rows));
}));

// ===== Bloqueios =====
r.get('/blocks', ah(async (req, res) => {
  const rows = await db.many(`SELECT u.* FROM blocks b JOIN users u ON u.id=b.blocked_id WHERE b.blocker_id=$1 ORDER BY b.created_at DESC`, [req.user.id]);
  res.json(rows.map(u => publicUser(u)));
}));
r.post('/blocks/:userId', ah(async (req, res) => {
  const other = int(req.params.userId, { min: 1 });
  if (other === req.user.id) throw err(400, 'Você não pode bloquear a si mesmo.');
  await db.query(`INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [req.user.id, other]);
  await db.query(`DELETE FROM friends WHERE (user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)`, [req.user.id, other]);
  await db.query(`UPDATE friend_requests SET status='cancelled' WHERE status='pending' AND ((from_id=$1 AND to_id=$2) OR (from_id=$2 AND to_id=$1))`, [req.user.id, other]);
  hub.toUsers([req.user.id, other], 'friends:changed', {});
  res.json({ ok: true });
}));
r.delete('/blocks/:userId', ah(async (req, res) => {
  await db.query(`DELETE FROM blocks WHERE blocker_id=$1 AND blocked_id=$2`, [req.user.id, int(req.params.userId, { min: 1 })]);
  res.json({ ok: true });
}));

module.exports = { router: r, presenceFor, withPresence, emitPresence, relation };
