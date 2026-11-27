const path = require('path');
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const db = require('./db');
const { migrate } = require('./migrate');
const { authMiddleware, requireAuth, csrfProtect, originCheck } = require('./security');
const { HttpError } = require('./util');

const app = express();
app.set('trust proxy', config.trustProxy);
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'", 'https://fonts.googleapis.com', "'unsafe-inline'"],
      'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
      'img-src': ["'self'", 'data:', 'blob:', 'https:'],
      'media-src': ["'self'", 'blob:', 'https://media.tenor.com'],
      'connect-src': ["'self'", config.isProd ? `wss://${new URL(config.appUrl).host}` : 'ws:'],
      'frame-ancestors': ["'none'"],
      'object-src': ["'none'"],
      'upgrade-insecure-requests': config.isProd ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'same-origin' }
}));
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: false, limit: '200kb' }));

app.get('/healthz', async (req, res) => {
  try { await db.query('SELECT 1'); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); }
});

// ===== API =====
const api = express.Router();
api.use(rateLimit({ windowMs: 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false, message: { error: 'Muitas requisições. Aguarde um instante.' } }));
api.use(authMiddleware);
api.use(originCheck);
api.use(csrfProtect);
api.use('/auth', require('./routes/auth').router);

// arquivos públicos (avatares, logos) podem ser lidos sem login; o resto exige sessão
api.use((req, res, next) => {
  if (req.method === 'GET' && /^\/files\/[0-9a-f-]{36}$/i.test(req.path)) return next();
  requireAuth(req, res, next);
});
api.use(require('./routes/users').router);
api.use(require('./routes/conversations').router);
api.use(require('./routes/communities').router);
api.use(require('./routes/stories').router);
api.use(require('./routes/misc').router);
api.use(require('./routes/support').router);
api.use('/admin', require('./routes/admin').router);
api.get('/announcements/active', async (req, res, next) => {
  try { res.json(await db.many(`SELECT id, title, content, created_at FROM announcements WHERE active ORDER BY id DESC LIMIT 5`)); } catch (e) { next(e); }
});
api.use((req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
app.use('/api', api);

// ===== Front-end =====
const pub = path.join(__dirname, '..', 'public');
app.use(express.static(pub, { index: false, maxAge: config.isProd ? '1h' : 0 }));
app.get(['/', '/app', '/app/*', '/invite/*', '/g/*'], (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(pub, 'index.html'));
});

// ===== Erros =====
// eslint-disable-next-line no-unused-vars
app.use((e, req, res, next) => {
  if (e instanceof HttpError) return res.status(e.status).json({ error: e.message, code: e.code });
  if (e.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Arquivo muito grande.' });
  if (e.code === 'LIMIT_UNEXPECTED_FILE' || e.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: 'Arquivos demais ou campo inválido.' });
  if (e.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido.' });
  if (e.type === 'entity.too.large') return res.status(413).json({ error: 'Requisição muito grande.' });
  if (e.code === '22P02') return res.status(400).json({ error: 'Parâmetro inválido.' });
  if (e.code === '23505') return res.status(409).json({ error: 'Registro duplicado.' });
  console.error(`[erro] ${req.method} ${req.originalUrl}`, e);
  res.status(500).json({ error: 'Erro interno. Tente novamente.' });
});

// ===== Tarefas de manutenção =====
async function maintenance() {
  try {
    await db.query(`DELETE FROM sessions WHERE expires_at < now() - interval '7 days' OR revoked_at < now() - interval '30 days'`);
    await db.query(`DELETE FROM email_tokens WHERE expires_at < now() - interval '1 day'`);
    await db.query(`DELETE FROM link_previews WHERE fetched_at < now() - interval '7 days'`);
    await db.query(`DELETE FROM notifications WHERE created_at < now() - interval '90 days' AND read_at IS NOT NULL`);
    await db.query(`UPDATE users SET status='active', suspended_until=NULL WHERE status='suspended' AND suspended_until < now()`);
    // arquivos sem uso (upload abandonado há mais de 1 dia)
    await db.query(`UPDATE files SET deleted_at=now() WHERE deleted_at IS NULL AND scope='message' AND created_at < now() - interval '1 day'
      AND NOT EXISTS (SELECT 1 FROM message_attachments a WHERE a.file_id=files.id)`);
    // libera espaço de arquivos apagados há mais de 7 dias
    await db.query(`UPDATE files SET data='\\x'::bytea WHERE deleted_at < now() - interval '7 days' AND octet_length(data) > 0`);
    // contas com exclusão solicitada há 7 dias: anonimiza
    const due = await db.many(`SELECT id FROM users WHERE deletion_requested_at < now() - interval '7 days' AND status <> 'deleted'`);
    for (const u of due) {
      await db.tx(async t => {
        await t.query(`UPDATE users SET status='deleted', username='excluido_'||id, email=NULL, password_hash=NULL, display_name='Conta excluída',
          bio='', custom_status='', avatar_file_id=NULL, banner_file_id=NULL, links='[]', google_id=NULL, discord_id=NULL WHERE id=$1`, [u.id]);
        await t.query(`UPDATE sessions SET revoked_at=now() WHERE user_id=$1`, [u.id]);
        await t.query(`DELETE FROM friends WHERE user_id=$1 OR friend_id=$1`, [u.id]);
        await t.query(`UPDATE stories SET deleted_at=now() WHERE user_id=$1`, [u.id]);
        await t.query(`UPDATE files SET deleted_at=now() WHERE owner_id=$1`, [u.id]);
        await t.query(`DELETE FROM community_members WHERE user_id=$1`, [u.id]);
        await t.query(`UPDATE conversation_members SET status='left' WHERE user_id=$1`, [u.id]);
      });
      console.log(`[manutenção] conta ${u.id} excluída/anonimizada`);
    }
  } catch (e) { console.error('[manutenção]', e.message); }
}

async function start() {
  await migrate();
  const server = http.createServer(app);
  await require('./realtime').setup(server);
  server.listen(config.port, () => console.log(`NEW GG rodando em ${config.appUrl} (porta ${config.port})`));
  setTimeout(maintenance, 10000);
  setInterval(maintenance, 60 * 60 * 1000).unref();
  const shutdown = () => { server.close(() => db.pool.end().then(() => process.exit(0))); setTimeout(() => process.exit(0), 8000).unref(); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (require.main === module) {
  start().catch(e => { console.error('Falha ao iniciar:', e); process.exit(1); });
}

module.exports = { app, start };
