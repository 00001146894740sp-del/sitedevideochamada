const express = require('express');
const db = require('../db');
const hub = require('../hub');
const { upload, storeFile } = require('../files');
const { P, ALL, DEFAULT_EVERYONE, PERM_LABELS, communityContext, canViewChannel } = require('../permissions');
const { notify, awardBadge, activity } = require('../notify');
const { systemMessage } = require('../messages');
const { withPresence } = require('./users');
const { ah, err, str, int, bool, oneOf, idArray, randomToken, publicUser, fileUrl } = require('../util');

const r = express.Router();
const CATEGORIES = ['geral', 'conversas', 'anuncios', 'suporte', 'midia', 'memes', 'noticias', 'privado'];

async function audit(communityId, actorId, action, target, data = {}) {
  await db.query(`INSERT INTO community_audit (community_id, actor_id, action, target, data) VALUES ($1,$2,$3,$4,$5)`,
    [communityId, actorId, action, target == null ? null : String(target), data]);
}
function need(ctx, bit, msg = 'Você não tem permissão para isso.') {
  if (!ctx.member) throw err(403, 'Você não é membro desta comunidade.');
  if (!ctx.has(bit)) throw err(403, msg);
}
async function ctxFor(req, param = 'id') {
  return communityContext(int(req.params[param], { min: 1 }), req.user.id);
}
async function resyncMembers(communityId) {
  const ms = await db.many('SELECT user_id FROM community_members WHERE community_id=$1', [communityId]);
  for (const m of ms) hub.resync?.(m.user_id);
  hub.toUsers(ms.map(m => m.user_id), 'community:update', { id: communityId });
}

function serializeCommunity(c, extra = {}) {
  return { id: c.id, name: c.name, description: c.description, logo: fileUrl(c.logo_file_id), banner: fileUrl(c.banner_file_id), ownerId: c.owner_id, isPublic: c.is_public, createdAt: c.created_at, ...extra };
}

r.get('/communities', ah(async (req, res) => {
  const rows = await db.many(`SELECT c.*, (SELECT count(*)::int FROM community_members x WHERE x.community_id=c.id) AS n
    FROM community_members m JOIN communities c ON c.id=m.community_id WHERE m.user_id=$1 AND c.removed_at IS NULL ORDER BY m.joined_at`, [req.user.id]);
  const out = [];
  for (const c of rows) {
    const ctx = await communityContext(c.id, req.user.id);
    const chans = await db.many(`SELECT ch.*, coalesce(cr.last_read_id,0) AS lr,
        (SELECT coalesce(max(id),0) FROM messages m WHERE m.conversation_id=ch.id AND m.deleted_at IS NULL AND m.sender_id IS DISTINCT FROM $2) AS last_id
      FROM conversations ch LEFT JOIN channel_reads cr ON cr.channel_id=ch.id AND cr.user_id=$2
      WHERE ch.community_id=$1 AND ch.removed_at IS NULL`, [c.id, req.user.id]);
    let unread = false;
    for (const ch of chans) if (ch.last_id > ch.lr && await canViewChannel(ch, ctx)) { unread = true; break; }
    out.push(serializeCommunity(c, { memberCount: c.n, unread }));
  }
  res.json(out);
}));

r.get('/communities/discover', ah(async (req, res) => {
  const q = str(req.query.q, { max: 60, required: false }).replace(/[%_]/g, '');
  const rows = await db.many(`SELECT c.*, (SELECT count(*)::int FROM community_members x WHERE x.community_id=c.id) AS n,
      EXISTS (SELECT 1 FROM community_members x WHERE x.community_id=c.id AND x.user_id=$2) AS joined
    FROM communities c WHERE c.is_public AND c.removed_at IS NULL AND ($1='' OR c.name ILIKE '%'||$1||'%' OR c.description ILIKE '%'||$1||'%')
    ORDER BY n DESC, c.created_at DESC LIMIT 40`, [q, req.user.id]);
  res.json(rows.map(c => serializeCommunity(c, { memberCount: c.n, joined: c.joined })));
}));

