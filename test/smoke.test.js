// Teste de ponta a ponta contra um servidor em execução.
// Uso: BASE_URL=http://localhost:3000 npm test
const { io } = require('socket.io-client');
const assert = require('assert');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const uniq = Date.now().toString(36).slice(-5);
let passed = 0;

class Client {
  constructor(name) { this.name = name; this.cookie = ''; this.csrf = ''; }
  async req(method, path, body, { form, expect } = {}) {
    const headers = { Cookie: this.cookie };
    if (this.csrf) headers['X-CSRF-Token'] = this.csrf;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(BASE + path, { method, headers, body: payload, redirect: 'manual' });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.arrayBuffer();
    if (expect !== undefined) {
      assert.strictEqual(res.status, expect, `${this.name} ${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
    } else if (res.status >= 400) {
      throw new Error(`${this.name} ${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
    }
    if (data && data.csrfToken) this.csrf = data.csrfToken;
    return { status: res.status, data, headers: res.headers };
  }
  get(p, o) { return this.req('GET', p, undefined, o); }
  post(p, b, o) { return this.req('POST', p, b ?? {}, o); }
  patch(p, b, o) { return this.req('PATCH', p, b, o); }
  put(p, b, o) { return this.req('PUT', p, b, o); }
  del(p, b, o) { return this.req('DELETE', p, b, o); }
  socket() {
    return new Promise((resolve, reject) => {
      const s = io(BASE, { extraHeaders: { Cookie: this.cookie }, transports: ['websocket'] });
      s.on('ready', () => resolve(s));
      s.on('connect_error', reject);
    });
  }
}
const ok = (label) => { passed++; console.log(`  ✔ ${label}`); };
const waitFor = (s, ev, pred = () => true, ms = 5000) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error(`timeout esperando ${ev}`)), ms);
  const h = d => { if (pred(d)) { clearTimeout(t); s.off(ev, h); res(d); } };
  s.on(ev, h);
});
// PNG 1x1 válido
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

