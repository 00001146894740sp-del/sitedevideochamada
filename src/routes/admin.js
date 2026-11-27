const express = require('express');
const db = require('../db');
const hub = require('../hub');
const settings = require('../settings');
const { requireRole, rank, adminLog } = require('../security');
const { notify, awardBadge } = require('../notify');
const { serializeMessages, broadcast } = require('../messages');
const { ah, err, str, int, bool, oneOf, publicUser, fileUrl, ROLE_RANK } = require('../util');

const r = express.Router();
r.use(requireRole('support'));

// só pode agir sobre quem tem nível inferior ao seu; o dono é intocável
async function targetUser(req) {
  const u = await db.one('SELECT * FROM users WHERE id=$1', [int(req.params.id, { min: 1 })]);
  if (!u) throw err(404, 'Usuário não encontrado.');
  return u;
}
function assertAbove(req, u) {
  if (u.global_role === 'owner') throw err(403, 'O dono da plataforma não pode ser alvo de ações administrativas.');
  if (u.id === req.user.id) throw err(400, 'Você não pode aplicar essa ação em si mesmo.');
  if (rank(req.user) <= rank(u)) throw err(403, 'Você só pode agir sobre usuários de nível inferior ao seu.');
}

r.get('/stats', ah(async (req, res) => {
  const s = await db.one(`SELECT
    (SELECT count(*)::int FROM users WHERE status<>'deleted') AS users,
    (SELECT count(*)::int FROM users WHERE created_at > now() - interval '1 day') AS users_today,
    (SELECT count(*)::int FROM users WHERE status='banned') AS banned,
    (SELECT count(*)::int FROM users WHERE status='suspended') AS suspended,
    (SELECT count(DISTINCT user_id)::int FROM sessions WHERE last_seen_at > now() - interval '1 day') AS active_today,
    (SELECT count(*)::int FROM messages) AS messages,
    (SELECT count(*)::int FROM messages WHERE created_at > now() - interval '1 day') AS messages_today,
    (SELECT count(*)::int FROM conversations WHERE type='group' AND removed_at IS NULL) AS groups,
    (SELECT count(*)::int FROM communities WHERE removed_at IS NULL) AS communities,
    (SELECT count(*)::int FROM reports WHERE status IN ('open','reviewing') AND community_id IS NULL) AS open_reports,
    (SELECT count(*)::int FROM tickets WHERE status IN ('open','in_progress')) AS open_tickets,
    (SELECT count(*)::int FROM calls WHERE started_at > now() - interval '1 day') AS calls_today,
    (SELECT coalesce(sum(size),0)::bigint FROM files WHERE deleted_at IS NULL) AS storage_bytes`);
  const daily = await db.many(`SELECT to_char(d, 'DD/MM') AS day,
      (SELECT count(*)::int FROM users WHERE created_at::date = d::date) AS signups,
      (SELECT count(*)::int FROM messages WHERE created_at::date = d::date) AS messages
    FROM generate_series(current_date - 13, current_date, interval '1 day') d`);
  const online = hub.io ? (await hub.io.fetchSockets()).length : 0;
  res.json({ ...s, storage_bytes: Number(s.storage_bytes), online_connections: online, daily });
}));

r.get('/users', ah(async (req, res) => {
  const q = str(req.query.q, { max: 60, required: false }).replace(/[%_]/g, '');
  const status = oneOf(req.query.status, ['all', 'active', 'suspended', 'banned', 'deleted'], 'Status', 'all');
  const role = oneOf(req.query.role, ['all', 'owner', 'admin', 'moderator', 'support', 'user'], 'Nível', 'all');
  const page = int(req.query.page, { min: 1, max: 10000, def: 1 });
  const rows = await db.many(`SELECT u.*, count(*) OVER() AS total FROM users u
    WHERE ($1='' OR u.username ILIKE $1||'%' OR u.display_name ILIKE '%'||$1||'%' OR u.email ILIKE '%'||$1||'%' OR u.id::text=$1)
      AND ($2='all' OR u.status=$2) AND ($3='all' OR u.global_role=$3)
    ORDER BY u.id DESC LIMIT 50 OFFSET $4`, [q, status, role, (page - 1) * 50]);
  const canSeeEmail = rank(req.user) >= ROLE_RANK.moderator;
  res.json({
    total: rows[0]?.total || 0, page,
    users: rows.map(u => ({ ...publicUser(u), email: canSeeEmail ? u.email : null, status: u.status, suspendedUntil: u.suspended_until, statusReason: u.status_reason, createdAt: u.created_at, emailVerified: u.email_verified }))
  });
}));

