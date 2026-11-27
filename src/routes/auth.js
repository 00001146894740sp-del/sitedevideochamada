const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const mailer = require('../mailer');
const hub = require('../hub');
const { getSetting } = require('../settings');
const { createSession, destroySession, requireAuth, tokenHash, adminLog } = require('../security');
const { awardBadge } = require('../notify');
const {
  ah, err, str, USERNAME_RE, EMAIL_RE, randomToken, clientIp, publicUser,
  DEFAULT_SETTINGS, DEFAULT_PRIVACY, mergeDeep
} = require('../util');

const r = express.Router();
const DUMMY_HASH = bcrypt.hashSync('dummy-password-0', 12);

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde alguns minutos.' } });
const mailLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 6, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Muitos pedidos de e-mail. Tente mais tarde.' } });

const validPassword = p => {
  const s = str(p, { name: 'Senha', min: 8, max: 128, trim: false });
  if (!/[A-Za-z]/.test(s) || !/[0-9]/.test(s)) throw err(400, 'A senha precisa ter letras e números.');
  return s;
};

async function logLogin(userId, identifier, method, success, req) {
  await db.query(`INSERT INTO login_history (user_id, identifier, method, success, ip, user_agent) VALUES ($1,$2,$3,$4,$5,$6)`,
    [userId, identifier, method, success, clientIp(req), (req.headers['user-agent'] || '').slice(0, 300)]);
}

async function issueEmailToken(userId, type, ttlMin) {
  const token = randomToken(32);
  await db.query(`UPDATE email_tokens SET used_at=now() WHERE user_id=$1 AND type=$2 AND used_at IS NULL`, [userId, type]);
  await db.query(`INSERT INTO email_tokens (user_id, token_hash, type, expires_at) VALUES ($1,$2,$3, now() + ($4 || ' minutes')::interval)`,
    [userId, tokenHash(token), type, String(ttlMin)]);
  return token;
}

async function sendVerification(user) {
  if (!user.email) return;
  const token = await issueEmailToken(user.id, 'verify', 60 * 24);
  await mailer.sendVerification(user.email, user.display_name, `${config.appUrl}/?verify=${token}`);
}

async function maybeGrantOwner(user) {
  if (config.ownerEmail && user.email && user.email.toLowerCase() === config.ownerEmail && user.email_verified && user.global_role !== 'owner') {
    await db.query(`UPDATE users SET global_role='owner' WHERE id=$1`, [user.id]);
    await awardBadge(user.id, 'staff');
    user.global_role = 'owner';
  }
}

async function afterSignup(user) {
  if (user.id <= 1000) await awardBadge(user.id, 'pioneer');
  await maybeGrantOwner(user);
}

function selfPayload(u, session) {
  return {
    user: {
      ...publicUser(u, { full: true }),
      email: u.email,
      emailVerified: u.email_verified,
      presence: u.presence,
      hasPassword: !!u.password_hash,
      google: !!u.google_id,
      discord: !!u.discord_id,
      deletionRequestedAt: u.deletion_requested_at
    },
    settings: mergeDeep(DEFAULT_SETTINGS, u.settings),
    privacy: mergeDeep(DEFAULT_PRIVACY, u.privacy),
    csrfToken: session?.csrf
  };
}

r.get('/config', ah(async (req, res) => {
  res.json({
    google: !!(config.google.clientId && config.google.clientSecret),
    discord: !!(config.discord.clientId && config.discord.clientSecret),
    emailEnabled: mailer.enabled,
    requireEmailVerification: config.requireEmailVerification && mailer.enabled,
    registrationOpen: (await getSetting('registration_open')) !== false,
    maintenanceNotice: await getSetting('maintenance_notice'),
    maxUploadMb: Math.min(Number(await getSetting('max_upload_mb')) || 25, config.maxUploadMb),
    gifs: !!config.tenorApiKey,
    ownerClaimAvailable: !!process.env.OWNER_SETUP_TOKEN
  });
}));

