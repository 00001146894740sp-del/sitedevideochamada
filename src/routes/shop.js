// Carteira GG, loja de cosméticos (molduras e efeitos de perfil) e anúncios recompensados.
// Sem pagamento real: GG só é obtido assistindo anúncios ou por concessão da administração.
const express = require('express');
const db = require('../db');
const hub = require('../hub');
const { upload, storeFile } = require('../files');
const { requireRole, adminLog } = require('../security');
const { notify } = require('../notify');
const { ah, err, str, int, bool, oneOf, fileUrl } = require('../util');

const r = express.Router();     // usuários
const admin = express.Router(); // /api/admin/...
admin.use(requireRole('admin'));

const FRAME_KINDS = ['ring', 'spin', 'pulse', 'image'];
const EFFECT_KINDS = ['gif', 'sparkles', 'confetti', 'snow', 'fireworks'];
const RARITIES = ['comum', 'raro', 'epico', 'lendario'];

// movimenta a carteira dentro de uma transação (t) e registra no extrato
async function moveGG(t, userId, amount, reason, ref) {
  const u = await t.one(`UPDATE users SET gg_balance = gg_balance + $1 WHERE id=$2 AND gg_balance + $1 >= 0 RETURNING gg_balance`, [amount, userId]);
  if (!u) throw err(400, 'Saldo de GG insuficiente.');
  await t.query(`INSERT INTO gg_transactions (user_id, amount, reason, ref, balance_after) VALUES ($1,$2,$3,$4,$5)`,
    [userId, amount, reason, ref == null ? null : String(ref), u.gg_balance]);
  return u.gg_balance;
}

const serializeItem = (i, extra = {}) => ({
  id: i.id, type: i.type, name: i.name, description: i.description, price: i.price, rarity: i.rarity,
  config: i.config, active: i.active, createdAt: i.created_at, ...extra
});
// o que fica copiado no usuário ao equipar
const equipCopy = i => ({ id: i.id, name: i.name, rarity: i.rarity, ...i.config });

// ===================== CARTEIRA =====================
r.get('/wallet', ah(async (req, res) => {
  const u = await db.one('SELECT gg_balance FROM users WHERE id=$1', [req.user.id]);
  const tx = await db.many('SELECT amount, reason, created_at, balance_after FROM gg_transactions WHERE user_id=$1 ORDER BY id DESC LIMIT 50', [req.user.id]);
  res.json({ balance: u.gg_balance, transactions: tx });
}));

// ===================== LOJA =====================
r.get('/shop/items', ah(async (req, res) => {
  const items = await db.many(`SELECT i.*, (ui.user_id IS NOT NULL) AS owned FROM shop_items i
    LEFT JOIN user_items ui ON ui.item_id=i.id AND ui.user_id=$1
    WHERE i.active OR ui.user_id IS NOT NULL ORDER BY i.type, i.price, i.id`, [req.user.id]);
  const u = await db.one('SELECT gg_balance, equipped_frame, equipped_effect FROM users WHERE id=$1', [req.user.id]);
  res.json({
    balance: u.gg_balance,
    equipped: { frame: u.equipped_frame?.id || null, effect: u.equipped_effect?.id || null },
    items: items.map(i => serializeItem(i, { owned: i.owned }))
  });
}));

r.post('/shop/items/:id/buy', ah(async (req, res) => {
  const id = int(req.params.id, { min: 1 });
  const result = await db.tx(async t => {
    const item = await t.one('SELECT * FROM shop_items WHERE id=$1 AND active', [id]);
    if (!item) throw err(404, 'Item indisponível.');
    const owned = await t.one('SELECT 1 FROM user_items WHERE user_id=$1 AND item_id=$2', [req.user.id, id]);
    if (owned) throw err(409, 'Você já tem este item.');
    const balance = await moveGG(t, req.user.id, -item.price, `Compra: ${item.name}`, `item:${id}`);
    await t.query('INSERT INTO user_items (user_id, item_id, price_paid) VALUES ($1,$2,$3)', [req.user.id, id, item.price]);
    return { balance, item };
  });
  hub.toUser(req.user.id, 'wallet', { balance: result.balance });
  res.json({ ok: true, balance: result.balance, message: `Você comprou ${result.item.name}!` });
}));