r.get('/users/:id', ah(async (req, res) => {
  const u = await targetUser(req);
  const [bans, reports, logins, sessions, badges, counts] = await Promise.all([
    db.many(`SELECT b.*, a.display_name AS actor FROM bans b LEFT JOIN users a ON a.id=b.actor_id WHERE b.user_id=$1 ORDER BY b.id DESC`, [u.id]),
    db.many(`SELECT * FROM reports WHERE target_type='user' AND target_id=$1 ORDER BY id DESC LIMIT 20`, [u.id]),
    rank(req.user) >= ROLE_RANK.moderator ? db.many(`SELECT method, success, ip, created_at FROM login_history WHERE user_id=$1 ORDER BY id DESC LIMIT 20`, [u.id]) : [],
    db.one(`SELECT count(*)::int AS n FROM sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at > now()`, [u.id]),
    db.many(`SELECT badge_code FROM user_badges WHERE user_id=$1`, [u.id]),
    db.one(`SELECT (SELECT count(*)::int FROM messages WHERE sender_id=$1) AS messages, (SELECT count(*)::int FROM friends WHERE user_id=$1) AS friends`, [u.id])
  ]);
  res.json({
    ...publicUser(u, { full: true }), email: rank(req.user) >= ROLE_RANK.moderator ? u.email : null,
    status: u.status, suspendedUntil: u.suspended_until, statusReason: u.status_reason, emailVerified: u.email_verified,
    bans, reports, logins, activeSessions: sessions.n, badges: badges.map(b => b.badge_code), counts
  });
}));

r.post('/users/:id/suspend', requireRole('moderator'), ah(async (req, res) => {
  const u = await targetUser(req); assertAbove(req, u);
  const hours = int(req.body.hours, { name: 'Duração', min: 1, max: 24 * 365 });
  const reason = str(req.body.reason, { name: 'Motivo', min: 3, max: 300 });
  const until = new Date(Date.now() + hours * 3600000);
  await db.query(`UPDATE users SET status='suspended', suspended_until=$1, status_reason=$2 WHERE id=$3`, [until, reason, u.id]);
  await db.query(`INSERT INTO bans (user_id, type, reason, actor_id, until) VALUES ($1,'suspend',$2,$3,$4)`, [u.id, reason, req.user.id, until]);
  await adminLog(req, 'user_suspended', 'user', u.id, { hours, reason });
  hub.disconnectUser(u.id);
  res.json({ ok: true });
}));