(async () => {
  console.log(`Testando ${BASE}`);
  const A = new Client('ana'), B = new Client('bruno'), C = new Client('carla');

  // ---------- cadastro / login ----------
  await A.post('/api/auth/register', { username: `ana_${uniq}`, email: `ana_${uniq}@teste.com`, password: 'senha123', displayName: 'Ana' }, { expect: 201 });
  await B.post('/api/auth/register', { username: `bruno_${uniq}`, email: `bruno_${uniq}@teste.com`, password: 'senha123', displayName: 'Bruno' }, { expect: 201 });
  await C.post('/api/auth/register', { username: `carla_${uniq}`, email: `carla_${uniq}@teste.com`, password: 'senha123', displayName: 'Carla' }, { expect: 201 });
  ok('cadastro de 3 usuários');
  await new Client('dup').post('/api/auth/register', { username: `ana_${uniq}`, email: `x${uniq}@t.com`, password: 'senha123' }, { expect: 409 });
  ok('nome de usuário duplicado recusado');
  await new Client('fraca').post('/api/auth/register', { username: `fr_${uniq}`, email: `fr${uniq}@t.com`, password: '123' }, { expect: 400 });
  ok('senha fraca recusada');
  await A.post('/api/auth/logout');
  A.csrf = '';
  await A.post('/api/auth/login', { identifier: `ana_${uniq}`, password: 'errada1' }, { expect: 401 });
  await A.post('/api/auth/login', { identifier: `ana_${uniq}@teste.com`, password: 'senha123' }, { expect: 200 });
  const me = (await A.get('/api/auth/me')).data;
  assert.strictEqual(me.user.username, `ana_${uniq}`);
  ok('logout, login errado, login por e-mail e sessão persistente (/me)');
  const noCsrf = A.csrf; A.csrf = 'invalido';
  await A.patch('/api/users/me', { bio: 'x' }, { expect: 403 });
  A.csrf = noCsrf;
  ok('proteção CSRF bloqueia requisição sem token válido');
  const sessions = (await A.get('/api/auth/sessions')).data;
  assert(sessions.some(s => s.current));
  ok('lista de dispositivos conectados');

  const aId = me.user.id;
  const bId = (await B.get('/api/auth/me')).data.user.id;
  const cId = (await C.get('/api/auth/me')).data.user.id;

  // dono
  await A.post('/api/auth/claim-owner', { token: process.env.OWNER_SETUP_TOKEN || 'teste-dono-123' }).catch(() => {});

  // ---------- perfil ----------
  await A.patch('/api/users/me', { bio: 'Olá <script>alert(1)</script>', customStatus: 'Codando', links: [{ label: 'site', url: 'https://example.com' }] });
  const fd = new FormData(); fd.append('file', new Blob([PNG], { type: 'image/png' }), 'a.png');
  const av = (await A.post('/api/users/me/avatar', undefined, { form: fd })).data;
  const avRes = await fetch(BASE + av.url);
  assert.strictEqual(avRes.headers.get('content-type'), 'image/png');
  ok('edição de perfil e upload de avatar');
  const bad = new FormData(); bad.append('file', new Blob(['<svg onload=alert(1)>'], { type: 'image/svg+xml' }), 'x.svg');
  await A.post('/api/users/me/avatar', undefined, { form: bad, expect: 415 });
  ok('upload malicioso (SVG/HTML) recusado');

  // ---------- amizades ----------
  const fr = (await A.post('/api/friends/requests', { username: `bruno_${uniq}` })).data;
  const reqs = (await B.get('/api/friends/requests')).data;
  assert.strictEqual(reqs.incoming[0].requestId, fr.requestId);
  await B.post(`/api/friends/requests/${fr.requestId}/accept`);
  const fl = (await A.get('/api/friends')).data;
  assert(fl.some(f => f.id === bId));
  ok('solicitação de amizade enviada e aceita');

  // ---------- tempo real ----------
  const sA = await A.socket(), sB = await B.socket();
  ok('conexão WebSocket autenticada');
  const dm = (await A.post('/api/conversations/dm', { userId: bId })).data;
  await new Promise(r => setTimeout(r, 200));
  const gotMsg = waitFor(sB, 'message:new', m => m.conversationId === dm.id);
  const typing = waitFor(sB, 'typing', t => t.conversationId === dm.id);
  sA.emit('typing', { conversationId: dm.id, typing: true });
  await typing;
  ok('indicador "digitando" em tempo real');
  const sent = (await A.post(`/api/conversations/${dm.id}/messages`, { content: 'Oi Bruno! https://example.com' }, { expect: 201 })).data;
  const recv = await gotMsg;
  assert.strictEqual(recv.content, 'Oi Bruno! https://example.com');
  ok('mensagem privada entregue em tempo real');
  const receipt = waitFor(sA, 'receipt', r => r.userId === bId && r.lastReadId >= sent.id);
  sB.emit('delivered', { conversationId: dm.id, messageId: sent.id });
  await B.post(`/api/conversations/${dm.id}/read`, { messageId: sent.id });
  await receipt;
  ok('confirmação de entrega e leitura');
  const reply = (await B.post(`/api/conversations/${dm.id}/messages`, { content: 'Fala @ana_' + uniq, replyToId: sent.id }, { expect: 201 })).data;
  assert.strictEqual(reply.replyTo.id, sent.id);
  ok('resposta com citação');
  await A.patch(`/api/messages/${sent.id}`, { content: 'Oi Bruno (editado)' });
  await B.patch(`/api/messages/${sent.id}`, { content: 'hack' }, { expect: 403 });
  ok('edição (apenas pelo autor)');
  await B.post(`/api/messages/${sent.id}/reactions`, { emoji: '🔥' });
  await A.post(`/api/messages/${sent.id}/pin`);
  await A.post(`/api/messages/${sent.id}/favorite`);
  const hist = (await A.get(`/api/conversations/${dm.id}/messages`)).data.messages;
  const m1 = hist.find(m => m.id === sent.id);
  assert(m1.reactions[0].emoji === '🔥' && m1.pinned && m1.favorite && m1.editedAt);
  ok('reações, fixar, favoritar e histórico');
  const search = (await A.get(`/api/conversations/${dm.id}/search?q=editado`)).data;
  assert.strictEqual(search.length, 1);
  ok('pesquisa dentro da conversa');

  // arquivos
  const up = new FormData();
  up.append('files', new Blob([PNG], { type: 'image/png' }), 'foto.png');
  up.append('files', new Blob(['%PDF-1.4\n%fake'], { type: 'application/pdf' }), 'doc.pdf');
  const files = (await A.post('/api/uploads', undefined, { form: up })).data;
  assert.strictEqual(files.length, 2);
  const fm = (await A.post(`/api/conversations/${dm.id}/messages`, { content: '', fileIds: files.map(f => f.id) }, { expect: 201 })).data;
  assert.strictEqual(fm.attachments.length, 2);
  const fileRes = await fetch(BASE + files[0].url, { headers: { Cookie: B.cookie } });
  assert.strictEqual(fileRes.status, 200);
  const denied = await fetch(BASE + files[0].url, { headers: { Cookie: C.cookie } });
  assert.strictEqual(denied.status, 403);
  ok('envio de imagem + documento, acesso restrito aos participantes');
  const media = (await B.get(`/api/conversations/${dm.id}/media`)).data;
  assert(media.length >= 2);
  ok('aba de arquivos compartilhados');

  await A.del(`/api/messages/${fm.id}?forAll=1`);
  const gone = await fetch(BASE + files[0].url, { headers: { Cookie: B.cookie } });
  assert.strictEqual(gone.status, 404);
  ok('exclusão para todos (remove anexos)');

  // privacidade: C não pode ler a DM
  await C.get(`/api/conversations/${dm.id}/messages`, { expect: 403 });
  ok('terceiros não acessam conversas privadas');

  // ---------- grupos ----------
  const g = (await A.post('/api/conversations/group', { name: 'Grupo Teste', memberIds: [bId] }, { expect: 201 })).data;
  const gd = (await A.get(`/api/conversations/${g.id}`)).data;
  await C.post(`/api/invites/group/${gd.inviteCode}/join`);
  await A.patch(`/api/conversations/${g.id}/members/${bId}`, { role: 'admin' });
  await B.patch(`/api/conversations/${g.id}/members/${aId}`, { role: 'member' }, { expect: 403 });
  ok('grupo criado, convite por link, promoção e hierarquia');
  await A.patch(`/api/conversations/${g.id}/members/${cId}`, { silenceMinutes: 10 });
  await C.post(`/api/conversations/${g.id}/messages`, { content: 'oi' }, { expect: 403 });
  ok('silenciamento de membro');
  await A.patch(`/api/conversations/${g.id}`, { joinApproval: true, notice: 'Regras: respeito!' });
  await A.del(`/api/conversations/${g.id}/members/${cId}`);
  await C.get(`/api/conversations/${g.id}/messages`, { expect: 403 });
  ok('aviso do grupo, aprovação ativada e remoção de participante');
  const ghist = (await A.get(`/api/conversations/${g.id}/history`)).data;
  assert(ghist.length >= 3);
  ok('histórico de participantes');

  // ---------- comunidades ----------
  const com = (await A.post('/api/communities', { name: 'Comunidade GG', description: 'Teste', isPublic: true }, { expect: 201 })).data;
  await B.post(`/api/communities/${com.id}/join`);
  let cd = (await B.get(`/api/communities/${com.id}`)).data;
  const ann = cd.channels.find(c => c.category === 'anuncios');
  const chat = cd.channels.find(c => c.category === 'conversas');
  await B.post(`/api/conversations/${ann.id}/messages`, { content: 'spam' }, { expect: 403 });
  await B.post(`/api/conversations/${chat.id}/messages`, { content: 'olá comunidade' }, { expect: 201 });
  ok('comunidade, canais padrão e permissão de canal de avisos');
  const ad = (await A.get(`/api/communities/${com.id}`)).data;
  const priv = (await A.post(`/api/communities/${com.id}/channels`, { name: 'staff', category: 'privado', roleIds: [ad.roles.find(r => r.name === 'Moderação').id] }, { expect: 201 })).data;
  await B.get(`/api/conversations/${priv.id}/messages`, { expect: 403 });
  await A.put(`/api/communities/${com.id}/members/${bId}/roles`, { roleIds: [ad.roles.find(r => r.name === 'Moderação').id] });
  await B.get(`/api/conversations/${priv.id}/messages`, { expect: 200 });
  ok('canal privado e cargos personalizados com permissões');
  const inv = (await A.post(`/api/communities/${com.id}/invites`, { maxUses: 5 })).data;
  await C.post(`/api/invites/community/${inv.code}/join`);
  await B.del(`/api/communities/${com.id}/members/${aId}`, undefined, { expect: 403 });
  ok('convite de comunidade e proteção do proprietário');
  const msgC = (await C.post(`/api/conversations/${chat.id}/messages`, { content: 'conteúdo ruim' }, { expect: 201 })).data;
  await B.post('/api/reports', { targetType: 'message', targetId: msgC.id, reason: 'spam' }, { expect: 201 });
  const creps = (await B.get(`/api/communities/${com.id}/reports`)).data;
  assert(creps.length === 1);
  await B.del(`/api/messages/${msgC.id}?forAll=1`);
  const audit = (await A.get(`/api/communities/${com.id}/audit`)).data;
  assert(audit.some(a => a.action === 'message_deleted'));
  ok('denúncia, moderação e registro de atividades da comunidade');

  // ---------- stories ----------
  const sf = new FormData(); sf.append('type', 'text'); sf.append('text', 'Meu primeiro story'); sf.append('privacy', 'friends');
  const st = (await A.post('/api/stories', undefined, { form: sf, expect: 201 })).data;
  const feedB = (await B.get('/api/stories/feed')).data;
  assert(feedB.some(g => g.user.id === aId));
  const feedC = (await C.get('/api/stories/feed')).data;
  assert(!feedC.some(g => g.user.id === aId));
  await B.post(`/api/stories/${st.id}/view`);
  await B.post(`/api/stories/${st.id}/react`, { emoji: '😍' });
  await B.post(`/api/stories/${st.id}/reply`, { text: 'Top!' }, { expect: 201 });
  const viewers = (await A.get(`/api/stories/${st.id}/viewers`)).data;
  assert(viewers[0].reaction === '😍');
  ok('stories: publicação, privacidade, visualizações, reações e resposta privada');

  // ---------- chamadas (sinalização) ----------
  const incoming = waitFor(sB, 'call:incoming');
  const started = await new Promise(r => sA.emit('call:start', { conversationId: dm.id, media: 'audio' }, r));
  assert(started.ok, JSON.stringify(started));
  const inc = await incoming;
  const joined = waitFor(sA, 'call:participant-joined');
  const acc = await new Promise(r => sB.emit('call:accept', { callId: inc.callId }, r));
  assert(acc.ok);
  await joined;
  const sig = waitFor(sA, 'call:signal');
  sB.emit('call:signal', { callId: inc.callId, to: aId, data: { sdp: { type: 'offer', sdp: 'v=0' } } });
  await sig;
  const ended = waitFor(sB, 'call:ended');
  sA.emit('call:leave', { callId: inc.callId });
  await ended;
  await new Promise(r => setTimeout(r, 300));
  const calls = (await A.get('/api/calls')).data;
  assert(calls[0].status === 'ended');
  ok('chamada: tocar, atender, sinalização WebRTC, encerrar e histórico');

  // ---------- notificações / busca ----------
  const notifs = (await A.get('/api/notifications')).data;
  assert(notifs.items.some(n => n.type === 'reply' || n.type === 'mention') && notifs.items.some(n => n.type === 'reaction'));
  ok('notificações de resposta/menção e reação');
  const gs = (await A.get(`/api/search?q=bruno_${uniq}`)).data;
  assert(gs.users.length >= 1);
  ok('pesquisa global');

  // ---------- bloqueio ----------
  await B.post(`/api/blocks/${aId}`);
  await A.post(`/api/conversations/${dm.id}/messages`, { content: 'ainda aí?' }, { expect: 403 });
  await B.del(`/api/blocks/${aId}`);
  ok('bloqueio impede mensagens');

  // ---------- suporte ----------
  const tf = new FormData(); tf.append('category', 'bug'); tf.append('subject', 'Erro no app'); tf.append('description', 'Descrição detalhada do problema.');
  tf.append('files', new Blob([PNG], { type: 'image/png' }), 'print.png');
  const tk = (await B.post('/api/support/tickets', undefined, { form: tf, expect: 201 })).data;
  // ---------- admin ----------
  const meA = (await A.get('/api/auth/me')).data;
  if (meA.user.role === 'owner') {
    await A.post(`/api/support/tickets/${tk.id}/messages`, { content: 'Estamos verificando.' }, { expect: 201 });
    await A.patch(`/api/support/tickets/${tk.id}`, { status: 'resolved' });
    const t2 = (await B.get(`/api/support/tickets/${tk.id}`)).data;
    assert(t2.status === 'resolved' && t2.messages.length === 2 && t2.messages[0].files.length === 1);
    ok('central de suporte: chamado com imagem, resposta da equipe e status');
    const stats = (await A.get('/api/admin/stats')).data;
    assert(stats.users >= 3);
    await A.patch(`/api/admin/users/${bId}/role`, { role: 'admin' });
    await B.post(`/api/admin/users/${aId}/ban`, { reason: 'tentativa' }, { expect: 403 });
    ok('admin: estatísticas, níveis de acesso e dono protegido');
    await A.post(`/api/admin/users/${cId}/suspend`, { hours: 1, reason: 'teste de suspensão' });
    await C.get('/api/auth/me', { expect: 403 });
    await A.post(`/api/admin/users/${cId}/unban`);
    await C.get('/api/auth/me', { expect: 200 });
    ok('admin: suspender e reativar conta');
    const logs = (await A.get('/api/admin/logs')).data;
    assert(logs.some(l => l.action === 'user_suspended'));
    ok('registros administrativos');
  } else {
    console.log('  (pulando testes de admin: OWNER_SETUP_TOKEN não configurado ou dono já existe)');
  }

  sA.close(); sB.close();
  console.log(`\n✅ ${passed} verificações passaram.`);
  process.exit(0);
})().catch(e => { console.error('\n❌ FALHOU:', e.message); process.exit(1); });