r.post('/register', authLimiter, ah(async (req, res) => {
  if ((await getSetting('registration_open')) === false) throw err(403, 'Novos cadastros estão temporariamente fechados.');
  const username = str(req.body.username, { name: 'Nome de usuário', min: 3, max: 24 });
  if (!USERNAME_RE.test(username)) throw err(400, 'Nome de usuário: use 3–24 letras, números, _ ou ponto.');
  const email = str(req.body.email, { name: 'E-mail', min: 5, max: 254 }).toLowerCase();
  if (!EMAIL_RE.test(email)) throw err(400, 'E-mail inválido.');
  const password = validPassword(req.body.password);
  const displayName = str(req.body.displayName || username, { name: 'Nome de exibição', min: 1, max: 40 });

  const exists = await db.one(`SELECT lower(username)=lower($1) AS u, lower(email)=lower($2) AS e FROM users WHERE lower(username)=lower($1) OR lower(email)=lower($2) LIMIT 1`, [username, email]);
  if (exists?.u) throw err(409, 'Esse nome de usuário já está em uso.');
  if (exists?.e) throw err(409, 'Esse e-mail já está cadastrado.');

  const hash = await bcrypt.hash(password, 12);
  const user = await db.one(
    `INSERT INTO users (username, email, password_hash, display_name) VALUES ($1,$2,$3,$4) RETURNING *`,
    [username, email, hash, displayName]);
  await afterSignup(user);
  await sendVerification(user).catch(e => console.error('[mail]', e.message));
  await logLogin(user.id, username, 'register', true, req);

  if (config.requireEmailVerification && mailer.enabled) {
    return res.status(201).json({ needsVerification: true, message: 'Conta criada! Confirme seu e-mail para entrar.' });
  }
  const s = await createSession(res, req, user.id);
  res.status(201).json(selfPayload(user, { csrf: s.csrf }));
}));

r.post('/login', authLimiter, ah(async (req, res) => {
  const identifier = str(req.body.identifier, { name: 'Usuário ou e-mail', min: 3, max: 254 });
  const password = str(req.body.password, { name: 'Senha', min: 1, max: 128, trim: false });

  // bloqueio após tentativas excessivas (por identificador)
  const fails = await db.one(
    `SELECT count(*)::int AS n FROM login_history
      WHERE lower(identifier)=lower($1) AND method='password' AND success=false
        AND created_at > now() - ($2 || ' minutes')::interval
        AND created_at > coalesce((SELECT max(created_at) FROM login_history WHERE lower(identifier)=lower($1) AND success), 'epoch')`,
    [identifier, String(config.loginLockMinutes)]);
  if (fails.n >= config.loginMaxAttempts) {
    throw err(429, `Muitas tentativas incorretas. Tente novamente em ${config.loginLockMinutes} minutos ou redefina sua senha.`);
  }

  const user = await db.one(`SELECT * FROM users WHERE lower(username)=lower($1) OR lower(email)=lower($1) LIMIT 1`, [identifier]);
  const ok = user && user.password_hash && await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    if (!user) await bcrypt.compare(password, DUMMY_HASH); // tempo constante
    await logLogin(user?.id || null, identifier, 'password', false, req);
    throw err(401, 'Usuário ou senha incorretos.');
  }
  await assertCanLogin(user);
  if (config.requireEmailVerification && mailer.enabled && !user.email_verified) {
    throw err(403, 'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.', 'email_unverified');
  }
  await logLogin(user.id, identifier, 'password', true, req);
  const s = await createSession(res, req, user.id);
  res.json(selfPayload(user, { csrf: s.csrf }));
}));

async function assertCanLogin(user) {
  if (user.status === 'deleted') throw err(403, 'Esta conta foi excluída.');
  if (user.status === 'banned') throw err(403, `Sua conta foi banida.${user.status_reason ? ' Motivo: ' + user.status_reason : ''}`);
  if (user.status === 'suspended') {
    if (user.suspended_until && new Date(user.suspended_until) < new Date()) {
      await db.query(`UPDATE users SET status='active', suspended_until=NULL WHERE id=$1`, [user.id]);
    } else {
      throw err(403, `Conta suspensa${user.suspended_until ? ' até ' + new Date(user.suspended_until).toLocaleString('pt-BR') : ''}.${user.status_reason ? ' Motivo: ' + user.status_reason : ''}`);
    }
  }
}

r.post('/logout', ah(async (req, res) => {
  await destroySession(req, res);
  res.json({ ok: true });
}));

r.get('/me', ah(async (req, res) => {
  if (!req.user) {
    if (req.blockedUser) return requireAuth(req, res, e => res.status(e.status).json({ error: e.message, code: e.code }));
    return res.status(401).json({ error: 'Não autenticado.' });
  }
  res.json(selfPayload(req.user, req.session));
}));

