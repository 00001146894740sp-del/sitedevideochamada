require('dotenv').config();

const env = process.env;
const isProd = env.NODE_ENV === 'production';

function required(name, fallbackDev) {
  const v = env[name];
  if (v) return v;
  if (!isProd && fallbackDev !== undefined) return fallbackDev;
  throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
}

const config = {
  isProd,
  port: Number(env.PORT || 3000),
  // no Render, RENDER_EXTERNAL_URL é preenchida automaticamente
  appUrl: (env.APP_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  databaseUrl: required('DATABASE_URL', 'postgres://postgres@localhost:5432/newgg'),
  databaseSsl: env.DATABASE_SSL ? env.DATABASE_SSL === 'true' : /\.render\.com|sslmode=require/.test(env.DATABASE_URL || ''),
  sessionSecret: required('SESSION_SECRET', 'dev-only-secret-change-me'),
  sessionDays: Number(env.SESSION_DAYS || 30),
  ownerEmail: (env.OWNER_EMAIL || '').toLowerCase().trim(),
  requireEmailVerification: env.REQUIRE_EMAIL_VERIFICATION === 'true',
  smtp: {
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT || 2525),
    secure: env.SMTP_SECURE === 'true',
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.MAIL_FROM || 'NEW GG <no-reply@newgg.app>'
  },
  google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
  discord: { clientId: env.DISCORD_CLIENT_ID, clientSecret: env.DISCORD_CLIENT_SECRET },
  // teto rígido de upload (o administrador ajusta o limite efetivo no painel, até este valor)
  maxUploadMb: Math.min(Number(env.MAX_UPLOAD_MB || 50), 100),
  turn: {
    urls: env.TURN_URLS ? env.TURN_URLS.split(',').map(s => s.trim()).filter(Boolean) : [],
    username: env.TURN_USERNAME,
    credential: env.TURN_CREDENTIAL
  },
  stunUrls: (env.STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302').split(',').map(s => s.trim()).filter(Boolean),
  giphyApiKey: env.GIPHY_API_KEY,
  redisUrl: env.REDIS_URL,
  trustProxy: env.TRUST_PROXY ? Number(env.TRUST_PROXY) : (isProd ? 1 : 0),
  loginMaxAttempts: Number(env.LOGIN_MAX_ATTEMPTS || 5),
  loginLockMinutes: Number(env.LOGIN_LOCK_MINUTES || 15)
};

if (isProd && config.sessionSecret.length < 32) {
  throw new Error('SESSION_SECRET precisa ter pelo menos 32 caracteres em produção.');
}

module.exports = config;
