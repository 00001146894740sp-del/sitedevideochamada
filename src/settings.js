const db = require('./db');

let cache = null;
let cacheAt = 0;

async function all() {
  if (cache && Date.now() - cacheAt < 30000) return cache;
  const rows = await db.many('SELECT key, value FROM site_settings');
  cache = Object.fromEntries(rows.map(r => [r.key, r.value]));
  cacheAt = Date.now();
  return cache;
}
async function getSetting(key) {
  return (await all())[key];
}
async function setSetting(key, value) {
  await db.query(`INSERT INTO site_settings(key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [key, JSON.stringify(value)]);
  cache = null;
}
module.exports = { all, getSetting, setSetting };
