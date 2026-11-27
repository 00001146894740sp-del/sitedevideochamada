const express = require('express');
const db = require('../db');
const hub = require('../hub');
const { upload, storeFile } = require('../files');
const { rank } = require('../security');
const { notify } = require('../notify');
const { ah, err, str, int, oneOf, fileUrl, publicUser } = require('../util');

const r = express.Router();
const CATEGORIES = ['conta', 'login', 'mensagens', 'chamadas', 'grupos', 'comunidades', 'denuncia', 'pagamento', 'bug', 'sugestao', 'outro'];
const isStaff = u => rank(u) >= 1;

async function loadTicket(req) {
  const t = await db.one('SELECT * FROM tickets WHERE id=$1', [int(req.params.id, { min: 1 })]);
  if (!t || (t.user_id !== req.user.id && !isStaff(req.user))) throw err(404, 'Chamado não encontrado.');
  return t;
}
function ser(t, extra = {}) {
  return { id: t.id, userId: t.user_id, category: t.category, subject: t.subject, status: t.status, assignedTo: t.assigned_to, createdAt: t.created_at, updatedAt: t.updated_at, closedAt: t.closed_at, ...extra };
}
async function staffIds() {
  return (await db.many(`SELECT id FROM users WHERE global_role IN ('owner','admin','moderator','support') AND status='active'`)).map(u => u.id);
}

r.get('/support/categories', (req, res) => res.json(CATEGORIES));

r.post('/support/tickets', upload.array('files', 5), ah(async (req, res) => {
  const category = oneOf(req.body.category, CATEGORIES, 'Categoria');
  const subject = str(req.body.subject, { name: 'Assunto', min: 3, max: 120 });
  const description = str(req.body.description, { name: 'Descrição', min: 10, max: 5000 });
  const open = await db.one(`SELECT count(*)::int AS n FROM tickets WHERE user_id=$1 AND status IN ('open','in_progress')`, [req.user.id]);
  if (open.n >= 5) throw err(400, 'Você já tem 5 chamados abertos. Aguarde o atendimento.');
  const fileIds = [];
  for (const f of req.files || []) fileIds.push((await storeFile(f, req.user.id, 'ticket', { allowKinds: ['image', 'video', 'document'] })).id);
  const t = await db.one('INSERT INTO tickets (user_id, category, subject) VALUES ($1,$2,$3) RETURNING *', [req.user.id, category, subject]);
  await db.query('INSERT INTO ticket_messages (ticket_id, author_id, content, file_ids) VALUES ($1,$2,$3,$4)', [t.id, req.user.id, description, fileIds]);
  hub.toUsers(await staffIds(), 'support:changed', { ticketId: t.id });
  res.status(201).json(ser(t));
}));

r.get('/support/tickets', ah(async (req, res) => {
  const rows = await db.many(`SELECT t.*, (SELECT max(created_at) FROM ticket_messages m WHERE m.ticket_id=t.id) AS last_at FROM tickets t WHERE t.user_id=$1 ORDER BY t.updated_at DESC`, [req.user.id]);
  res.json(rows.map(t => ser(t, { lastAt: t.last_at })));
}));

r.get('/support/admin/tickets', ah(async (req, res) => {
  if (!isStaff(req.user)) throw err(403, 'Sem permissão.');
  const status = oneOf(req.query.status, ['open', 'in_progress', 'resolved', 'closed', 'all', 'active'], 'Status', 'active');
  const rows = await db.many(`SELECT t.*, u.username, u.display_name, u.avatar_file_id, u.profile_color, u.global_role, a.display_name AS assignee
    FROM tickets t JOIN users u ON u.id=t.user_id LEFT JOIN users a ON a.id=t.assigned_to
    WHERE ($1='all' OR ($1='active' AND t.status IN ('open','in_progress')) OR t.status=$1) ORDER BY t.updated_at DESC LIMIT 200`, [status]);
  res.json(rows.map(t => ser(t, { user: publicUser({ ...t, id: t.user_id }), assignee: t.assignee })));
}));

