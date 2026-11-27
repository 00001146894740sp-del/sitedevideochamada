const express = require('express');
const db = require('../db');
const hub = require('../hub');
const { upload, storeFile } = require('../files');
const { notify, awardBadge, activity } = require('../notify');
const { createMessage } = require('../messages');
const { conversationAccess } = require('../permissions');
const { ah, err, str, int, oneOf, publicUser, fileUrl } = require('../util');

const r = express.Router();

async function canSeeStory(s, viewerId) {
  if (s.user_id === viewerId) return true;
  if (s.deleted_at || new Date(s.expires_at) < new Date()) return false;
  const bl = await db.one(`SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)`, [s.user_id, viewerId]);
  if (bl) return false;
  if (s.privacy === 'public') return true;
  const f = await db.one('SELECT favorite FROM friends WHERE user_id=$1 AND friend_id=$2', [s.user_id, viewerId]);
  if (!f) return false;
  return s.privacy === 'friends' || f.favorite;
}

function serialize(s, extra = {}) {
  return {
    id: s.id, userId: s.user_id, type: s.type, url: fileUrl(s.file_id), text: s.text, bg: s.bg, privacy: s.privacy,
    expiresAt: s.expires_at, createdAt: s.created_at, expired: new Date(s.expires_at) < new Date(), ...extra
  };
}

r.get('/stories/feed', ah(async (req, res) => {
  const me = req.user.id;
  const rows = await db.many(`
    SELECT s.*, EXISTS (SELECT 1 FROM story_views v WHERE v.story_id=s.id AND v.user_id=$1) AS seen
      FROM stories s
     WHERE s.deleted_at IS NULL AND s.expires_at > now()
       AND (s.user_id=$1 OR EXISTS (
         SELECT 1 FROM friends f WHERE f.user_id=s.user_id AND f.friend_id=$1 AND (s.privacy<>'close' OR f.favorite)))
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id=s.user_id AND b.blocked_id=$1) OR (b.blocker_id=$1 AND b.blocked_id=s.user_id))
     ORDER BY s.created_at`, [me]);
  const userIds = [...new Set(rows.map(s => s.user_id))];
  const users = await db.many('SELECT * FROM users WHERE id = ANY($1)', [userIds]);
  const groups = userIds.map(uid => {
    const list = rows.filter(s => s.user_id === uid);
    return { user: publicUser(users.find(u => u.id === uid)), stories: list.map(s => serialize(s, { seen: s.seen })), allSeen: list.every(s => s.seen) };
  });
  groups.sort((a, b) => (a.user.id === me ? -1 : b.user.id === me ? 1 : (a.allSeen - b.allSeen)));
  res.json(groups);
}));

r.get('/stories/user/:id', ah(async (req, res) => {
  const uid = int(req.params.id, { min: 1 });
  const rows = await db.many(`SELECT s.*, EXISTS (SELECT 1 FROM story_views v WHERE v.story_id=s.id AND v.user_id=$2) AS seen
    FROM stories s WHERE s.user_id=$1 AND s.deleted_at IS NULL AND s.expires_at > now() ORDER BY s.created_at`, [uid, req.user.id]);
  const out = [];
  for (const s of rows) if (await canSeeStory(s, req.user.id)) out.push(serialize(s, { seen: s.seen }));
  res.json(out);
}));

r.post('/stories', upload.single('file'), ah(async (req, res) => {
  const type = oneOf(req.body.type, ['image', 'video', 'text'], 'Tipo');
  const privacy = oneOf(req.body.privacy, ['public', 'friends', 'close'], 'Privacidade', 'friends');
  const hours = int(req.body.durationHours, { name: 'Duração', min: 1, max: 48, def: 24 });
  const text = str(req.body.text, { name: 'Texto', max: 700, required: false });
  const bg = /^#[0-9a-fA-F]{6}$/.test(req.body.bg || '') ? req.body.bg : '#3b0a78';
  let fileId = null;
  if (type !== 'text') {
    if (!req.file) throw err(400, 'Envie uma foto ou vídeo.');
    const f = await storeFile(req.file, req.user.id, 'story', { allowKinds: [type] });
    fileId = f.id;
  } else if (!text) throw err(400, 'Escreva algo no story.');
  const s = await db.one(`INSERT INTO stories (user_id, type, file_id, text, bg, privacy, expires_at) VALUES ($1,$2,$3,$4,$5,$6, now() + ($7 || ' hours')::interval) RETURNING *`,
    [req.user.id, type, fileId, text, bg, privacy, String(hours)]);
  await awardBadge(req.user.id, 'storyteller');
  await activity(req.user.id, 'story_posted', { type });
  const friends = await db.many('SELECT friend_id FROM friends WHERE user_id=$1', [req.user.id]);
  hub.toUsers([req.user.id, ...friends.map(f => f.friend_id)], 'stories:changed', { userId: req.user.id });
  res.status(201).json(serialize(s));
}));