r.post('/users/:id/ban', requireRole('admin'), ah(async (req, res) => {
  const u = await targetUser(req); assertAbove(req, u);
  const reason = str(req.body.reason, { name: 'Motivo', min: 3, max: 300 });
  await db.query(`UPDATE users SET status='banned', suspended_until=NULL, status_reason=$1 WHERE id=$2`, [reason, u.id]);
  await db.query(`INSERT INTO bans (user_id, type, reason, actor_id) VALUES ($1,'ban',$2,$3)`, [u.id, reason, req.user.id]);
  await db.query(`UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, [u.id]);
  await adminLog(req, 'user_banned', 'user', u.id, { reason });
  hub.disconnectUser(u.id);
  res.json({ ok: true });
}));

r.post('/users/:id/unban', requireRole('moderator'), ah(async (req, res) => {
  const u = await targetUser(req); assertAbove(req, u);
  if (u.status === 'banned' && rank(req.user) < ROLE_RANK.admin) throw err(403, 'Apenas administradores podem remover banimentos.');
  await db.query(`UPDATE users SET status='active', suspended_until=NULL, status_reason=NULL WHERE id=$1 AND status IN ('banned','suspended')`, [u.id]);
  await db.query(`UPDATE bans SET lifted_at=now(), lifted_by=$2 WHERE user_id=$1 AND lifted_at IS NULL`, [u.id, req.user.id]);
  await adminLog(req, u.status === 'banned' ? 'user_unbanned' : 'user_unsuspended', 'user', u.id);
  res.json({ ok: true });
}));

r.patch('/users/:id/role', requireRole('admin'), ah(async (req, res) => {
  const u = await targetUser(req); assertAbove(req, u);
  const role = oneOf(req.body.role, ['admin', 'moderator', 'support', 'user'], 'Nível');
  // somente o dono pode nomear administradores; admins nomeiam até moderador
  if (ROLE_RANK[role] >= rank(req.user)) throw err(403, 'Você não pode conceder um nível igual ou superior ao seu.');
  await db.query('UPDATE users SET global_role=$1 WHERE id=$2', [role, u.id]);
  if (role !== 'user') await awardBadge(u.id, 'staff');
  else await db.query(`DELETE FROM user_badges WHERE user_id=$1 AND badge_code='staff'`, [u.id]);
  await adminLog(req, 'role_changed', 'user', u.id, { from: u.global_role, to: role });
  await notify(u.id, 'admin', req.user.id, { text: `Seu nível de acesso foi alterado para: ${role}` });
  res.json({ ok: true });
}));

r.post('/users/:id/badges', requireRole('admin'), ah(async (req, res) => {
  const u = await targetUser(req);
  const code = str(req.body.code, { max: 40 });
  if (!await db.one('SELECT 1 FROM badges WHERE code=$1', [code])) throw err(404, 'Insígnia inexistente.');
  await db.query('INSERT INTO user_badges (user_id, badge_code, awarded_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [u.id, code, req.user.id]);
  await adminLog(req, 'badge_awarded', 'user', u.id, { code });
  res.json({ ok: true });
}));
r.delete('/users/:id/badges/:code', requireRole('admin'), ah(async (req, res) => {
  const u = await targetUser(req);
  await db.query('DELETE FROM user_badges WHERE user_id=$1 AND badge_code=$2', [u.id, req.params.code]);
  await adminLog(req, 'badge_removed', 'user', u.id, { code: req.params.code });
  res.json({ ok: true });
}));
r.post('/users/:id/logout-all', requireRole('moderator'), ah(async (req, res) => {
  const u = await targetUser(req); assertAbove(req, u);
  await db.query(`UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, [u.id]);
  hub.disconnectUser(u.id);
  await adminLog(req, 'sessions_revoked', 'user', u.id);
  res.json({ ok: true });
}));
r.get('/badges', ah(async (req, res) => res.json(await db.many('SELECT * FROM badges ORDER BY special DESC, name'))));

