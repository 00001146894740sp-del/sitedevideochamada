// Uso: npm run make-owner -- usuario_ou_email
const db = require('../src/db');

(async () => {
  const ident = process.argv[2];
  if (!ident) { console.error('Informe o nome de usuário ou e-mail: npm run make-owner -- fulano'); process.exit(1); }
  const u = await db.one(`UPDATE users SET global_role='owner' WHERE lower(username)=lower($1) OR lower(email)=lower($1) RETURNING id, username`, [ident]);
  if (!u) { console.error('Usuário não encontrado.'); process.exit(1); }
  await db.query(`INSERT INTO user_badges (user_id, badge_code) VALUES ($1,'staff') ON CONFLICT DO NOTHING`, [u.id]);
  await db.query(`INSERT INTO admin_logs (action, target_type, target_id, data) VALUES ('owner_set_cli','user',$1,'{}')`, [String(u.id)]);
  console.log(`✔ ${u.username} agora é o dono da plataforma.`);
  await db.pool.end();
})().catch(e => { console.error(e); process.exit(1); });
