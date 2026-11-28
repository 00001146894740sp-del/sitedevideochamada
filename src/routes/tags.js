// Tags de servidor (3 letras, ex.: #CPX), impulso de comunidades e aparência dos selos ao lado do nome.
// Impulso, tags e selos só podem ser alterados pelo DONO da plataforma.
const express = require('express');
const db = require('../db');
const hub = require('../hub');
const settings = require('../settings');
const { upload, storeFile } = require('../files');
const { requireRole, adminLog } = require('../security');
const { notify } = require('../notify');
const { ah, err, str, int, oneOf, fileUrl } = require('../util');

const r = express.Router();
const owner = express.Router();
owner.use(requireRole('owner'));

const HEX = /^#[0-9a-fA-F]{6}$/;
const colorsOf = (v, def) => {
  const arr = typeof v === 'string' ? JSON.parse(v || '[]') : (v || []);
  const out = (Array.isArray(arr) ? arr : []).filter(c => HEX.test(c)).slice(0, 4);
  return out.length ? out : def;
};
const tagCopy = (c, tag) => ({ communityId: c.id, community: c.name, ...tag });

// avisa todos os sockets para atualizar nomes (tags/selos mudam a aparência em todo lugar)
const broadcastUsers = async ids => { for (const id of ids) hub.io?.emit('user:update', { id, tag: (await db.one('SELECT server_tag FROM users WHERE id=$1', [id]))?.server_tag || null }); };

// ===== usuário escolhe qual tag de servidor exibir =====
r.post('/users/me/server-tag', ah(async (req, res) => {
  let value = null;
  if (req.body.communityId) {
    const c = await db.one(`SELECT c.* FROM communities c JOIN community_members m ON m.community_id=c.id AND m.user_id=$2
      WHERE c.id=$1 AND c.removed_at IS NULL`, [int(req.body.communityId, { min: 1 }), req.user.id]);
    if (!c) throw err(403, 'Você precisa ser membro da comunidade.');
    if (!c.tag) throw err(400, 'Esta comunidade ainda não tem tag.');
    value = tagCopy(c, c.tag);
  }
  await db.query('UPDATE users SET server_tag=$1 WHERE id=$2', [value, req.user.id]);
  hub.io?.emit('user:update', { id: req.user.id, tag: value });
  res.json({ ok: true, tag: value });
}));

// comunidades das quais o usuário é membro e que têm tag
r.get('/users/me/server-tags', ah(async (req, res) => {
  const rows = await db.many(`SELECT c.id, c.name, c.tag, c.boost_level FROM communities c JOIN community_members m ON m.community_id=c.id
    WHERE m.user_id=$1 AND c.tag IS NOT NULL AND c.removed_at IS NULL ORDER BY c.boost_level DESC, c.name`, [req.user.id]);
  res.json(rows.map(c => ({ communityId: c.id, name: c.name, boostLevel: c.boost_level, tag: c.tag })));
}));

// Cartão do servidor de origem de uma tag (ao clicar em #CPX). A tag já é pública, então
// nome/logo/tag aparecem mesmo para servidor privado; descrição e entrada só se for público.
r.get('/server-tags/:communityId', ah(async (req, res) => {
  const c = await db.one('SELECT * FROM communities WHERE id=$1 AND removed_at IS NULL', [int(req.params.communityId, { min: 1 })]);
  if (!c || !c.tag) throw err(404, 'Esta tag não está mais ativa.');
  const [count, mem, ban] = await Promise.all([
    db.one('SELECT count(*)::int AS n FROM community_members WHERE community_id=$1', [c.id]),
    db.one('SELECT 1 FROM community_members WHERE community_id=$1 AND user_id=$2', [c.id, req.user.id]),
    db.one('SELECT 1 FROM community_bans WHERE community_id=$1 AND user_id=$2', [c.id, req.user.id])
  ]);
  const open = c.is_public || !!mem;
  res.json({
    id: c.id, name: c.name, logo: fileUrl(c.logo_file_id), banner: open ? fileUrl(c.banner_file_id) : null,
    description: open ? c.description : null, verified: !!c.verified, boostLevel: c.boost_level || 0, tag: c.tag,
    isPublic: c.is_public, memberCount: count.n, isMember: !!mem, banned: !!ban
  });
}));