// ===== Denúncias =====
r.get('/reports', ah(async (req, res) => {
  const status = oneOf(req.query.status, ['open', 'reviewing', 'resolved', 'dismissed', 'all'], 'Status', 'open');
  const rows = await db.many(`SELECT r.*, u.display_name AS reporter_name, h.display_name AS handler_name FROM reports r
    LEFT JOIN users u ON u.id=r.reporter_id LEFT JOIN users h ON h.id=r.handled_by
    WHERE ($1='all' OR r.status=$1) ORDER BY r.id DESC LIMIT 200`, [status]);
  const out = [];
  for (const rep of rows) {
    let target = null;
    if (rep.target_type === 'message') {
      const m = await db.one('SELECT * FROM messages WHERE id=$1', [rep.target_id]);
      if (m) {
        const [sm] = await serializeMessages([m], req.user.id);
        const c = await db.one('SELECT type, name FROM conversations WHERE id=$1', [m.conversation_id]);
        target = { ...sm, convType: c?.type, convName: c?.name };
      }
    } else if (rep.target_type === 'user') {
      const u = await db.one('SELECT * FROM users WHERE id=$1', [rep.target_id]);
      target = u ? { ...publicUser(u, { full: true }), status: u.status } : null;
    } else if (rep.target_type === 'community') {
      const c = await db.one('SELECT * FROM communities WHERE id=$1', [rep.target_id]);
      target = c ? { id: c.id, name: c.name, description: c.description, removed: !!c.removed_at } : null;
    } else if (rep.target_type === 'group') {
      const c = await db.one('SELECT * FROM conversations WHERE id=$1', [rep.target_id]);
      target = c ? { id: c.id, name: c.name, description: c.description, removed: !!c.removed_at } : null;
    } else if (rep.target_type === 'story') {
      const s = await db.one('SELECT * FROM stories WHERE id=$1', [rep.target_id]);
      target = s ? { id: s.id, type: s.type, text: s.text, url: fileUrl(s.file_id), userId: s.user_id, deleted: !!s.deleted_at } : null;
    }
    out.push({ id: rep.id, targetType: rep.target_type, targetId: rep.target_id, communityId: rep.community_id, reason: rep.reason, details: rep.details,
      status: rep.status, reporter: rep.reporter_name, handler: rep.handler_name, resolution: rep.resolution, createdAt: rep.created_at, target });
  }
  res.json(out);
}));
r.patch('/reports/:id', requireRole('moderator'), ah(async (req, res) => {
  const status = oneOf(req.body.status, ['reviewing', 'resolved', 'dismissed'], 'Status');
  const rep = await db.one(`UPDATE reports SET status=$1, handled_by=$2, resolution=$3, updated_at=now() WHERE id=$4 RETURNING *`,
    [status, req.user.id, str(req.body.resolution, { max: 500, required: false }), int(req.params.id, { min: 1 })]);
  if (!rep) throw err(404, 'Denúncia não encontrada.');
  await adminLog(req, `report_${status}`, 'report', rep.id);
  if (rep.reporter_id && status !== 'reviewing') {
    await notify(rep.reporter_id, 'admin', null, { text: status === 'resolved' ? 'Sua denúncia foi analisada e medidas foram tomadas. Obrigado!' : 'Sua denúncia foi analisada. Não encontramos violação das regras.' });
  }
  res.json({ ok: true });
}));

// ===== Remoção de conteúdo =====
r.delete('/messages/:id', requireRole('moderator'), ah(async (req, res) => {
  const m = await db.one('SELECT * FROM messages WHERE id=$1', [int(req.params.id, { min: 1 })]);
  if (!m) throw err(404, 'Mensagem não encontrada.');
  await db.query(`UPDATE messages SET deleted_at=now(), content='', link_preview=NULL WHERE id=$1`, [m.id]);
  await db.query(`UPDATE files SET deleted_at=now() WHERE id IN (SELECT file_id FROM message_attachments WHERE message_id=$1)`, [m.id]);
  await broadcast(m.conversation_id, 'message:update', m.id);
  await adminLog(req, 'message_removed', 'message', m.id, { authorId: m.sender_id });
  res.json({ ok: true });
}));
r.delete('/stories/:id', requireRole('moderator'), ah(async (req, res) => {
  const s = await db.one('UPDATE stories SET deleted_at=now() WHERE id=$1 RETURNING *', [int(req.params.id, { min: 1 })]);
  if (!s) throw err(404, 'Story não encontrado.');
  if (s.file_id) await db.query('UPDATE files SET deleted_at=now() WHERE id=$1', [s.file_id]);
  await adminLog(req, 'story_removed', 'story', s.id);
  res.json({ ok: true });
}));
r.delete('/users/:id/avatar', requireRole('moderator'), ah(async (req, res) => {
  const u = await targetUser(req); assertAbove(req, u);
  await db.query('UPDATE users SET avatar_file_id=NULL, banner_file_id=NULL WHERE id=$1', [u.id]);
  await adminLog(req, 'profile_media_removed', 'user', u.id);
  res.json({ ok: true });
}));