r.post('/verify-email', authLimiter, ah(async (req, res) => {
  const token = str(req.body.token, { name: 'Token', min: 10, max: 200 });
  const row = await db.one(`SELECT * FROM email_tokens WHERE token_hash=$1 AND type='verify' AND used_at IS NULL AND expires_at > now()`, [tokenHash(token)]);
  if (!row) throw err(400, 'Link de verificação inválido ou expirado.');
  await db.query(`UPDATE email_tokens SET used_at=now() WHERE id=$1`, [row.id]);
  const user = await db.one(`UPDATE users SET email_verified=true WHERE id=$1 RETURNING *`, [row.user_id]);
  await maybeGrantOwner(user);
  res.json({ ok: true, message: 'E-mail confirmado com sucesso!' });
}));

r.post('/resend-verification', mailLimiter, requireAuth, ah(async (req, res) => {
  if (req.user.email_verified) return res.json({ ok: true, message: 'Seu e-mail já está confirmado.' });
  if (!mailer.enabled) throw err(503, 'O envio de e-mails não está configurado no servidor.');
  await sendVerification(req.user);
  res.json({ ok: true, message: 'Enviamos um novo link para o seu e-mail.' });
}));

r.post('/forgot', mailLimiter, ah(async (req, res) => {
  const email = str(req.body.email, { name: 'E-mail', min: 5, max: 254 }).toLowerCase();
  const user = await db.one(`SELECT * FROM users WHERE lower(email)=$1 AND status <> 'deleted'`, [email]);
  if (user) {
    const token = await issueEmailToken(user.id, 'reset', 60);
    await mailer.sendReset(user.email, user.display_name, `${config.appUrl}/?reset=${token}`).catch(e => console.error('[mail]', e.message));
  }
  // resposta idêntica exista ou não a conta (evita enumeração)
  res.json({ ok: true, message: 'Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha.', emailEnabled: mailer.enabled });
}));