r.post('/shop/equip', ah(async (req, res) => {
  const type = oneOf(req.body.type, ['frame', 'effect'], 'Tipo');
  const col = type === 'frame' ? 'equipped_frame' : 'equipped_effect';
  let value = null;
  if (req.body.itemId) {
    const item = await db.one(`SELECT i.* FROM shop_items i JOIN user_items ui ON ui.item_id=i.id AND ui.user_id=$1 WHERE i.id=$2 AND i.type=$3`,
      [req.user.id, int(req.body.itemId, { min: 1 }), type]);
    if (!item) throw err(403, 'Você não possui este item.');
    value = equipCopy(item);
  }
  const u = await db.one(`UPDATE users SET ${col}=$1 WHERE id=$2 RETURNING *`, [value, req.user.id]);
  // avisa amigos para atualizarem a moldura em tempo real
  const friends = await db.many('SELECT friend_id FROM friends WHERE user_id=$1', [u.id]);
  hub.toUsers([u.id, ...friends.map(f => f.friend_id)], 'user:update', { id: u.id, frame: u.equipped_frame });
  res.json({ ok: true, equipped: value });
}));

// ===================== ANÚNCIOS =====================
r.get('/ads', ah(async (req, res) => {
  const rows = await db.many(`SELECT a.*, f.kind AS media_kind,
      (SELECT count(*)::int FROM ad_views v WHERE v.ad_id=a.id AND v.user_id=$1 AND v.claimed_at > now() - interval '1 day') AS used_today
    FROM ads a LEFT JOIN files f ON f.id=a.file_id WHERE a.active ORDER BY a.reward DESC, a.id DESC`, [req.user.id]);
  res.json(rows.map(a => ({
    id: a.id, title: a.title, description: a.description, mediaUrl: fileUrl(a.file_id), mediaKind: a.media_kind, linkUrl: a.link_url,
    watchSeconds: a.watch_seconds, reward: a.reward, dailyLimit: a.daily_limit, usedToday: a.used_today,
    remainingToday: Math.max(0, a.daily_limit - a.used_today)
  })));
}));

r.post('/ads/:id/start', ah(async (req, res) => {
  const ad = await db.one('SELECT * FROM ads WHERE id=$1 AND active', [int(req.params.id, { min: 1 })]);
  if (!ad) throw err(404, 'Anúncio indisponível.');
  const used = await db.one(`SELECT count(*)::int AS n FROM ad_views WHERE ad_id=$1 AND user_id=$2 AND claimed_at > now() - interval '1 day'`, [ad.id, req.user.id]);
  if (used.n >= ad.daily_limit) throw err(429, 'Você já atingiu o limite deste anúncio nas últimas 24 horas.');
  // impede abrir dezenas de visualizações em paralelo
  const open = await db.one(`SELECT count(*)::int AS n FROM ad_views WHERE user_id=$1 AND claimed_at IS NULL AND started_at > now() - interval '10 minutes'`, [req.user.id]);
  if (open.n >= 3) throw err(429, 'Termine os anúncios abertos antes de começar outro.');
  const v = await db.one('INSERT INTO ad_views (ad_id, user_id) VALUES ($1,$2) RETURNING id, started_at', [ad.id, req.user.id]);
  res.json({ viewId: v.id, watchSeconds: ad.watch_seconds, reward: ad.reward });
}));