// ===== Comunidades e grupos =====
r.get('/communities', ah(async (req, res) => {
  const q = str(req.query.q, { max: 60, required: false }).replace(/[%_]/g, '');
  const rows = await db.many(`SELECT c.*, u.username AS owner_username, (SELECT count(*)::int FROM community_members m WHERE m.community_id=c.id) AS n,
      (SELECT count(*)::int FROM reports r WHERE r.target_type='community' AND r.target_id=c.id AND r.status IN ('open','reviewing')) AS reports
    FROM communities c JOIN users u ON u.id=c.owner_id WHERE ($1='' OR c.name ILIKE '%'||$1||'%') ORDER BY c.id DESC LIMIT 100`, [q]);
  res.json(rows.map(c => ({ id: c.id, name: c.name, owner: c.owner_username, memberCount: c.n, isPublic: c.is_public, removed: !!c.removed_at, reports: c.reports, createdAt: c.created_at, logo: fileUrl(c.logo_file_id) })));
}));
r.post('/communities/:id/remove', requireRole('admin'), ah(async (req, res) => {
  const c = await db.one('UPDATE communities SET removed_at=now() WHERE id=$1 RETURNING *', [int(req.params.id, { min: 1 })]);
  if (!c) throw err(404, 'Comunidade não encontrada.');
  const ms = await db.many('SELECT user_id FROM community_members WHERE community_id=$1', [c.id]);
  for (const m of ms) { hub.resync?.(m.user_id); hub.toUser(m.user_id, 'community:removed', { id: c.id }); }
  await adminLog(req, 'community_removed', 'community', c.id, { name: c.name, reason: req.body?.reason });
  await notify(c.owner_id, 'admin', req.user.id, { text: `Sua comunidade "${c.name}" foi removida pela moderação.` });
  res.json({ ok: true });
}));
r.post('/communities/:id/restore', requireRole('admin'), ah(async (req, res) => {
  const c = await db.one('UPDATE communities SET removed_at=NULL WHERE id=$1 RETURNING *', [int(req.params.id, { min: 1 })]);
  if (!c) throw err(404, 'Comunidade não encontrada.');
  const ms = await db.many('SELECT user_id FROM community_members WHERE community_id=$1', [c.id]);
  for (const m of ms) hub.resync?.(m.user_id);
  await adminLog(req, 'community_restored', 'community', c.id);
  res.json({ ok: true });
}));
r.get('/groups', ah(async (req, res) => {
  const q = str(req.query.q, { max: 60, required: false }).replace(/[%_]/g, '');
  const rows = await db.many(`SELECT c.*, u.username AS owner_username, (SELECT count(*)::int FROM conversation_members m WHERE m.conversation_id=c.id AND m.status='active') AS n
    FROM conversations c LEFT JOIN users u ON u.id=c.owner_id WHERE c.type='group' AND ($1='' OR c.name ILIKE '%'||$1||'%') ORDER BY c.id DESC LIMIT 100`, [q]);
  res.json(rows.map(c => ({ id: c.id, name: c.name, owner: c.owner_username, memberCount: c.n, privacy: c.privacy, removed: !!c.removed_at, createdAt: c.created_at })));
}));
r.post('/groups/:id/remove', requireRole('admin'), ah(async (req, res) => {
  const c = await db.one(`UPDATE conversations SET removed_at=now() WHERE id=$1 AND type='group' RETURNING *`, [int(req.params.id, { min: 1 })]);
  if (!c) throw err(404, 'Grupo não encontrado.');
  const ms = await db.many(`SELECT user_id FROM conversation_members WHERE conversation_id=$1 AND status='active'`, [c.id]);
  for (const m of ms) { hub.leaveConv(m.user_id, c.id); hub.toUser(m.user_id, 'conversations:changed', { removed: c.id }); }
  await adminLog(req, 'group_removed', 'group', c.id, { name: c.name });
  res.json({ ok: true });
}));
r.post('/groups/:id/restore', requireRole('admin'), ah(async (req, res) => {
  const c = await db.one(`UPDATE conversations SET removed_at=NULL WHERE id=$1 AND type='group' RETURNING *`, [int(req.params.id, { min: 1 })]);
  if (!c) throw err(404, 'Grupo não encontrado.');
  const ms = await db.many(`SELECT user_id FROM conversation_members WHERE conversation_id=$1 AND status='active'`, [c.id]);
  for (const m of ms) { hub.joinConv(m.user_id, c.id); hub.toUser(m.user_id, 'conversations:changed', {}); }
  await adminLog(req, 'group_restored', 'group', c.id);
  res.json({ ok: true });
}));