async function ownedOrVisible(req, ownerOnly = false) {
  const s = await db.one('SELECT * FROM stories WHERE id=$1 AND deleted_at IS NULL', [int(req.params.id, { min: 1 })]);
  if (!s) throw err(404, 'Story não encontrado.');
  if (ownerOnly && s.user_id !== req.user.id) throw err(403, 'Sem permissão.');
  if (!await canSeeStory(s, req.user.id)) throw err(404, 'Story não encontrado.');
  return s;
}

r.post('/stories/:id/view', ah(async (req, res) => {
  const s = await ownedOrVisible(req);
  if (s.user_id !== req.user.id) {
    const ins = await db.query('INSERT INTO story_views (story_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [s.id, req.user.id]);
    if (ins.rowCount) hub.toUser(s.user_id, 'story:viewed', { storyId: s.id });
  }
  res.json({ ok: true });
}));

r.get('/stories/:id/viewers', ah(async (req, res) => {
  const s = await ownedOrVisible(req, true);
  const rows = await db.many(`SELECT u.*, v.viewed_at, sr.emoji FROM story_views v JOIN users u ON u.id=v.user_id
    LEFT JOIN story_reactions sr ON sr.story_id=v.story_id AND sr.user_id=v.user_id WHERE v.story_id=$1 ORDER BY v.viewed_at DESC`, [s.id]);
  res.json(rows.map(v => ({ user: publicUser(v), viewedAt: v.viewed_at, reaction: v.emoji })));
}));

r.post('/stories/:id/react', ah(async (req, res) => {
  const s = await ownedOrVisible(req);
  if (s.user_id === req.user.id) throw err(400, 'Você não pode reagir ao seu próprio story.');
  const emoji = str(req.body.emoji, { name: 'Emoji', min: 1, max: 16 });
  await db.query(`INSERT INTO story_reactions (story_id, user_id, emoji) VALUES ($1,$2,$3) ON CONFLICT (story_id,user_id) DO UPDATE SET emoji=EXCLUDED.emoji, created_at=now()`, [s.id, req.user.id, emoji]);
  await db.query('INSERT INTO story_views (story_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [s.id, req.user.id]);
  await notify(s.user_id, 'story_reaction', req.user.id, { storyId: s.id, emoji });
  res.json({ ok: true });
}));

// resposta privada: vira uma mensagem na conversa direta com o autor
r.post('/stories/:id/reply', ah(async (req, res) => {
  const s = await ownedOrVisible(req);
  if (s.user_id === req.user.id) throw err(400, 'Responda aos stories de outras pessoas.');
  const text = str(req.body.text, { name: 'Resposta', min: 1, max: 1000 });
  const key = s.user_id < req.user.id ? `${s.user_id}:${req.user.id}` : `${req.user.id}:${s.user_id}`;
  let conv = await db.one('SELECT * FROM conversations WHERE dm_key=$1', [key]);
  if (!conv) {
    conv = await db.tx(async t => {
      const c = await t.one(`INSERT INTO conversations (type, dm_key) VALUES ('dm',$1) RETURNING *`, [key]);
      await t.query(`INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1,$2),($1,$3)`, [c.id, req.user.id, s.user_id]);
      return c;
    });
    hub.joinConv(req.user.id, conv.id); hub.joinConv(s.user_id, conv.id);
  }
  const a = await conversationAccess(conv.id, req.user.id);
  if (!a.canSend) throw err(403, 'Não é possível responder a este usuário.');
  const msg = await createMessage({
    convId: conv.id, senderId: req.user.id, type: 'story_reply', content: text, access: a,
    meta: { storyId: s.id, storyType: s.type, storyText: s.text.slice(0, 80), storyThumb: s.type === 'image' ? fileUrl(s.file_id) : null }
  });
  hub.toUser(s.user_id, 'conversations:changed', {});
  await notify(s.user_id, 'story_reply', req.user.id, { storyId: s.id, conversationId: conv.id, preview: text.slice(0, 80) });
  res.status(201).json({ ok: true, conversationId: conv.id, message: msg });
}));

r.delete('/stories/:id', ah(async (req, res) => {
  const s = await db.one('SELECT * FROM stories WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL', [int(req.params.id, { min: 1 }), req.user.id]);
  if (!s) throw err(404, 'Story não encontrado.');
  await db.query('UPDATE stories SET deleted_at=now() WHERE id=$1', [s.id]);
  if (s.file_id) await db.query('UPDATE files SET deleted_at=now() WHERE id=$1', [s.file_id]);
  const friends = await db.many('SELECT friend_id FROM friends WHERE user_id=$1', [req.user.id]);
  hub.toUsers([req.user.id, ...friends.map(f => f.friend_id)], 'stories:changed', { userId: req.user.id });
  res.json({ ok: true });
}));

r.get('/stories/archive', ah(async (req, res) => {
  const rows = await db.many(`SELECT s.*, (SELECT count(*)::int FROM story_views v WHERE v.story_id=s.id) AS views
    FROM stories s WHERE s.user_id=$1 AND s.deleted_at IS NULL ORDER BY s.created_at DESC LIMIT 200`, [req.user.id]);
  res.json(rows.map(s => serialize(s, { views: s.views })));
}));

module.exports = { router: r, canSeeStory };