// ===== DONO: impulso e tag de comunidade =====
owner.patch('/communities/:id/boost', upload.single('file'), ah(async (req, res) => {
  const c = await db.one('SELECT * FROM communities WHERE id=$1', [int(req.params.id, { min: 1 })]);
  if (!c) throw err(404, 'Comunidade não encontrada.');
  const level = int(req.body.level, { name: 'Nível de impulso', min: 0, max: 3, def: c.boost_level });
  let tag = c.tag;
  if (req.body.removeTag === 'true' || req.body.removeTag === true) tag = null;
  else if (req.body.tagText !== undefined && req.body.tagText !== '') {
    const text = str(req.body.tagText, { name: 'Tag', min: 2, max: 4 }).toUpperCase();
    if (!/^[A-Z0-9]{2,4}$/.test(text)) throw err(400, 'A tag deve ter de 2 a 4 letras ou números (ex.: CPX).');
    const mode = oneOf(req.body.mode, ['ui', 'png'], 'Estilo', 'ui');
    tag = { text, mode, colors: colorsOf(req.body.colors, ['#9d4dff', '#f5c542']), textColor: HEX.test(req.body.textColor || '') ? req.body.textColor : '#ffffff' };
    if (mode === 'png') {
      if (req.file) tag.imageUrl = (await storeFile(req.file, req.user.id, 'public', { allowKinds: ['image'] })).url;
      else if (c.tag?.imageUrl) tag.imageUrl = c.tag.imageUrl;
      else throw err(400, 'Envie o PNG do ícone da tag.');
    }
  }
  await db.query('UPDATE communities SET boost_level=$1, tag=$2 WHERE id=$3', [level, tag, c.id]);
  // atualiza (ou remove) a cópia em quem usa a tag desta comunidade
  const users = await db.many(`UPDATE users SET server_tag=$1 WHERE (server_tag->>'communityId')::bigint=$2 RETURNING id`, [tag ? tagCopy(c, tag) : null, c.id]);
  await broadcastUsers(users.map(u => u.id));
  if (level > c.boost_level) await notify(c.owner_id, 'admin', req.user.id, { text: `Sua comunidade "${c.name}" recebeu impulso nível ${level}! 💎` });
  if (tag && !c.tag) await notify(c.owner_id, 'admin', req.user.id, { text: `Sua comunidade "${c.name}" ganhou a tag #${tag.text}! Os membros já podem usá-la no perfil.` });
  const members = await db.many('SELECT user_id FROM community_members WHERE community_id=$1', [c.id]);
  hub.toUsers(members.map(m => m.user_id), 'community:update', { id: c.id });
  await adminLog(req, 'community_boost', 'community', c.id, { level, tag: tag?.text || null });
  res.json({ ok: true, boostLevel: level, tag });
}));

// ===== DONO: aparência dos selos (verificado e cargos) =====
const BADGE_KEYS = ['verified', 'owner', 'admin', 'moderator', 'support'];
owner.patch('/badge-styles/:key', upload.single('file'), ah(async (req, res) => {
  const key = oneOf(req.params.key, BADGE_KEYS, 'Selo');
  const all = { ...(await settings.getSetting('badge_styles') || {}) };
  const cur = all[key] || {};
  const mode = oneOf(req.body.mode, ['ui', 'png', 'off'], 'Estilo', 'ui');
  const next = {
    mode,
    text: str(req.body.text, { name: 'Texto', max: 14, required: false }) || cur.text || key.toUpperCase(),
    colors: colorsOf(req.body.colors, cur.colors || ['#9d4dff', '#f5c542']),
    textColor: HEX.test(req.body.textColor || '') ? req.body.textColor : (cur.textColor || '#ffffff'),
    icon: key === 'verified' ? 'check' : undefined
  };
  if (mode === 'png') {
    if (req.file) next.imageUrl = (await storeFile(req.file, req.user.id, 'public', { allowKinds: ['image'] })).url;
    else if (cur.imageUrl) next.imageUrl = cur.imageUrl;
    else throw err(400, 'Envie o PNG do selo.');
  }
  all[key] = next;
  await settings.setSetting('badge_styles', all);
  hub.io?.emit('badge-styles', all);
  await adminLog(req, 'badge_style_updated', 'settings', key, { mode });
  res.json(all);
}));

module.exports = { router: r, ownerRouter: owner };