// ===== Registros =====
r.get('/logs', requireRole('admin'), ah(async (req, res) => {
  const rows = await db.many(`SELECT l.*, u.display_name AS actor FROM admin_logs l LEFT JOIN users u ON u.id=l.actor_id ORDER BY l.id DESC LIMIT 300`);
  res.json(rows.map(l => ({ id: l.id, actor: l.actor, action: l.action, targetType: l.target_type, targetId: l.target_id, data: l.data, ip: l.ip, createdAt: l.created_at })));
}));

// ===== Comunicados =====
r.get('/announcements', ah(async (req, res) => {
  res.json(await db.many(`SELECT a.*, u.display_name AS author FROM announcements a LEFT JOIN users u ON u.id=a.created_by ORDER BY a.id DESC LIMIT 100`));
}));
r.post('/announcements', requireRole('admin'), ah(async (req, res) => {
  const title = str(req.body.title, { name: 'Título', min: 3, max: 120 });
  const content = str(req.body.content, { name: 'Conteúdo', min: 3, max: 3000 });
  const a = await db.one('INSERT INTO announcements (title, content, created_by) VALUES ($1,$2,$3) RETURNING *', [title, content, req.user.id]);
  await db.query(`INSERT INTO notifications (user_id, type, actor_id, data)
    SELECT id, 'announcement', $1, $2 FROM users WHERE status='active'`, [req.user.id, { announcementId: a.id, title, text: content.slice(0, 200) }]);
  hub.io?.emit('announcement', { id: a.id, title, content });
  await adminLog(req, 'announcement_created', 'announcement', a.id, { title });
  res.status(201).json(a);
}));
r.patch('/announcements/:id', requireRole('admin'), ah(async (req, res) => {
  await db.query('UPDATE announcements SET active=$1 WHERE id=$2', [bool(req.body.active), int(req.params.id, { min: 1 })]);
  await adminLog(req, 'announcement_updated', 'announcement', req.params.id, { active: bool(req.body.active) });
  res.json({ ok: true });
}));

// ===== Configurações gerais =====
r.get('/settings', requireRole('admin'), ah(async (req, res) => res.json(await settings.all())));
r.patch('/settings', requireRole('admin'), ah(async (req, res) => {
  const b = req.body;
  if (b.registration_open !== undefined) await settings.setSetting('registration_open', bool(b.registration_open));
  if (b.max_upload_mb !== undefined) await settings.setSetting('max_upload_mb', int(b.max_upload_mb, { name: `Limite (máx. ${require('../config').maxUploadMb} MB)`, min: 1, max: require('../config').maxUploadMb }));
  if (b.max_message_length !== undefined) await settings.setSetting('max_message_length', int(b.max_message_length, { min: 100, max: 10000 }));
  if (b.maintenance_notice !== undefined) await settings.setSetting('maintenance_notice', str(b.maintenance_notice, { max: 300, required: false }));
  await adminLog(req, 'settings_updated', 'settings', null, b);
  res.json(await settings.all());
}));

module.exports = { router: r };