r.get('/support/tickets/:id', ah(async (req, res) => {
  const t = await loadTicket(req);
  const msgs = await db.many(`SELECT m.*, u.username, u.display_name, u.avatar_file_id, u.profile_color, u.global_role FROM ticket_messages m LEFT JOIN users u ON u.id=m.author_id WHERE m.ticket_id=$1 ORDER BY m.id`, [t.id]);
  const files = await db.many('SELECT id, filename, mime, kind, size FROM files WHERE id = ANY($1)', [msgs.flatMap(m => m.file_ids)]);
  res.json(ser(t, {
    messages: msgs.map(m => ({
      id: m.id, isStaff: m.is_staff, content: m.content, createdAt: m.created_at,
      author: m.author_id ? publicUser({ ...m, id: m.author_id }) : null,
      files: m.file_ids.map(id => files.find(f => f.id === id)).filter(Boolean).map(f => ({ id: f.id, url: fileUrl(f.id), name: f.filename, mime: f.mime, kind: f.kind, size: f.size }))
    }))
  }));
}));

r.post('/support/tickets/:id/messages', upload.array('files', 5), ah(async (req, res) => {
  const t = await loadTicket(req);
  if (t.status === 'closed') throw err(400, 'Este chamado está encerrado. Abra um novo chamado.');
  const content = str(req.body.content, { name: 'Mensagem', min: 1, max: 5000 });
  const fileIds = [];
  for (const f of req.files || []) fileIds.push((await storeFile(f, req.user.id, 'ticket', { allowKinds: ['image', 'video', 'document'] })).id);
  const staff = t.user_id !== req.user.id && isStaff(req.user);
  await db.query('INSERT INTO ticket_messages (ticket_id, author_id, is_staff, content, file_ids) VALUES ($1,$2,$3,$4,$5)', [t.id, req.user.id, staff, content, fileIds]);
  const newStatus = staff ? (t.status === 'open' ? 'in_progress' : t.status) : (t.status === 'resolved' ? 'open' : t.status);
  await db.query('UPDATE tickets SET updated_at=now(), status=$2, assigned_to=coalesce(assigned_to, $3) WHERE id=$1', [t.id, newStatus, staff ? req.user.id : null]);
  if (staff) await notify(t.user_id, 'ticket', req.user.id, { ticketId: t.id, text: `Nova resposta no chamado: ${t.subject}` });
  hub.toUsers([t.user_id, ...(await staffIds())], 'support:changed', { ticketId: t.id });
  res.status(201).json({ ok: true });
}));

r.patch('/support/tickets/:id', ah(async (req, res) => {
  const t = await loadTicket(req);
  if (!isStaff(req.user)) throw err(403, 'Sem permissão.');
  const status = req.body.status !== undefined ? oneOf(req.body.status, ['open', 'in_progress', 'resolved', 'closed'], 'Status') : t.status;
  const assigned = req.body.assignToMe ? req.user.id : t.assigned_to;
  await db.query(`UPDATE tickets SET status=$1, assigned_to=$2, updated_at=now(), closed_at=CASE WHEN $1 IN ('resolved','closed') THEN now() ELSE NULL END WHERE id=$3`, [status, assigned, t.id]);
  if (status !== t.status) await notify(t.user_id, 'ticket', req.user.id, { ticketId: t.id, text: `Seu chamado "${t.subject}" agora está: ${{ open: 'aberto', in_progress: 'em andamento', resolved: 'resolvido', closed: 'encerrado' }[status]}` });
  hub.toUsers([t.user_id, ...(await staffIds())], 'support:changed', { ticketId: t.id });
  res.json({ ok: true });
}));

r.post('/support/tickets/:id/close', ah(async (req, res) => {
  const t = await loadTicket(req);
  await db.query(`UPDATE tickets SET status='closed', closed_at=now(), updated_at=now() WHERE id=$1`, [t.id]);
  hub.toUsers([t.user_id, ...(await staffIds())], 'support:changed', { ticketId: t.id });
  res.json({ ok: true });
}));

module.exports = { router: r };