r.post('/communities', ah(async (req, res) => {
  const name = str(req.body.name, { name: 'Nome', min: 2, max: 60 });
  const description = str(req.body.description, { name: 'Descrição', max: 1000, required: false });
  const isPublic = bool(req.body.isPublic, true);
  const owned = await db.one('SELECT count(*)::int AS n FROM communities WHERE owner_id=$1 AND removed_at IS NULL', [req.user.id]);
  if (owned.n >= 25) throw err(400, 'Limite de 25 comunidades por usuário.');
  const c = await db.tx(async t => {
    const c = await t.one(`INSERT INTO communities (name, description, owner_id, is_public) VALUES ($1,$2,$3,$4) RETURNING *`, [name, description, req.user.id, isPublic]);
    await t.query(`INSERT INTO community_roles (community_id, name, permissions, position, is_default, color) VALUES ($1,'@todos',$2,0,true,'#b9a6d9')`, [c.id, DEFAULT_EVERYONE]);
    await t.query(`INSERT INTO community_roles (community_id, name, permissions, position, color) VALUES ($1,'Administração',$2,3,'#f5c542')`, [c.id, P.ADMINISTRATOR]);
    await t.query(`INSERT INTO community_roles (community_id, name, permissions, position, color) VALUES ($1,'Moderação',$2,2,'#9d4dff')`,
      [c.id, DEFAULT_EVERYONE | P.MANAGE_MESSAGES | P.KICK_MEMBERS | P.VIEW_AUDIT_LOG | P.HANDLE_REPORTS | P.POST_ANNOUNCEMENTS]);
    await t.query(`INSERT INTO community_members (community_id, user_id) VALUES ($1,$2)`, [c.id, req.user.id]);
    const defaults = [['boas-vindas', 'geral', 0], ['avisos', 'anuncios', 1], ['bate-papo', 'conversas', 2], ['mídia', 'midia', 3], ['memes', 'memes', 4]];
    for (const [n, cat, pos] of defaults) {
      await t.query(`INSERT INTO conversations (type, name, community_id, category, position, owner_id) VALUES ('channel',$1,$2,$3,$4,$5)`, [n, c.id, cat, pos, req.user.id]);
    }
    await t.query(`INSERT INTO community_audit (community_id, actor_id, action) VALUES ($1,$2,'community_created')`, [c.id, req.user.id]);
    return c;
  });
  await awardBadge(req.user.id, 'founder');
  await activity(req.user.id, 'community_created', { name });
  hub.resync?.(req.user.id);
  res.status(201).json(serializeCommunity(c));
}));

r.get('/communities/:id', ah(async (req, res) => {
  const ctx = await ctxFor(req);
  const c = ctx.community;
  if (!ctx.member && !c.is_public) throw err(403, 'Comunidade privada.');
  const banned = await db.one('SELECT 1 FROM community_bans WHERE community_id=$1 AND user_id=$2', [c.id, req.user.id]);
  const count = await db.one('SELECT count(*)::int AS n FROM community_members WHERE community_id=$1', [c.id]);
  const base = serializeCommunity(c, { memberCount: count.n, isMember: !!ctx.member, banned: !!banned, isOwner: ctx.isOwner, perms: ctx.perms, permBits: P, permLabels: PERM_LABELS });
  if (!ctx.member) return res.json(base);
  const chans = await db.many(`SELECT ch.*, coalesce(cr.last_read_id,0) AS lr,
      (SELECT coalesce(max(id),0) FROM messages m WHERE m.conversation_id=ch.id AND m.deleted_at IS NULL AND m.sender_id IS DISTINCT FROM $2) AS last_id,
      (SELECT array_agg(role_id) FROM channel_roles WHERE channel_id=ch.id) AS role_ids
    FROM conversations ch LEFT JOIN channel_reads cr ON cr.channel_id=ch.id AND cr.user_id=$2
    WHERE ch.community_id=$1 AND ch.removed_at IS NULL ORDER BY ch.position, ch.id`, [c.id, req.user.id]);
  const channels = [];
  for (const ch of chans) {
    if (!await canViewChannel(ch, ctx)) continue;
    channels.push({ id: ch.id, name: ch.name, category: ch.category, isPrivate: ch.is_private, topic: ch.topic, position: ch.position, unread: ch.last_id > ch.lr, roleIds: ch.role_ids || [] });
  }
  const roles = await db.many('SELECT * FROM community_roles WHERE community_id=$1 ORDER BY position DESC, id', [c.id]);
  res.json({
    ...base, channels,
    roles: roles.map(r => ({ id: r.id, name: r.name, color: r.color, permissions: Number(r.permissions), position: r.position, isDefault: r.is_default })),
    myRoleIds: ctx.roleIds, myTopPosition: ctx.topPosition === Infinity ? 9999 : ctx.topPosition
  });
}));

