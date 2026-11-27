const db = require('./db');
const hub = require('./hub');
const { DEFAULT_SETTINGS, mergeDeep, publicUser } = require('./util');

// tipo de notificação -> chave de preferência do usuário
const PREF = {
  message: 'messages', friend_request: 'friendRequests', friend_accept: 'friendRequests',
  call: 'calls', group_invite: 'groupInvites', group_join_request: 'groupInvites', mention: 'mentions',
  reply: 'replies', reaction: 'reactions', community_invite: 'communityInvites',
  admin: 'admin', announcement: 'admin', ticket: 'admin', story_reply: 'replies', story_reaction: 'reactions'
};

async function notify(userId, type, actorId, data = {}) {
  if (!userId || userId === actorId) return null;
  const u = await db.one('SELECT settings FROM users WHERE id=$1', [userId]);
  if (!u) return null;
  const prefs = mergeDeep(DEFAULT_SETTINGS, u.settings).notifications;
  const key = PREF[type];
  if (key && prefs[key] === false && type !== 'admin' && type !== 'announcement') return null;
  // não notifica quem bloqueou o autor
  if (actorId) {
    const b = await db.one('SELECT 1 FROM blocks WHERE blocker_id=$1 AND blocked_id=$2', [userId, actorId]);
    if (b) return null;
  }
  const n = await db.one(
    `INSERT INTO notifications (user_id, type, actor_id, data) VALUES ($1,$2,$3,$4) RETURNING *`,
    [userId, type, actorId || null, data]
  );
  const actor = actorId ? await db.one('SELECT * FROM users WHERE id=$1', [actorId]) : null;
  hub.toUser(userId, 'notification', serialize(n, actor));
  return n;
}

function serialize(n, actor) {
  return { id: n.id, type: n.type, data: n.data, read: !!n.read_at, createdAt: n.created_at, actor: publicUser(actor) };
}

async function awardBadge(userId, code) {
  const r = await db.query(`INSERT INTO user_badges (user_id, badge_code) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [userId, code]);
  if (r.rowCount) {
    const b = await db.one('SELECT * FROM badges WHERE code=$1', [code]);
    hub.toUser(userId, 'badge', { code, name: b.name, icon: b.icon });
  }
}

async function activity(userId, type, data = {}) {
  await db.query('INSERT INTO user_activity (user_id, type, data) VALUES ($1,$2,$3)', [userId, type, data]);
}

module.exports = { notify, serialize, awardBadge, activity };