r.post('/ads/views/:viewId/claim', ah(async (req, res) => {
  const out = await db.tx(async t => {
    const v = await t.one(`SELECT v.*, a.watch_seconds, a.reward AS ad_reward, a.daily_limit, a.title, a.active,
        EXTRACT(EPOCH FROM (now() - v.started_at)) AS elapsed
      FROM ad_views v JOIN ads a ON a.id=v.ad_id WHERE v.id=$1 AND v.user_id=$2 FOR UPDATE OF v`, [int(req.params.viewId, { min: 1 }), req.user.id]);
    if (!v) throw err(404, 'Visualização não encontrada.');
    if (v.claimed_at) throw err(409, 'Recompensa já resgatada.');
    if (!v.active) throw err(410, 'Este anúncio foi encerrado.');
    if (Number(v.elapsed) < v.watch_seconds - 1) throw err(400, `Assista ao anúncio por ${v.watch_seconds} segundos para ganhar a recompensa.`);
    if (Number(v.elapsed) > v.watch_seconds + 3600) throw err(410, 'Visualização expirada. Assista novamente.');
    const used = await t.one(`SELECT count(*)::int AS n FROM ad_views WHERE ad_id=$1 AND user_id=$2 AND claimed_at > now() - interval '1 day'`, [v.ad_id, req.user.id]);
    if (used.n >= v.daily_limit) throw err(429, 'Limite diário deste anúncio atingido.');
    await t.query('UPDATE ad_views SET claimed_at=now(), reward=$1 WHERE id=$2', [v.ad_reward, v.id]);
    const balance = await moveGG(t, req.user.id, v.ad_reward, `Anúncio: ${v.title}`, `ad:${v.ad_id}`);
    return { balance, reward: v.ad_reward };
  });
  hub.toUser(req.user.id, 'wallet', { balance: out.balance });
  res.json({ ok: true, ...out });
}));