r.patch('/communities/:id', ah(async (req, res) => {
  const ctx = await ctxFor(req);
  need(ctx, P.MANAGE_COMMUNITY);
  const b = req.body; const sets = []; const vals = [];
  const add = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
  if (b.name !== undefined) add('name', str(b.name, { name: 'Nome', min: 2, max: 60 }));
  if (b.description !== undefined) add('description', str(b.description, { name: 'Descrição', max: 1000, required: false }));
  if (b.isPublic !== undefined) add('is_public', bool(b.isPublic));
  if (!sets.length) return res.json({ ok: true });
  vals.push(ctx.community.id);
  await db.query(`UPDATE communities SET ${sets.join(',')} WHERE id=$${vals.length}`, vals);
  await audit(ctx.community.id, req.user.id, 'community_updated', null, b);
  await resyncMembers(ctx.community.id);
  res.json({ ok: true });
}));

for (const kind of ['logo', 'banner']) {
  r.post(`/communities/:id/${kind}`, upload.single('file'), ah(async (req, res) => {
    const ctx = await ctxFor(req);
    need(ctx, P.MANAGE_COMMUNITY);
    if (!req.file) throw err(400, 'Envie uma imagem.');
    const f = await storeFile(req.file, req.user.id, 'public', { allowKinds: ['image'] });
    await db.query(`UPDATE communities SET ${kind}_file_id=$1 WHERE id=$2`, [f.id, ctx.community.id]);
    await audit(ctx.community.id, req.user.id, `${kind}_updated`);
    await resyncMembers(ctx.community.id);
    res.json({ url: f.url });
  }));
}

r.delete('/communities/:id', ah(async (req, res) => {
  const ctx = await ctxFor(req);
  if (!ctx.isOwner) throw err(403, 'Apenas o proprietário pode excluir a comunidade.');
  if (str(req.body?.confirm, { max: 60, required: false }) !== ctx.community.name) throw err(400, 'Digite o nome da comunidade para confirmar.');
  const members = await db.many('SELECT user_id FROM community_members WHERE community_id=$1', [ctx.community.id]);
  await db.query('UPDATE communities SET removed_at=now() WHERE id=$1', [ctx.community.id]);
  for (const m of members) { hub.resync?.(m.user_id); hub.toUser(m.user_id, 'community:removed', { id: ctx.community.id }); }
  res.json({ ok: true });
}));