r.post('/reset', authLimiter, ah(async (req, res) => {
  const token = str(req.body.token, { name: 'Token', min: 10, max: 200 });
  const password = validPassword(req.body.password);
  const row = await db.one(`SELECT * FROM email_tokens WHERE token_hash=$1 AND type='reset' AND used_at IS NULL AND expires_at > now()`, [tokenHash(token)]);
  if (!row) throw err(400, 'Link inválido ou expirado. Solicite outro.');
  const hash = await bcrypt.hash(password, 12);
  await db.tx(async t => {
    await t.query(`UPDATE email_tokens SET used_at=now() WHERE id=$1`, [row.id]);
    await t.query(`UPDATE users SET password_hash=$1, email_verified=true WHERE id=$2`, [hash, row.user_id]);
    await t.query(`UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, [row.user_id]);
  });
  hub.disconnectUser(row.user_id);
  await logLogin(row.user_id, null, 'password_reset', true, req);
  res.json({ ok: true, message: 'Senha redefinida! Faça login com a nova senha.' });
}));

r.post('/change-password', requireAuth, ah(async (req, res) => {
  const next = validPassword(req.body.newPassword);
  if (req.user.password_hash) {
    const cur = str(req.body.currentPassword, { name: 'Senha atual', min: 1, max: 128, trim: false });
    if (!await bcrypt.compare(cur, req.user.password_hash)) throw err(400, 'Senha atual incorreta.');
  }
  await db.query(`UPDATE users SET password_hash=$1 WHERE id=$2`, [await bcrypt.hash(next, 12), req.user.id]);
  await db.query(`UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL`, [req.user.id, req.session.id]);
  res.json({ ok: true, message: 'Senha alterada. Outras sessões foram encerradas.' });
}));

r.post('/change-email', requireAuth, ah(async (req, res) => {
  const email = str(req.body.email, { name: 'E-mail', min: 5, max: 254 }).toLowerCase();
  if (!EMAIL_RE.test(email)) throw err(400, 'E-mail inválido.');
  if (req.user.password_hash) {
    const cur = str(req.body.password, { name: 'Senha', min: 1, max: 128, trim: false });
    if (!await bcrypt.compare(cur, req.user.password_hash)) throw err(400, 'Senha incorreta.');
  }
  const taken = await db.one(`SELECT 1 FROM users WHERE lower(email)=$1 AND id<>$2`, [email, req.user.id]);
  if (taken) throw err(409, 'Esse e-mail já está em uso.');
  const u = await db.one(`UPDATE users SET email=$1, email_verified=false WHERE id=$2 RETURNING *`, [email, req.user.id]);
  await sendVerification(u).catch(() => {});
  res.json({ ok: true, message: 'E-mail atualizado. Confirme o novo endereço.' });
}));

// ===== Sessões / dispositivos =====
r.get('/sessions', requireAuth, ah(async (req, res) => {
  const rows = await db.many(`SELECT id, ip, user_agent, created_at, last_seen_at FROM sessions
    WHERE user_id=$1 AND revoked_at IS NULL AND expires_at > now() ORDER BY last_seen_at DESC`, [req.user.id]);
  res.json(rows.map(s => ({ id: s.id, ip: s.ip, userAgent: s.user_agent, createdAt: s.created_at, lastSeenAt: s.last_seen_at, current: s.id === req.session.id })));
}));
r.delete('/sessions/:id', requireAuth, ah(async (req, res) => {
  const sid = Number(req.params.id);
  await db.query(`UPDATE sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2`, [sid, req.user.id]);
  hub.disconnectSession?.(sid);
  res.json({ ok: true });
}));
r.post('/sessions/revoke-others', requireAuth, ah(async (req, res) => {
  const x = await db.query(`UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL RETURNING id`, [req.user.id, req.session.id]);
  for (const row of x.rows) hub.disconnectSession?.(row.id);
  res.json({ ok: true, revoked: x.rowCount });
}));
r.get('/history', requireAuth, ah(async (req, res) => {
  const rows = await db.many(`SELECT method, success, ip, user_agent, created_at FROM login_history WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`, [req.user.id]);
  res.json(rows);
}));

// Reivindicar o papel de dono com OWNER_SETUP_TOKEN (só funciona enquanto não existir dono)
r.post('/claim-owner', requireAuth, authLimiter, ah(async (req, res) => {
  const expected = process.env.OWNER_SETUP_TOKEN;
  if (!expected) throw err(404, 'Recurso indisponível.');
  const t = str(req.body.token, { name: 'Token', min: 1, max: 300 });
  const a = crypto.createHash('sha256').update(t).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  if (!crypto.timingSafeEqual(a, b)) throw err(403, 'Token incorreto.');
  const hasOwner = await db.one(`SELECT 1 FROM users WHERE global_role='owner'`);
  if (hasOwner) throw err(409, 'A plataforma já possui um dono.');
  await db.query(`UPDATE users SET global_role='owner' WHERE id=$1`, [req.user.id]);
  await awardBadge(req.user.id, 'staff');
  await adminLog(req, 'owner_claimed', 'user', req.user.id);
  res.json({ ok: true, message: 'Agora você é o dono da plataforma.' });
}));

// ===== OAuth (Google / Discord) =====
const PROVIDERS = {
  google: {
    cfg: () => config.google,
    authUrl: (cid, redirect, state) => `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
      client_id: cid, redirect_uri: redirect, response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account' })}`,
    tokenUrl: 'https://oauth2.googleapis.com/token',
    profile: async at => {
      const p = await (await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${at}` } })).json();
      return { id: p.sub, email: p.email, emailVerified: !!p.email_verified, name: p.name || p.given_name, username: (p.email || '').split('@')[0] };
    },
    column: 'google_id'
  },
  discord: {
    cfg: () => config.discord,
    authUrl: (cid, redirect, state) => `https://discord.com/oauth2/authorize?${new URLSearchParams({
      client_id: cid, redirect_uri: redirect, response_type: 'code', scope: 'identify email', state, prompt: 'consent' })}`,
    tokenUrl: 'https://discord.com/api/oauth2/token',
    profile: async at => {
      const p = await (await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${at}` } })).json();
      return { id: p.id, email: p.email, emailVerified: !!p.verified, name: p.global_name || p.username, username: p.username };
    },
    column: 'discord_id'
  }
};

const redirectUri = p => `${config.appUrl}/api/auth/oauth/${p}/callback`;