// ===================== ADMIN: LOJA =====================
function hexList(v) {
  if (!Array.isArray(v) || !v.length || v.length > 8) throw err(400, 'Informe de 1 a 8 cores.');
  return v.map(c => { if (!/^#[0-9a-fA-F]{6}$/.test(c)) throw err(400, 'Cor inválida.'); return c; });
}
async function parseItem(req, existing) {
  const b = req.body;
  const type = existing ? existing.type : oneOf(b.type, ['frame', 'effect'], 'Tipo');
  const cfgIn = typeof b.config === 'string' ? JSON.parse(b.config || '{}') : (b.config || {});
  const config = {};
  if (type === 'frame') {
    config.kind = oneOf(cfgIn.kind, FRAME_KINDS, 'Estilo da moldura');
    if (config.kind === 'image') {
      if (req.file) config.imageUrl = (await storeFile(req.file, req.user.id, 'public', { allowKinds: ['image'] })).url;
      else if (existing?.config?.imageUrl) config.imageUrl = existing.config.imageUrl;
      else throw err(400, 'Envie a imagem da moldura (PNG com o centro transparente).');
    } else config.colors = hexList(cfgIn.colors);
  } else {
    config.kind = oneOf(cfgIn.kind, EFFECT_KINDS, 'Tipo de efeito');
    if (config.kind === 'gif') {
      if (req.file) config.imageUrl = (await storeFile(req.file, req.user.id, 'public', { allowKinds: ['image'] })).url;
      else if (existing?.config?.imageUrl) config.imageUrl = existing.config.imageUrl;
      else throw err(400, 'Envie o GIF do efeito (GIF, WebP ou PNG animado).');
      config.placement = oneOf(cfgIn.placement, ['full', 'banner', 'avatar'], 'Posição', 'full');
      config.duration = int(cfgIn.duration, { name: 'Duração (1 a 15 s)', min: 1, max: 15, def: 4 });
    } else if (config.kind === 'emoji') {
      const em = Array.isArray(cfgIn.emoji) ? cfgIn.emoji : String(cfgIn.emoji || '').split(/\s+/);
      config.emoji = em.map(e => str(e, { max: 16, required: false })).filter(Boolean).slice(0, 6);
      if (!config.emoji.length) throw err(400, 'Informe ao menos um emoji.');
      config.direction = oneOf(cfgIn.direction, ['up', 'down'], 'Direção', 'down');
    } else config.colors = hexList(cfgIn.colors);
  }
  return {
    type, config,
    name: str(b.name, { name: 'Nome', min: 2, max: 40 }),
    description: str(b.description, { name: 'Descrição', max: 200, required: false }),
    price: int(b.price, { name: 'Preço', min: 0, max: 10000000 }),
    rarity: oneOf(b.rarity, RARITIES, 'Raridade', 'comum'),
    active: bool(b.active, true)
  };
}

admin.get('/shop/items', ah(async (req, res) => {
  const rows = await db.many(`SELECT i.*, (SELECT count(*)::int FROM user_items u WHERE u.item_id=i.id) AS owners FROM shop_items i ORDER BY i.type, i.id`);
  res.json(rows.map(i => serializeItem(i, { owners: i.owners })));
}));
admin.post('/shop/items', upload.single('file'), ah(async (req, res) => {
  const it = await parseItem(req);
  const row = await db.one(`INSERT INTO shop_items (type, name, description, price, rarity, config, active, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [it.type, it.name, it.description, it.price, it.rarity, it.config, it.active, req.user.id]);
  await adminLog(req, 'shop_item_created', 'shop_item', row.id, { name: it.name, price: it.price });
  res.status(201).json(serializeItem(row));
}));
admin.patch('/shop/items/:id', upload.single('file'), ah(async (req, res) => {
  const ex = await db.one('SELECT * FROM shop_items WHERE id=$1', [int(req.params.id, { min: 1 })]);
  if (!ex) throw err(404, 'Item não encontrado.');
  const it = await parseItem(req, ex);
  const row = await db.one(`UPDATE shop_items SET name=$1, description=$2, price=$3, rarity=$4, config=$5, active=$6 WHERE id=$7 RETURNING *`,
    [it.name, it.description, it.price, it.rarity, it.config, it.active, ex.id]);
  // atualiza a cópia em quem está usando
  const col = row.type === 'frame' ? 'equipped_frame' : 'equipped_effect';
  await db.query(`UPDATE users SET ${col}=$1 WHERE (${col}->>'id')::bigint=$2`, [equipCopy(row), row.id]);
  await adminLog(req, 'shop_item_updated', 'shop_item', row.id, { name: it.name, price: it.price, active: it.active });
  res.json(serializeItem(row));
}));

// ===================== ADMIN: ANÚNCIOS =====================
async function parseAd(req, ex) {
  const b = req.body;
  const out = {
    title: str(b.title, { name: 'Título', min: 2, max: 80 }),
    description: str(b.description, { name: 'Descrição', max: 300, required: false }),
    link_url: str(b.linkUrl, { name: 'Link', max: 300, required: false }) || null,
    watch_seconds: int(b.watchSeconds, { name: 'Tempo de visualização (3 a 600 s)', min: 3, max: 600 }),
    reward: int(b.reward, { name: 'Recompensa (1 a 100000 GG)', min: 1, max: 100000 }),
    daily_limit: int(b.dailyLimit, { name: 'Limite diário (1 a 100)', min: 1, max: 100, def: 3 }),
    active: bool(b.active, true),
    file_id: ex?.file_id || null
  };
  if (out.link_url && !/^https:\/\//i.test(out.link_url)) throw err(400, 'O link precisa começar com https://');
  if (req.file) out.file_id = (await storeFile(req.file, req.user.id, 'public', { allowKinds: ['image', 'video'] })).id;
  if (!out.file_id) throw err(400, 'Envie a imagem ou o vídeo do anúncio.');
  return out;
}
admin.get('/ads', ah(async (req, res) => {
  const rows = await db.many(`SELECT a.*, f.kind AS media_kind,
      (SELECT count(*)::int FROM ad_views v WHERE v.ad_id=a.id AND v.claimed_at IS NOT NULL) AS views,
      (SELECT coalesce(sum(reward),0)::int FROM ad_views v WHERE v.ad_id=a.id) AS paid
    FROM ads a LEFT JOIN files f ON f.id=a.file_id ORDER BY a.id DESC`);
  res.json(rows.map(a => ({ id: a.id, title: a.title, description: a.description, mediaUrl: fileUrl(a.file_id), mediaKind: a.media_kind, linkUrl: a.link_url,
    watchSeconds: a.watch_seconds, reward: a.reward, dailyLimit: a.daily_limit, active: a.active, views: a.views, paid: a.paid, createdAt: a.created_at })));
}));
admin.post('/ads', upload.single('file'), ah(async (req, res) => {
  const a = await parseAd(req);
  const row = await db.one(`INSERT INTO ads (title, description, link_url, watch_seconds, reward, daily_limit, active, file_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [a.title, a.description, a.link_url, a.watch_seconds, a.reward, a.daily_limit, a.active, a.file_id, req.user.id]);
  await adminLog(req, 'ad_created', 'ad', row.id, { title: a.title, reward: a.reward, seconds: a.watch_seconds });
  res.status(201).json({ id: row.id });
}));
admin.patch('/ads/:id', upload.single('file'), ah(async (req, res) => {
  const ex = await db.one('SELECT * FROM ads WHERE id=$1', [int(req.params.id, { min: 1 })]);
  if (!ex) throw err(404, 'Anúncio não encontrado.');
  const a = await parseAd(req, ex);
  await db.query(`UPDATE ads SET title=$1, description=$2, link_url=$3, watch_seconds=$4, reward=$5, daily_limit=$6, active=$7, file_id=$8 WHERE id=$9`,
    [a.title, a.description, a.link_url, a.watch_seconds, a.reward, a.daily_limit, a.active, a.file_id, ex.id]);
  await adminLog(req, 'ad_updated', 'ad', ex.id, { title: a.title, reward: a.reward, active: a.active });
  res.json({ ok: true });
}));

// ===================== ADMIN: VERIFICAÇÃO E GG =====================
admin.post('/users/:id/verify', ah(async (req, res) => {
  const v = bool(req.body.verified);
  const u = await db.one('UPDATE users SET verified=$1 WHERE id=$2 RETURNING *', [v, int(req.params.id, { min: 1 })]);
  if (!u) throw err(404, 'Usuário não encontrado.');
  if (v) await db.query(`INSERT INTO user_badges (user_id, badge_code, awarded_by) VALUES ($1,'verified',$2) ON CONFLICT DO NOTHING`, [u.id, req.user.id]);
  else await db.query(`DELETE FROM user_badges WHERE user_id=$1 AND badge_code='verified'`, [u.id]);
  if (v) await notify(u.id, 'admin', req.user.id, { text: 'Sua conta agora é verificada! ✔️' });
  await adminLog(req, v ? 'user_verified' : 'user_unverified', 'user', u.id);
  hub.io?.emit('user:update', { id: u.id, verified: v });
  res.json({ ok: true });
}));
admin.post('/communities/:id/verify', ah(async (req, res) => {
  const v = bool(req.body.verified);
  const c = await db.one('UPDATE communities SET verified=$1 WHERE id=$2 RETURNING *', [v, int(req.params.id, { min: 1 })]);
  if (!c) throw err(404, 'Comunidade não encontrada.');
  if (v) await notify(c.owner_id, 'admin', req.user.id, { text: `Sua comunidade "${c.name}" agora é verificada! ✔️` });
  await adminLog(req, v ? 'community_verified' : 'community_unverified', 'community', c.id, { name: c.name });
  res.json({ ok: true });
}));
admin.post('/users/:id/gg', ah(async (req, res) => {
  const amount = int(req.body.amount, { name: 'Quantidade', min: -10000000, max: 10000000 });
  if (!amount) throw err(400, 'Informe uma quantidade diferente de zero.');
  const reason = str(req.body.reason, { name: 'Motivo', min: 2, max: 100 });
  const id = int(req.params.id, { min: 1 });
  const balance = await db.tx(t => moveGG(t, id, amount, `Administração: ${reason}`, `admin:${req.user.id}`));
  if (amount > 0) await notify(id, 'admin', req.user.id, { text: `Você recebeu ${amount} GG! Motivo: ${reason}` });
  hub.toUser(id, 'wallet', { balance });
  await adminLog(req, 'gg_adjusted', 'user', id, { amount, reason });
  res.json({ ok: true, balance });
}));
admin.get('/economy', ah(async (req, res) => {
  const s = await db.one(`SELECT (SELECT coalesce(sum(gg_balance),0)::bigint FROM users) AS circulating,
    (SELECT coalesce(sum(amount),0)::bigint FROM gg_transactions WHERE amount>0 AND created_at > now() - interval '7 days') AS earned_7d,
    (SELECT coalesce(-sum(amount),0)::bigint FROM gg_transactions WHERE amount<0 AND created_at > now() - interval '7 days') AS spent_7d,
    (SELECT count(*)::int FROM ad_views WHERE claimed_at > now() - interval '1 day') AS ad_views_24h,
    (SELECT count(*)::int FROM users WHERE verified) AS verified_users`);
  res.json(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, Number(v)])));
}));

module.exports = { router: r, adminRouter: admin, moveGG };