// ===== Entrar / sair =====
async function joinCommunity(req, c) {
  const banned = await db.one('SELECT 1 FROM community_bans WHERE community_id=$1 AND user_id=$2', [c.id, req.user.id]);
  if (banned) throw err(403, 'Você foi banido desta comunidade.');
  const r0 = await db.query('INSERT INTO community_members (community_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [c.id, req.user.id]);
  if (r0.rowCount) {
    await audit(c.id, req.user.id, 'member_joined', req.user.id);
    const welcome = await db.one(`SELECT id FROM conversations WHERE community_id=$1 AND category='geral' AND NOT is_private AND removed_at IS NULL ORDER BY position LIMIT 1`, [c.id]);
    hub.resync?.(req.user.id);
    if (welcome) await systemMessage(welcome.id, `👋 ${req.user.display_name} entrou na comunidade!`);
  }
}
r.post('/communities/:id/join', ah(async (req, res) => {
  const ctx = await ctxFor(req);
  if (!ctx.community.is_public) throw err(403, 'Esta comunidade é privada. Use um convite.');
  await joinCommunity(req, ctx.community);
  res.json({ ok: true });
}));
r.post('/communities/:id/leave', ah(async (req, res) => {
  const ctx = await ctxFor(req);
  if (ctx.isOwner) throw err(400, 'Transfira a propriedade antes de sair.');
  await db.query('DELETE FROM community_members WHERE community_id=$1 AND user_id=$2', [ctx.community.id, req.user.id]);
  await audit(ctx.community.id, req.user.id, 'member_left', req.user.id);
  hub.resync?.(req.user.id);
  res.json({ ok: true });
}));
r.post('/communities/:id/transfer', ah(async (req, res) => {
  const ctx = await ctxFor(req);
  if (!ctx.isOwner) throw err(403, 'Apenas o proprietário pode transferir.');
  const to = int(req.body.userId, { min: 1 });
  const m = await db.one('SELECT 1 FROM community_members WHERE community_id=$1 AND user_id=$2', [ctx.community.id, to]);
  if (!m) throw err(404, 'O novo proprietário precisa ser membro.');
  await db.query('UPDATE communities SET owner_id=$1 WHERE id=$2', [to, ctx.community.id]);
  await audit(ctx.community.id, req.user.id, 'ownership_transferred', to);
  await resyncMembers(ctx.community.id);
  res.json({ ok: true });
}));

// ===== Membros =====
r.get('/communities/:id/members', ah(async (req, res) => {
  const ctx = await ctxFor(req);
  if (!ctx.member) throw err(403, 'Você não é membro.');
  const q = str(req.query.q, { max: 40, required: false }).replace(/[%_]/g, '');
  const rows = await db.many(`SELECT u.*, m.nickname, m.joined_at,
      (SELECT array_agg(role_id) FROM community_member_roles r WHERE r.community_id=m.community_id AND r.user_id=m.user_id) AS role_ids
    FROM community_members m JOIN users u ON u.id=m.user_id
    WHERE m.community_id=$1 AND ($2='' OR u.username ILIKE $2||'%' OR u.display_name ILIKE '%'||$2||'%')
    ORDER BY lower(u.display_name) LIMIT 500`, [ctx.community.id, q]);
  const pres = await withPresence(rows);
  res.json(rows.map((m, i) => ({ ...pres[i], nickname: m.nickname, joinedAt: m.joined_at, roleIds: m.role_ids || [], isOwner: m.id === Number(ctx.community.owner_id) })));
}));

async function memberTop(communityId, userId, ownerId) {
  if (Number(ownerId) === userId) return Infinity;
  const r0 = await db.one(`SELECT coalesce(max(r.position),-1) AS p FROM community_member_roles mr JOIN community_roles r ON r.id=mr.role_id WHERE mr.community_id=$1 AND mr.user_id=$2`, [communityId, userId]);
  return r0.p;
}

r.put('/communities/:id/members/:userId/roles', ah(async (req, res) => {
  const ctx = await ctxFor(req);
  need(ctx, P.MANAGE_ROLES);
  const target = int(req.params.userId, { min: 1 });
  const isMember = await db.one('SELECT 1 FROM community_members WHERE community_id=$1 AND user_id=$2', [ctx.community.id, target]);
  if (!isMember) throw err(404, 'Membro não encontrado.');
  if (target !== req.user.id && await memberTop(ctx.community.id, target, ctx.community.owner_id) >= ctx.topPosition) throw err(403, 'Você não pode alterar cargos de alguém com cargo igual ou superior.');
  const roleIds = idArray(req.body.roleIds || [], 'Cargos');
  const roles = await db.many('SELECT * FROM community_roles WHERE community_id=$1 AND id = ANY($2) AND NOT is_default', [ctx.community.id, roleIds]);
  if (roles.some(r0 => r0.position >= ctx.topPosition)) throw err(403, 'Você só pode atribuir cargos abaixo do seu.');
  // preserva cargos acima do meu que a pessoa já tinha
  const keep = await db.many(`SELECT mr.role_id FROM community_member_roles mr JOIN community_roles r0 ON r0.id=mr.role_id
    WHERE mr.community_id=$1 AND mr.user_id=$2 AND r0.position >= $3`, [ctx.community.id, target, ctx.topPosition === Infinity ? 1e9 : ctx.topPosition]);
  await db.tx(async t => {
    await t.query('DELETE FROM community_member_roles WHERE community_id=$1 AND user_id=$2', [ctx.community.id, target]);
    for (const id of new Set([...roles.map(x => x.id), ...keep.map(k => k.role_id)])) {
      await t.query('INSERT INTO community_member_roles (community_id, user_id, role_id) VALUES ($1,$2,$3)', [ctx.community.id, target, id]);
    }
  });
  await audit(ctx.community.id, req.user.id, 'member_roles_updated', target, { roles: roles.map(x => x.name) });
  hub.resync?.(target);
  hub.toUser(target, 'community:update', { id: ctx.community.id });
  res.json({ ok: true });
}));

r.patch('/communities/:id/members/me', ah(async (req, res) => {
  const ctx = await ctxFor(req);
  if (!ctx.member) throw err(403, 'Você não é membro.');
  await db.query('UPDATE community_members SET nickname=$1 WHERE community_id=$2 AND user_id=$3',
    [str(req.body.nickname, { max: 32, required: false }) || null, ctx.community.id, req.user.id]);
  res.json({ ok: true });
}));

r.delete('/communities/:id/members/:userId', ah(async (req, res) => {
  const ctx = await ctxFor(req);
  need(ctx, P.KICK_MEMBERS);
  const target = int(req.params.userId, { min: 1 });
  if (await memberTop(ctx.community.id, target, ctx.community.owner_id) >= ctx.topPosition) throw err(403, 'Você não pode expulsar este membro.');
  await db.query('DELETE FROM community_members WHERE community_id=$1 AND user_id=$2', [ctx.community.id, target]);
  await audit(ctx.community.id, req.user.id, 'member_kicked', target, { reason: str(req.body?.reason, { max: 300, required: false }) });
  hub.resync?.(target);
  hub.toUser(target, 'community:removed', { id: ctx.community.id });
  res.json({ ok: true });
}));

r.get('/communities/:id/bans', ah(async (req, res) => {
  const ctx = await ctxFor(req);
  need(ctx, P.BAN_MEMBERS);
  const rows = await db.many(`SELECT b.*, u.username, u.display_name, u.avatar_file_id, u.profile_color, u.global_role FROM community_bans b JOIN users u ON u.id=b.user_id WHERE b.community_id=$1 ORDER BY b.created_at DESC`, [ctx.community.id]);
  res.json(rows.map(b => ({ user: publicUser({ ...b, id: b.user_id }), reason: b.reason, createdAt: b.created_at })));
}));
r.post('/communities/:id/bans', ah(async (req, res) => {
  const ctx = await ctxFor(req);
  need(ctx, P.BAN_MEMBERS);
  const target = int(req.body.userId, { min: 1 });
  if (target === req.user.id) throw err(400, 'Você não pode banir a si mesmo.');
  if (await memberTop(ctx.community.id, target, ctx.community.owner_id) >= ctx.topPosition) throw err(403, 'Você não pode banir este membro.');
  const reason = str(req.body.reason, { max: 300, required: false });
  await db.query(`INSERT INTO community_bans (community_id, user_id, reason, banned_by) VALUES ($1,$2,$3,$4) ON CONFLICT (community_id,user_id) DO UPDATE SET reason=EXCLUDED.reason`, [ctx.community.id, target, reason, req.user.id]);
  await db.query('DELETE FROM community_members WHERE community_id=$1 AND user_id=$2', [ctx.community.id, target]);
  await audit(ctx.community.id, req.user.id, 'member_banned', target, { reason });
  hub.resync?.(target);
  hub.toUser(target, 'community:removed', { id: ctx.community.id });
  res.json({ ok: true });
}));
r.delete('/communities/:id/bans/:userId', ah(async (req, res) => {
  const ctx = await ctxFor(req);
  need(ctx, P.BAN_MEMBERS);
  await db.query('DELETE FROM community_bans WHERE community_id=$1 AND user_id=$2', [ctx.community.id, int(req.params.userId, { min: 1 })]);
  await audit(ctx.community.id, req.user.id, 'member_unbanned', req.params.userId);
  res.json({ ok: true });
}));

// ===== Cargos =====
function parsePerms(v, ctx) {
  const n = int(v, { name: 'Permissões', min: 0, max: ALL });
  // não é possível conceder permissões que você mesmo não tem
  if ((n & ~ctx.perms) !== 0) throw err(403, 'Você não pode conceder permissões que não possui.');
  return n;
}
r.post('/communities/:id/roles', ah(async (req, res) => {
  const ctx = await ctxFor(req);
  need(ctx, P.MANAGE_ROLES);
  const name = str(req.body.name, { name: 'Nome do cargo', min: 1, max: 40 });
  const color = /^#[0-9a-fA-F]{6}$/.test(req.body.color || '') ? req.body.color : '#b9a6d9';
  const perms = parsePerms(req.body.permissions ?? DEFAULT_EVERYONE, ctx);
  const max = await db.one('SELECT coalesce(max(position),0) AS p FROM community_roles WHERE community_id=$1 AND position < $2', [ctx.community.id, ctx.topPosition === Infinity ? 1e9 : ctx.topPosition]);
  const position = Math.min(max.p + 1, ctx.topPosition === Infinity ? 1e6 : ctx.topPosition - 1);
  if (position < 1) throw err(403, 'Você não pode criar cargos acima do seu.');
  // abre espaço deslocando cargos de posição >= position
  await db.query('UPDATE community_roles SET position=position+1 WHERE community_id=$1 AND position >= $2 AND NOT is_default', [ctx.community.id, position]);
  const role = await db.one(`INSERT INTO community_roles (community_id, name, color, permissions, position) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [ctx.community.id, name, color, perms, position]);
  await audit(ctx.community.id, req.user.id, 'role_created', role.id, { name });
  await resyncMembers(ctx.community.id);
  res.status(201).json({ id: role.id });
}));
r.patch('/communities/:id/roles/:rid', ah(async (req, res) => {
  const ctx = await ctxFor(req);
  need(ctx, P.MANAGE_ROLES);
  const role = await db.one('SELECT * FROM community_roles WHERE id=$1 AND community_id=$2', [int(req.params.rid, { min: 1 }), ctx.community.id]);
  if (!role) throw err(404, 'Cargo não encontrado.');
  if (!role.is_default && role.position >= ctx.topPosition) throw err(403, 'Você não pode editar um cargo igual ou superior ao seu.');
  const sets = []; const vals = [];
  const add = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
  if (req.body.name !== undefined && !role.is_default) add('name', str(req.body.name, { name: 'Nome', min: 1, max: 40 }));
  if (req.body.color !== undefined) { if (!/^#[0-9a-fA-F]{6}$/.test(req.body.color)) throw err(400, 'Cor inválida.'); add('color', req.body.color); }
  if (req.body.permissions !== undefined) add('permissions', parsePerms(req.body.permissions, ctx));
  if (!sets.length) return res.json({ ok: true });
  vals.push(role.id);
  await db.query(`UPDATE community_roles SET ${sets.join(',')} WHERE id=$${vals.length}`, vals);
  await audit(ctx.community.id, req.user.id, 'role_updated', role.id, { name: role.name });
  await resyncMembers(ctx.community.id);
  res.json({ ok: true });
}));
r.delete('/communities/:id/roles/:rid', ah(async (req, res) => {
  const ctx = await ctxFor(req);
  need(ctx, P.MANAGE_ROLES);
  const role = await db.one('SELECT * FROM community_roles WHERE id=$1 AND community_id=$2', [int(req.params.rid, { min: 1 }), ctx.community.id]);
  if (!role || role.is_default) throw err(400, 'Esse cargo não pode ser removido.');
  if (role.position >= ctx.topPosition) throw err(403, 'Você não pode remover este cargo.');
  await db.query('DELETE FROM community_roles WHERE id=$1', [role.id]);
  await audit(ctx.community.id, req.user.id, 'role_deleted', role.id, { name: role.name });
  await resyncMembers(ctx.community.id);
  res.json({ ok: true });
}));

// ===== Canais =====
r.post('/communities/:id/channels', ah(async (req, res) => {
  const ctx = await ctxFor(req);
  need(ctx, P.MANAGE_CHANNELS);
  const name = str(req.body.name, { name: 'Nome do canal', min: 1, max: 40 }).toLowerCase().replace(/\s+/g, '-');
  const category = oneOf(req.body.category, CATEGORIES, 'Categoria', 'conversas');
  const isPrivate = category === 'privado' || bool(req.body.isPrivate);
  const topic = str(req.body.topic, { max: 200, required: false });
  const n = await db.one('SELECT count(*)::int AS n, coalesce(max(position),0) AS p FROM conversations WHERE community_id=$1 AND removed_at IS NULL', [ctx.community.id]);
  if (n.n >= 200) throw err(400, 'Limite de 200 canais.');
  const ch = await db.one(`INSERT INTO conversations (type, name, community_id, category, is_private, topic, position, owner_id) VALUES ('channel',$1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [name, ctx.community.id, category, isPrivate, topic, n.p + 1, req.user.id]);
  if (isPrivate && req.body.roleIds) {
    for (const rid of idArray(req.body.roleIds, 'Cargos')) {
      const ok = await db.one('SELECT 1 FROM community_roles WHERE id=$1 AND community_id=$2', [rid, ctx.community.id]);
      if (ok) await db.query('INSERT INTO channel_roles (channel_id, role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [ch.id, rid]);
    }
  }
  await audit(ctx.community.id, req.user.id, 'channel_created', ch.id, { name, category });
  await resyncMembers(ctx.community.id);
  res.status(201).json({ id: ch.id });
}));
async function channelCtx(req) {
  const ch = await db.one(`SELECT * FROM conversations WHERE id=$1 AND type='channel' AND removed_at IS NULL`, [int(req.params.cid, { min: 1 })]);
  if (!ch) throw err(404, 'Canal não encontrado.');
  const ctx = await communityContext(ch.community_id, req.user.id);
  need(ctx, P.MANAGE_CHANNELS);
  return { ch, ctx };
}
r.patch('/channels/:cid', ah(async (req, res) => {
  const { ch, ctx } = await channelCtx(req);
  const sets = []; const vals = [];
  const add = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
  if (req.body.name !== undefined) add('name', str(req.body.name, { name: 'Nome', min: 1, max: 40 }).toLowerCase().replace(/\s+/g, '-'));
  if (req.body.topic !== undefined) add('topic', str(req.body.topic, { max: 200, required: false }));
  if (req.body.category !== undefined) add('category', oneOf(req.body.category, CATEGORIES, 'Categoria'));
  if (req.body.isPrivate !== undefined) add('is_private', bool(req.body.isPrivate));
  if (req.body.position !== undefined) add('position', int(req.body.position, { min: 0, max: 10000 }));
  if (sets.length) { vals.push(ch.id); await db.query(`UPDATE conversations SET ${sets.join(',')} WHERE id=$${vals.length}`, vals); }
  if (req.body.roleIds !== undefined) {
    await db.query('DELETE FROM channel_roles WHERE channel_id=$1', [ch.id]);
    for (const rid of idArray(req.body.roleIds, 'Cargos')) {
      const ok = await db.one('SELECT 1 FROM community_roles WHERE id=$1 AND community_id=$2', [rid, ctx.community.id]);
      if (ok) await db.query('INSERT INTO channel_roles (channel_id, role_id) VALUES ($1,$2)', [ch.id, rid]);
    }
  }
  await audit(ctx.community.id, req.user.id, 'channel_updated', ch.id, { name: ch.name });
  await resyncMembers(ctx.community.id);
  res.json({ ok: true });
}));
r.delete('/channels/:cid', ah(async (req, res) => {
  const { ch, ctx } = await channelCtx(req);
  await db.query('UPDATE conversations SET removed_at=now() WHERE id=$1', [ch.id]);
  await audit(ctx.community.id, req.user.id, 'channel_deleted', ch.id, { name: ch.name });
  await resyncMembers(ctx.community.id);
  res.json({ ok: true });
}));

// ===== Convites =====
r.post('/communities/:id/invites', ah(async (req, res) => {
  const ctx = await ctxFor(req);
  need(ctx, P.CREATE_INVITES);
  const maxUses = req.body.maxUses ? int(req.body.maxUses, { min: 1, max: 10000 }) : null;
  const hours = req.body.expiresHours ? int(req.body.expiresHours, { min: 1, max: 24 * 30 }) : null;
  const code = randomToken(6).replace(/[-_]/g, 'x');
  await db.query(`INSERT INTO community_invites (code, community_id, created_by, max_uses, expires_at) VALUES ($1,$2,$3,$4,$5)`,
    [code, ctx.community.id, req.user.id, maxUses, hours ? new Date(Date.now() + hours * 3600000) : null]);
  await audit(ctx.community.id, req.user.id, 'invite_created', code);
  if (req.body.userId) {
    const to = int(req.body.userId, { min: 1 });
    await notify(to, 'community_invite', req.user.id, { communityId: ctx.community.id, name: ctx.community.name, code });
  }
  res.status(201).json({ code });
}));
r.get('/communities/:id/invites', ah(async (req, res) => {
  const ctx = await ctxFor(req);
  need(ctx, P.MANAGE_COMMUNITY);
  const rows = await db.many(`SELECT i.*, u.display_name FROM community_invites i LEFT JOIN users u ON u.id=i.created_by WHERE i.community_id=$1 AND NOT i.revoked ORDER BY i.created_at DESC`, [ctx.community.id]);
  res.json(rows.map(i => ({ code: i.code, uses: i.uses, maxUses: i.max_uses, expiresAt: i.expires_at, createdBy: i.display_name, createdAt: i.created_at })));
}));
r.delete('/invites/community/:code', ah(async (req, res) => {
  const inv = await db.one('SELECT * FROM community_invites WHERE code=$1', [str(req.params.code, { max: 40 })]);
  if (!inv) throw err(404, 'Convite não encontrado.');
  const ctx = await communityContext(inv.community_id, req.user.id);
  if (inv.created_by !== req.user.id) need(ctx, P.MANAGE_COMMUNITY);
  await db.query('UPDATE community_invites SET revoked=true WHERE code=$1', [inv.code]);
  await audit(inv.community_id, req.user.id, 'invite_revoked', inv.code);
  res.json({ ok: true });
}));
async function validInvite(code) {
  const inv = await db.one(`SELECT i.*, c.name, c.description, c.logo_file_id, c.banner_file_id, c.removed_at,
      (SELECT count(*)::int FROM community_members m WHERE m.community_id=c.id) AS n
    FROM community_invites i JOIN communities c ON c.id=i.community_id WHERE i.code=$1`, [code]);
  if (!inv || inv.revoked || inv.removed_at || (inv.expires_at && new Date(inv.expires_at) < new Date()) || (inv.max_uses && inv.uses >= inv.max_uses)) {
    throw err(404, 'Convite inválido ou expirado.');
  }
  return inv;
}
r.get('/invites/community/:code', ah(async (req, res) => {
  const inv = await validInvite(str(req.params.code, { max: 40 }));
  const me = await db.one('SELECT 1 FROM community_members WHERE community_id=$1 AND user_id=$2', [inv.community_id, req.user.id]);
  res.json({ communityId: inv.community_id, name: inv.name, description: inv.description, logo: fileUrl(inv.logo_file_id), banner: fileUrl(inv.banner_file_id), memberCount: inv.n, isMember: !!me });
}));
r.post('/invites/community/:code/join', ah(async (req, res) => {
  const inv = await validInvite(str(req.params.code, { max: 40 }));
  const already = await db.one('SELECT 1 FROM community_members WHERE community_id=$1 AND user_id=$2', [inv.community_id, req.user.id]);
  const c = await db.one('SELECT * FROM communities WHERE id=$1', [inv.community_id]);
  await joinCommunity(req, c);
  if (!already) await db.query('UPDATE community_invites SET uses=uses+1 WHERE code=$1', [inv.code]);
  res.json({ ok: true, communityId: inv.community_id });
}));

// ===== Denúncias e auditoria =====
r.get('/communities/:id/reports', ah(async (req, res) => {
  const ctx = await ctxFor(req);
  need(ctx, P.HANDLE_REPORTS);
  const rows = await db.many(`SELECT r.*, u.display_name AS reporter_name FROM reports r LEFT JOIN users u ON u.id=r.reporter_id
    WHERE r.community_id=$1 ORDER BY (r.status IN ('open','reviewing')) DESC, r.created_at DESC LIMIT 200`, [ctx.community.id]);
  const out = [];
  for (const rep of rows) {
    let target = null;
    if (rep.target_type === 'message') {
      const m = await db.one(`SELECT m.id, m.content, m.deleted_at, m.conversation_id, u.display_name, u.id AS uid FROM messages m LEFT JOIN users u ON u.id=m.sender_id WHERE m.id=$1`, [rep.target_id]);
      if (m) target = { messageId: m.id, content: m.deleted_at ? '(apagada)' : m.content, author: m.display_name, authorId: m.uid, channelId: m.conversation_id };
    } else if (rep.target_type === 'user') {
      const u = await db.one('SELECT * FROM users WHERE id=$1', [rep.target_id]);
      target = publicUser(u);
    }
    out.push({ id: rep.id, targetType: rep.target_type, targetId: rep.target_id, reason: rep.reason, details: rep.details, status: rep.status, reporter: rep.reporter_name, createdAt: rep.created_at, target, resolution: rep.resolution });
  }
  res.json(out);
}));
r.patch('/communities/:id/reports/:rid', ah(async (req, res) => {
  const ctx = await ctxFor(req);
  need(ctx, P.HANDLE_REPORTS);
  const status = oneOf(req.body.status, ['reviewing', 'resolved', 'dismissed'], 'Status');
  const rep = await db.one(`UPDATE reports SET status=$1, handled_by=$2, resolution=$3, updated_at=now() WHERE id=$4 AND community_id=$5 RETURNING *`,
    [status, req.user.id, str(req.body.resolution, { max: 500, required: false }), int(req.params.rid, { min: 1 }), ctx.community.id]);
  if (!rep) throw err(404, 'Denúncia não encontrada.');
  await audit(ctx.community.id, req.user.id, `report_${status}`, rep.id);
  res.json({ ok: true });
}));
r.get('/communities/:id/audit', ah(async (req, res) => {
  const ctx = await ctxFor(req);
  need(ctx, P.VIEW_AUDIT_LOG);
  const rows = await db.many(`SELECT a.*, u.display_name FROM community_audit a LEFT JOIN users u ON u.id=a.actor_id WHERE a.community_id=$1 ORDER BY a.id DESC LIMIT 300`, [ctx.community.id]);
  res.json(rows.map(a => ({ id: a.id, action: a.action, target: a.target, data: a.data, actor: a.display_name, createdAt: a.created_at })));
}));

module.exports = { router: r };