r.get('/oauth/:provider', authLimiter, (req, res, next) => {
  const p = PROVIDERS[req.params.provider];
  if (!p) return next(err(404, 'Provedor desconhecido.'));
  const { clientId, clientSecret } = p.cfg();
  if (!clientId || !clientSecret) return next(err(503, `Login com ${req.params.provider} não está configurado.`));
  const state = randomToken(24);
  const link = req.query.link === '1' && req.user ? '1' : '0';
  res.cookie('ngg_oauth', `${state}.${link}`, { httpOnly: true, secure: config.isProd, sameSite: 'lax', maxAge: 600000, path: '/api/auth/oauth' });
  res.redirect(p.authUrl(clientId, redirectUri(req.params.provider), state));
});

async function uniqueUsername(base) {
  let b = (base || 'user').toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 18);
  if (b.length < 3) b = `user${b}`;
  for (let i = 0; i < 20; i++) {
    const cand = i === 0 ? b : `${b}${Math.floor(Math.random() * 9000 + 1000)}`;
    const ex = await db.one(`SELECT 1 FROM users WHERE lower(username)=lower($1)`, [cand]);
    if (!ex) return cand;
  }
  return `user${Date.now().toString(36)}`;
}

r.get('/oauth/:provider/callback', authLimiter, ah(async (req, res) => {
  const name = req.params.provider;
  const p = PROVIDERS[name];
  if (!p) throw err(404, 'Provedor desconhecido.');
  const [state, link] = String(req.cookies.ngg_oauth || '').split('.');
  res.clearCookie('ngg_oauth', { path: '/api/auth/oauth' });
  const fail = m => res.redirect(`/?authError=${encodeURIComponent(m)}`);
  if (!state || state !== req.query.state || !req.query.code) return fail('Falha na autenticação. Tente novamente.');
  const { clientId, clientSecret } = p.cfg();
  const tokRes = await fetch(p.tokenUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', code: String(req.query.code), redirect_uri: redirectUri(name) })
  });
  const tok = await tokRes.json().catch(() => ({}));
  if (!tok.access_token) return fail('Não foi possível validar o login.');
  const prof = await p.profile(tok.access_token);
  if (!prof.id) return fail('Perfil não encontrado.');

  // vincular a conta logada
  if (link === '1' && req.user) {
    const taken = await db.one(`SELECT id FROM users WHERE ${p.column}=$1`, [prof.id]);
    if (taken && taken.id !== req.user.id) return fail('Essa conta já está vinculada a outro usuário.');
    await db.query(`UPDATE users SET ${p.column}=$1 WHERE id=$2`, [prof.id, req.user.id]);
    return res.redirect('/?linked=' + name);
  }

  let user = await db.one(`SELECT * FROM users WHERE ${p.column}=$1`, [prof.id]);
  if (!user && prof.email && prof.emailVerified) {
    user = await db.one(`SELECT * FROM users WHERE lower(email)=lower($1)`, [prof.email]);
    if (user) user = await db.one(`UPDATE users SET ${p.column}=$1, email_verified=true WHERE id=$2 RETURNING *`, [prof.id, user.id]);
  }
  if (!user) {
    if ((await getSetting('registration_open')) === false) return fail('Novos cadastros estão fechados.');
    const username = await uniqueUsername(prof.username);
    const emailFree = prof.email && !(await db.one(`SELECT 1 FROM users WHERE lower(email)=lower($1)`, [prof.email]));
    user = await db.one(
      `INSERT INTO users (username, email, email_verified, display_name, ${p.column}) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [username, emailFree ? prof.email : null, emailFree && prof.emailVerified, (prof.name || username).slice(0, 40), prof.id]);
    await afterSignup(user);
  }
  try { await assertCanLogin(user); } catch (e) { await logLogin(user.id, user.username, name, false, req); return fail(e.message); }
  await maybeGrantOwner(user);
  await logLogin(user.id, user.username, name, true, req);
  await createSession(res, req, user.id);
  res.redirect('/');
}));

r.post('/oauth/:provider/unlink', requireAuth, ah(async (req, res) => {
  const p = PROVIDERS[req.params.provider];
  if (!p) throw err(404, 'Provedor desconhecido.');
  const u = req.user;
  const remaining = [u.password_hash, u.google_id && p.column !== 'google_id', u.discord_id && p.column !== 'discord_id'].filter(Boolean).length;
  if (!remaining) throw err(400, 'Defina uma senha antes de desvincular seu único método de login.');
  await db.query(`UPDATE users SET ${p.column}=NULL WHERE id=$1`, [u.id]);
  res.json({ ok: true });
}));

module.exports = { router: r, selfPayload };
