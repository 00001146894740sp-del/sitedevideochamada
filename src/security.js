const crypto = require('crypto');
const cookie = require('cookie');
const db = require('./db');
const config = require('./config');
const { err, randomToken, sha256, ROLE_RANK, clientIp } = require('./util');

const COOKIE = 'ngg_sid';

function cookieOpts(maxAgeMs) {
  return {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeMs
  };
}

// o hash do token usa o segredo da aplicação (HMAC) — um vazamento do banco não revela tokens válidos
const tokenHash = t => crypto.createHmac('sha256', config.sessionSecret).update(t).digest('hex');

async function createSession(res, req, userId) {
  const token = randomToken(32);
  const csrf = randomToken(24);
  const expires = new Date(Date.now() + config.sessionDays * 86400000);
  await db.query(
    `INSERT INTO sessions (token_hash, user_id, csrf_token, ip, user_agent, expires_at) VALUES ($1,$2,$3,$4,$5,$6)`,
    [tokenHash(token), userId, csrf, clientIp(req), (req.headers['user-agent'] || '').slice(0, 300), expires]
  );
  res.cookie(COOKIE, token, cookieOpts(config.sessionDays * 86400000));
  return { csrf };
}

async function destroySession(req, res) {
  if (req.session) await db.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [req.session.id]);
  res.clearCookie(COOKIE, { path: '/' });
}

async function loadSessionByToken(token) {
  if (!token) return null;
  const row = await db.one(
    `SELECT s.id AS sid, s.csrf_token, s.last_seen_at AS s_last_seen, u.*
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [tokenHash(token)]
  );
  if (!row) return null;
  // suspensão expirada -> reativa automaticamente
  if (row.status === 'suspended' && row.suspended_until && new Date(row.suspended_until) < new Date()) {
    await db.query(`UPDATE users SET status='active', suspended_until=NULL, status_reason=NULL WHERE id=$1`, [row.id]);
    await db.query(`UPDATE bans SET lifted_at=now() WHERE user_id=$1 AND type='suspend' AND lifted_at IS NULL`, [row.id]);
    row.status = 'active';
  }
  if (row.status !== 'active') return { blocked: row };
  // atualiza last_seen no máximo a cada 5 min
  if (Date.now() - new Date(row.s_last_seen).getTime() > 300000) {
    db.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [row.sid]).catch(() => {});
  }
  const session = { id: row.sid, csrf: row.csrf_token };
  delete row.sid; delete row.csrf_token; delete row.s_last_seen;
  return { user: row, session };
}

async function authMiddleware(req, res, next) {
  try {
    const token = req.cookies?.[COOKIE];
    const r = await loadSessionByToken(token);
    if (r?.user) { req.user = r.user; req.session = r.session; }
    else if (r?.blocked) {
      req.blockedUser = r.blocked;
    }
    next();
  } catch (e) { next(e); }
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  if (req.blockedUser) {
    const u = req.blockedUser;
    const msg = u.status === 'banned' ? 'Sua conta foi banida.' :
      u.status === 'suspended' ? `Sua conta está suspensa${u.suspended_until ? ' até ' + new Date(u.suspended_until).toLocaleString('pt-BR') : ''}.` :
        'Conta indisponível.';
    return next(err(403, msg + (u.status_reason ? ` Motivo: ${u.status_reason}` : ''), 'account_blocked'));
  }
  next(err(401, 'Faça login para continuar.', 'unauthenticated'));
}

// Proteção CSRF: token vinculado à sessão, enviado no header X-CSRF-Token em todo método que altera estado
function csrfProtect(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!req.session) return next(); // rotas públicas (login/cadastro) não têm sessão; são protegidas por SameSite + Origin
  const h = req.get('x-csrf-token');
  if (!h || h.length !== req.session.csrf.length ||
      !crypto.timingSafeEqual(Buffer.from(h), Buffer.from(req.session.csrf))) {
    return next(err(403, 'Token CSRF inválido. Recarregue a página.', 'csrf'));
  }
  next();
}

// Checagem de origem para requisições que alteram estado (defesa extra contra CSRF)
function originCheck(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next();
  const allowed = new URL(config.appUrl).origin;
  const host = `${req.protocol}://${req.get('host')}`;
  if (origin === allowed || origin === host) return next();
  next(err(403, 'Origem não permitida.', 'origin'));
}

const rank = u => ROLE_RANK[u?.global_role] ?? 0;
const requireRole = min => (req, res, next) => {
  if (!req.user) return next(err(401, 'Faça login.'));
  if (rank(req.user) < ROLE_RANK[min]) return next(err(403, 'Sem permissão.'));
  next();
};

async function adminLog(req, action, targetType, targetId, data = {}) {
  await db.query(
    `INSERT INTO admin_logs (actor_id, action, target_type, target_id, data, ip) VALUES ($1,$2,$3,$4,$5,$6)`,
    [req.user?.id || null, action, targetType, targetId == null ? null : String(targetId), data, clientIp(req)]
  );
}

function parseCookieHeader(h) {
  return cookie.parse(h || '');
}

module.exports = {
  COOKIE, createSession, destroySession, authMiddleware, requireAuth, csrfProtect, originCheck,
  requireRole, rank, adminLog, loadSessionByToken, parseCookieHeader, tokenHash, sha256
};
