import {
  state, on, emit, api, GET, POST, h, clear, icon, iconBtn, toast, modal, menu, avatar, roleMark, field, tabs,
  fmtRelative, sound, desktopNotify, applyAppearance, PRESENCE_LABEL, confirmDialog
} from './core.js';
import * as chat from './chat.js';
import * as social from './social.js';
import * as community from './community.js';
import * as calls from './calls.js';
import { openSettings } from './settings.js';
import { openAdmin, openSupport } from './admin.js';
import * as shop from './shop.js';
import * as voice from './voice.js';

const app = document.getElementById('app');
const params = new URLSearchParams(location.search);

// ===================== BOOT =====================
async function boot() {
  state.config = await GET('/auth/config', { silent: true }).catch(() => ({}));
  try {
    const me = await GET('/auth/me', { silent: true });
    setMe(me);
    await start();
  } catch (e) {
    if (e.code === 'account_blocked') renderAuth('login', e.message);
    else renderAuth(params.get('reset') ? 'reset' : 'login');
  }
}
function setMe(me) {
  state.me = me.user; state.settings = me.settings; state.privacy = me.privacy;
  if (me.csrfToken) state.csrf = me.csrfToken;
  applyAppearance();
}

// ===================== AUTENTICAÇÃO =====================
function renderAuth(mode = 'login', notice) {
  applyAppearance();
  const err = h('div'); const okBox = h('div');
  const showErr = m => { clear(err); if (m) err.appendChild(h('div', { class: 'form-error' }, m)); };
  const showOk = m => { clear(okBox); if (m) okBox.appendChild(h('div', { class: 'form-ok' }, m)); };
  const card = h('div', { class: 'auth-card' });

  const hero = h('section', { class: 'auth-hero' },
    h('div', { class: 'orbit' }), h('div', { class: 'orbit o2' }),
    h('div', { class: 'brand' }, h('img', { src: '/img/logo-192.png', alt: '' }), h('span', { class: 'wordmark' }, 'NEW ', h('b', null, 'GG'))),
    h('div', null,
      h('h1', null, 'Seu povo.', h('br'), 'Suas regras.', h('br'), h('em', null, 'Seu universo.')),
      h('p', { class: 'hide-m' }, 'Mensagens em tempo real, grupos, comunidades com cargos e canais, chamadas de voz e vídeo, stories e muito mais — tudo num lugar só.'),
      h('div', { class: 'feature-list hide-m' }, ['💬 Conversas', '👥 Grupos', '🏰 Comunidades', '📞 Chamadas', '✨ Stories', '🛡️ Moderação'].map(t => h('span', { class: 'chip' }, t)))),
    h('small', { class: 'faint hide-m' }, `© ${new Date().getFullYear()} NEW GG`));

  const oauth = () => (state.config.google || state.config.discord) ? [
    h('div', { class: 'oauth' },
      state.config.discord ? h('a', { class: 'btn', href: '/api/auth/oauth/discord' }, '🎮 Discord') : null,
      state.config.google ? h('a', { class: 'btn', href: '/api/auth/oauth/google' }, '🔎 Google') : null),
    h('div', { class: 'or' }, 'ou')
  ] : null;

  async function submit(fn, btn) {
    showErr(''); btn.disabled = true;
    try { await fn(); } catch (e) { showErr(e.message); } finally { btn.disabled = false; }
  }

  function login() {
    const id = h('input', { class: 'input', autocomplete: 'username', placeholder: 'usuario ou email@exemplo.com', required: true });
    const pw = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', placeholder: '••••••••', required: true });
    const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Entrar');
    return h('form', { onSubmit: e => { e.preventDefault(); submit(async () => { const me = await POST('/auth/login', { identifier: id.value, password: pw.value }, { silent: true }); setMe(me); await start(); }, btn); } },
      h('h2', null, 'Bem-vindo de volta'), h('p', { class: 'muted' }, 'Entre para continuar suas conversas.'),
      oauth(), err, okBox,
      field('Usuário ou e-mail', id), field('Senha', pw),
      h('div', { class: 'row between', style: { marginBottom: '14px' } }, h('span'), h('button', { type: 'button', class: 'linkish', onClick: () => show('forgot') }, 'Esqueci minha senha')),
      btn,
      h('p', { class: 'muted', style: { textAlign: 'center' } }, 'Novo por aqui? ', h('button', { type: 'button', class: 'linkish', onClick: () => show('register') }, 'Criar conta')));
  }
  function register() {
    if (state.config.registrationOpen === false) return h('div', null, h('h2', null, 'Cadastros fechados'), h('p', { class: 'muted' }, 'Novos cadastros estão temporariamente desativados.'), h('button', { class: 'linkish', onClick: () => show('login') }, 'Voltar'));
    const dn = h('input', { class: 'input', placeholder: 'Como quer ser chamado', maxlength: 40 });
    const un = h('input', { class: 'input', placeholder: 'seu_usuario', autocomplete: 'username', maxlength: 24, pattern: '[a-zA-Z0-9_.]{3,24}', required: true });
    const em = h('input', { class: 'input', type: 'email', placeholder: 'voce@email.com', autocomplete: 'email', required: true });
    const pw = h('input', { class: 'input', type: 'password', placeholder: 'mín. 8 caracteres, letras e números', autocomplete: 'new-password', minlength: 8, required: true });
    const terms = h('input', { type: 'checkbox', required: true });
    const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Criar conta');
    return h('form', { onSubmit: e => { e.preventDefault(); submit(async () => {
      const r = await POST('/auth/register', { displayName: dn.value || un.value, username: un.value, email: em.value, password: pw.value }, { silent: true });
      if (r.needsVerification) { show('login'); showOk(r.message); return; }
      setMe(r); await start(); toast('Conta criada! Bem-vindo ao NEW GG ✨', 'gold');
    }, btn); } },
    h('h2', null, 'Criar conta'), h('p', { class: 'muted' }, 'Leva menos de um minuto.'),
    oauth(), err,
    field('Nome de exibição', dn), field('Nome de usuário', un, 'Letras, números, _ e ponto.'), field('E-mail', em), field('Senha', pw),
    h('label', { class: 'row', style: { marginBottom: '14px', fontSize: '.88em' } }, terms, h('span', { class: 'muted' }, 'Aceito as regras da comunidade e a política de privacidade.')),
    btn,
    h('p', { class: 'muted', style: { textAlign: 'center' } }, 'Já tem conta? ', h('button', { type: 'button', class: 'linkish', onClick: () => show('login') }, 'Entrar')));
  }
  function forgot() {
    const em = h('input', { class: 'input', type: 'email', placeholder: 'voce@email.com', required: true });
    const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Enviar link');
    return h('form', { onSubmit: e => { e.preventDefault(); submit(async () => {
      const r = await POST('/auth/forgot', { email: em.value }, { silent: true });
      showOk(r.emailEnabled ? r.message : 'O envio de e-mails ainda não foi configurado neste servidor. Fale com o suporte.');
    }, btn); } },
    h('h2', null, 'Recuperar senha'), h('p', { class: 'muted' }, 'Enviaremos um link de redefinição para o seu e-mail.'),
    err, okBox, field('E-mail', em), btn,
    h('p', { style: { textAlign: 'center' } }, h('button', { type: 'button', class: 'linkish', onClick: () => show('login') }, 'Voltar ao login')));
  }
  function reset() {
    const pw = h('input', { class: 'input', type: 'password', placeholder: 'nova senha', minlength: 8, required: true, autocomplete: 'new-password' });
    const pw2 = h('input', { class: 'input', type: 'password', placeholder: 'repita a senha', minlength: 8, required: true, autocomplete: 'new-password' });
    const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Redefinir senha');
    return h('form', { onSubmit: e => { e.preventDefault(); submit(async () => {
      if (pw.value !== pw2.value) throw new Error('As senhas não coincidem.');
      const r = await POST('/auth/reset', { token: params.get('reset'), password: pw.value }, { silent: true });
      history.replaceState(null, '', '/'); show('login'); showOk(r.message);
    }, btn); } },
    h('h2', null, 'Nova senha'), err, field('Nova senha', pw), field('Confirmar senha', pw2), btn);
  }
  const views = { login, register, forgot, reset };
  function show(m) { clear(card); card.appendChild(views[m]()); setTimeout(() => card.querySelector('input')?.focus(), 30); }
  clear(app).appendChild(h('div', { class: 'auth' }, hero, h('div', { class: 'auth-card-wrap' }, card)));
  show(mode);
  if (notice) showErr(notice);
  if (params.get('authError')) showErr(params.get('authError'));
  if (params.get('verify')) {
    POST('/auth/verify-email', { token: params.get('verify') }, { silent: true }).then(r => showOk(r.message)).catch(e => showErr(e.message));
  }
  if (params.get('authError') || params.get('verify')) history.replaceState(null, '', '/');
}

// ===================== APLICAÇÃO =====================
let shell, rail, side, main, info;

async function start() {
  if (params.get('verify')) {
    await POST('/auth/verify-email', { token: params.get('verify') }, { silent: true }).then(r => toast(r.message, 'ok')).catch(e => toast(e.message, 'error'));
  }
  if (params.get('linked')) toast(`Conta ${params.get('linked')} vinculada!`, 'ok');
  if (params.get('authError')) toast(params.get('authError'), 'error');
  const invitePath = location.pathname.match(/^\/(invite|g)\/([A-Za-z0-9_-]+)/);
  history.replaceState(null, '', '/');

  await Promise.all([chat.loadConversations(), community.loadCommunities(), social.loadFriends()]);
  connectSocket();
  renderShell();
  loadNotifCount();
  showAnnouncements();
  if (invitePath) (invitePath[1] === 'g' ? social.openGroupInvite : community.openInvite)(invitePath[2]);
  if ('Notification' in window && Notification.permission === 'default') {
    document.addEventListener('click', () => Notification.requestPermission().catch(() => {}), { once: true });
  }
}

function renderShell() {
  rail = h('nav', { class: 'rail', 'aria-label': 'Navegação' });
  side = h('aside', { class: 'side' });
  main = h('main', { class: 'main' });
  info = h('div', { id: 'info-slot', style: { display: 'contents' } });
  shell = h('div', { class: 'shell' }, rail, side, main, info);
  const wrap = h('div', { style: { height: '100%', display: 'flex', flexDirection: 'column' } });
  if (state.config.maintenanceNotice) wrap.appendChild(h('div', { class: 'global-banner' }, icon('megaphone', 16), state.config.maintenanceNotice));
  if (state.me.deletionRequestedAt) wrap.appendChild(h('div', { class: 'global-banner' }, '⚠️ Sua conta está agendada para exclusão. ', h('button', { class: 'linkish', onClick: async () => { await POST('/users/me/delete-cancel'); location.reload(); } }, 'Cancelar exclusão')));
  if (!state.me.emailVerified && state.me.email && state.config.emailEnabled) {
    wrap.appendChild(h('div', { class: 'global-banner' }, '✉️ Confirme seu e-mail para proteger sua conta. ',
      h('button', { class: 'linkish', onClick: async () => { const r = await POST('/auth/resend-verification'); toast(r.message, 'ok'); } }, 'Reenviar link')));
  }
  shell.style.flex = '1'; shell.style.minHeight = '0'; shell.style.height = 'auto';
  wrap.appendChild(shell);
  clear(app).appendChild(wrap);
  renderRail();
  go(state.view.section || 'chats');
}

export const layout = {
  get side() { return side; }, get main() { return main; }, get info() { return info; }, get shell() { return shell; },
  setMain(el, { inChat = false } = {}) { clear(main).appendChild(el); shell.classList.toggle('in-chat', inChat); },
  setSide(el) { clear(side).appendChild(el); },
  setInfo(el) { clear(info); if (el) info.appendChild(el); },
  back() { shell.classList.remove('in-chat'); }
};

const SECTIONS = [
  ['chats', 'chat', 'Conversas'], ['friends', 'users', 'Amigos'], ['groups', 'group', 'Grupos'],
  ['discover', 'compass', 'Comunidades'], ['calls', 'phone', 'Chamadas'], ['shop', 'bag', 'Loja GG']
];

export function renderRail() {
  if (!rail) return;
  clear(rail);
  const tip = (el, text) => {
    let t;
    el.addEventListener('mouseenter', () => { const r = el.getBoundingClientRect(); t = h('div', { class: 'rail-tip', style: { left: r.right + 12 + 'px', top: r.top + r.height / 2 - 14 + 'px' } }, text); document.body.appendChild(t); });
    el.addEventListener('mouseleave', () => t?.remove());
    el.addEventListener('click', () => t?.remove());
    return el;
  };
  rail.appendChild(tip(h('img', { class: 'logo', src: '/img/logo-192.png', alt: 'NEW GG', onClick: () => go('chats') }), 'NEW GG'));
  const unreadChats = state.convs.filter(c => c.unread && !c.muted && !c.archived).length;
  for (const [key, ic, label] of SECTIONS) {
    const b = h('button', { class: `rail-btn ${state.view.section === key ? 'on' : ''}`, 'aria-label': label, onClick: () => go(key) }, icon(ic));
    if (key === 'chats' && unreadChats) b.appendChild(h('span', { class: 'badge-count' }, unreadChats > 99 ? '99+' : unreadChats));
    if (key === 'friends' && social.pendingCount()) b.appendChild(h('span', { class: 'badge-count' }, social.pendingCount()));
    rail.appendChild(tip(b, label));
  }
  const notifBtn = h('button', { class: 'rail-btn', 'aria-label': 'Notificações', onClick: () => openNotifications() }, icon('bell'));
  if (state.unreadNotifs) notifBtn.appendChild(h('span', { class: 'badge-count' }, state.unreadNotifs > 99 ? '99+' : state.unreadNotifs));
  rail.appendChild(tip(notifBtn, 'Notificações'));
  rail.appendChild(tip(h('button', { class: 'rail-btn', 'aria-label': 'Pesquisar', onClick: () => openSearch() }, icon('search')), 'Pesquisa global'));
  rail.appendChild(h('div', { class: 'rail-sep' }));
  const coms = h('div', { class: 'communities-rail' });
  for (const c of state.communities) {
    const b = h('button', { class: `rail-btn community ${state.view.section === 'community' && state.view.communityId === c.id ? 'on' : ''}`, 'aria-label': c.name, onClick: () => go('community', { communityId: c.id }) },
      c.logo ? h('img', { src: c.logo, alt: '' }) : c.name.slice(0, 2).toUpperCase());
    if (c.unread) b.appendChild(h('span', { class: 'dot' }));
    coms.appendChild(tip(b, c.name));
  }
  coms.appendChild(tip(h('button', { class: 'rail-btn', style: { color: 'var(--gold)' }, 'aria-label': 'Criar comunidade', onClick: () => community.openCreate() }, icon('plus')), 'Criar comunidade'));
  rail.appendChild(coms);
  rail.appendChild(h('div', { class: 'spacer' }));
  if (['owner', 'admin', 'moderator', 'support'].includes(state.me.role)) {
    rail.appendChild(tip(h('button', { class: 'rail-btn', style: { color: 'var(--gold)' }, 'aria-label': 'Administração', onClick: () => openAdmin() }, icon('shield')), 'Painel administrativo'));
  }
  rail.appendChild(tip(h('button', { class: 'rail-btn', 'aria-label': 'Suporte', onClick: () => openSupport() }, icon('support')), 'Central de suporte'));
  rail.appendChild(tip(h('button', { class: 'rail-btn', 'aria-label': 'Configurações', onClick: () => openSettings() }, icon('cog')), 'Configurações'));
  const meBtn = h('button', { class: 'me-btn', 'aria-label': 'Meu status', onClick: e => meMenu(e) }, avatar(state.me, 44, { presence: state.me.presence }));
  rail.appendChild(tip(meBtn, `${state.me.displayName} · ${PRESENCE_LABEL[state.me.presence]}`));
}

function meMenu(e) {
  const set = async p => { await api('PATCH', '/users/me/presence', { presence: p }); state.me.presence = p; renderRail(); };
  menu(e, [
    { icon: 'user', label: 'Meu perfil', onClick: () => social.openProfile(state.me.id) },
    { icon: 'edit', label: 'Definir status personalizado', onClick: () => openSettings('profile') },
    '-',
    { label: '🟢 Online', onClick: () => set('online') },
    { label: '🟡 Ausente', onClick: () => set('away') },
    { label: '🔴 Ocupado', onClick: () => set('busy') },
    { label: '⚫ Invisível', onClick: () => set('invisible') },
    '-',
    { icon: 'logout', label: 'Sair', danger: true, onClick: logout }
  ]);
}
export async function logout() {
  await POST('/auth/logout').catch(() => {});
  state.socket?.close();
  location.href = '/';
}

// navegação entre seções
export function go(section, opts = {}) {
  state.view.section = section;
  if (section === 'community') state.view.communityId = opts.communityId;
  renderRail();
  layout.setInfo(null);
  if (section === 'chats') { chat.renderConvSide('all'); if (!state.view.convId || !chat.isDirectConv(state.view.convId)) chat.renderWelcome(); else chat.openChat(state.view.convId); }
  else if (section === 'groups') { chat.renderConvSide('groups'); chat.renderWelcome('groups'); }
  else if (section === 'friends') { social.renderFriendsSide(); social.renderFriendsPage(); }
  else if (section === 'calls') { calls.renderCallsSide(); chat.renderWelcome('calls'); }
  else if (section === 'shop') { shop.renderShopSide(); shop.renderShop(); }
  else if (section === 'discover') { community.renderDiscoverSide(); community.renderDiscover(); }
  else if (section === 'community') community.openCommunity(opts.communityId, opts.channelId, opts.highlight);
}

// ===================== SOCKET =====================
function connectSocket() {
  // eslint-disable-next-line no-undef
  const s = io({ transports: ['websocket', 'polling'], withCredentials: true });
  state.socket = s;
  let first = true;
  s.on('ready', () => {
    if (!first) { chat.loadConversations().then(() => { chat.refreshSide(); chat.resyncOpen(); }); community.loadCommunities().then(renderRail); }
    first = false;
    calls.onReconnect();
  });
  s.on('connect_error', e => { if (e.message === 'unauthorized') location.href = '/'; });
  s.on('disconnect', reason => { if (reason === 'io server disconnect') { toast('Sua sessão foi encerrada.', 'error'); setTimeout(() => (location.href = '/'), 1500); } });

  s.on('message:new', m => chat.onMessageNew(m));
  s.on('message:update', m => chat.onMessageUpdate(m));
  s.on('receipt', r => chat.onReceipt(r));
  s.on('typing', t => chat.onTyping(t));
  s.on('conversation:read', r => chat.onReadElsewhere(r));
  s.on('conversations:changed', async d => {
    await chat.loadConversations(); chat.refreshSide(); renderRail();
    if (d?.removed && state.view.convId === d.removed) { toast('Você não participa mais desta conversa.', 'error'); chat.renderWelcome(); }
  });
  s.on('conversation:update', d => chat.onConversationUpdate(d));
  s.on('presence', p => { if (p.self) { state.me.presence = p.presence === 'offline' ? state.me.presence : p.presence; renderRail(); } emit('presence', p); });
  s.on('user:update', u => { if (u.id === state.me.id) { Object.assign(state.me, u); renderRail(); } emit('user:update', u); });
  s.on('wallet', w => emit('wallet', w));
  s.on('friends:changed', async () => { await social.loadFriends(); renderRail(); emit('friends:changed'); });
  s.on('community:update', async d => { await community.loadCommunities(); renderRail(); emit('community:update', d); });
  s.on('community:removed', async d => {
    await community.loadCommunities(); renderRail();
    if (state.view.section === 'community' && state.view.communityId === d.id) { toast('Você não tem mais acesso a esta comunidade.', 'error'); go('discover'); }
  });
  s.on('stories:changed', () => emit('stories:changed'));
  s.on('story:viewed', d => emit('story:viewed', d));
  s.on('notification', n => onNotification(n));
  s.on('badge', b => toast(`Nova conquista: ${b.icon} ${b.name}`, 'gold', { title: 'Conquista desbloqueada!' }));
  s.on('announcement', a => { toast(a.content.slice(0, 140), 'gold', { title: `📢 ${a.title}`, timeout: 9000 }); });
  s.on('support:changed', d => emit('support:changed', d));
  s.on('badge-styles', b => { state.config.badgeStyles = b; renderRail(); chat.resyncOpen(); });
  calls.bindSocket(s);
  voice.bindSocket(s);
}

// ===================== NOTIFICAÇÕES =====================
async function loadNotifCount() {
  const r = await GET('/notifications', { silent: true }).catch(() => null);
  if (r) { state.unreadNotifs = r.unread; renderRail(); }
}
export function notifText(n) {
  const a = n.actor?.displayName || 'Alguém';
  const d = n.data || {};
  return {
    friend_request: `${a} enviou uma solicitação de amizade`, friend_accept: `${a} aceitou sua solicitação de amizade`,
    mention: `${a} mencionou você${d.convName ? ` em ${d.convName}` : ''}: “${d.preview || ''}”`,
    reply: `${a} respondeu sua mensagem: “${d.preview || ''}”`, reaction: `${a} reagiu ${d.emoji || ''} à sua mensagem`,
    group_invite: d.approved ? `Sua entrada em ${d.name} foi aprovada` : `${a} adicionou você ao grupo ${d.name}`,
    group_join_request: `${a} pediu para entrar em ${d.name}`,
    community_invite: `${a} convidou você para a comunidade ${d.name}`,
    call: `${a} ligou para você (${d.media === 'video' ? 'vídeo' : 'voz'})`,
    story_reply: `${a} respondeu seu story: “${d.preview || ''}”`, story_reaction: `${a} reagiu ${d.emoji || ''} ao seu story`,
    announcement: `📢 ${d.title}: ${d.text || ''}`, admin: d.text || 'Aviso da administração', ticket: d.text || 'Atualização no seu chamado',
    message: `${a}: ${d.preview || ''}`
  }[n.type] || 'Nova notificação';
}
function notifAction(n) {
  const d = n.data || {};
  if (d.conversationId && d.communityId) return () => go('community', { communityId: d.communityId, channelId: d.conversationId });
  if (d.conversationId) return () => chat.openChat(d.conversationId, { highlight: d.messageId });
  if (n.type === 'friend_request' || n.type === 'friend_accept') return () => go('friends');
  if (n.type === 'community_invite' && d.code) return () => community.openInvite(d.code);
  if (n.type === 'ticket') return () => openSupport(d.ticketId);
  if (d.storyId) return () => social.openStoryArchive();
  if (n.actor) return () => social.openProfile(n.actor.id);
  return null;
}
function onNotification(n) {
  state.unreadNotifs++; renderRail();
  const text = notifText(n);
  const act = notifAction(n);
  if (n.type === 'call') return; // tratado pela tela de chamada
  sound('notify');
  toast(text, n.type === 'announcement' ? 'gold' : 'info', { onClick: act });
  desktopNotify('NEW GG', text, act);
  if (n.type === 'friend_request') social.loadFriends().then(renderRail);
}
async function openNotifications() {
  const list = h('div', { class: 'stack' }, h('div', { class: 'spinner' }));
  const m = modal({
    title: 'Notificações', body: list,
    foot: [h('button', { class: 'btn ghost', onClick: async () => { await api('DELETE', '/notifications'); render([]); } }, 'Limpar tudo'),
      h('button', { class: 'btn', onClick: async () => { await POST('/notifications/read', { all: true }); state.unreadNotifs = 0; renderRail(); load(); } }, 'Marcar todas como lidas')]
  });
  function render(items) {
    clear(list);
    if (!items.length) return list.appendChild(h('div', { class: 'empty' }, h('span', { class: 'spark' }, '✦'), 'Nenhuma notificação por aqui.'));
    for (const n of items) {
      const act = notifAction(n);
      list.appendChild(h('div', { class: `list-item ${n.read ? '' : 'unread'}`, onClick: async () => { if (!n.read) { await POST('/notifications/read', { ids: [n.id] }); state.unreadNotifs = Math.max(0, state.unreadNotifs - 1); renderRail(); } if (act) { m.close(); act(); } } },
        n.actor ? avatar(n.actor, 38) : h('div', { class: 'avatar', style: { width: '38px', height: '38px', background: 'rgba(245,197,66,.15)', color: 'var(--gold)' } }, icon('bell', 18)),
        h('div', { class: 'meta' }, h('div', { style: { whiteSpace: 'normal', fontWeight: n.read ? 500 : 700 } }, notifText(n)), h('div', { class: 'sub' }, fmtRelative(n.createdAt))),
        !n.read ? h('span', { class: 'gold' }, '✦') : null,
        iconBtn('x', 'Remover', async e => { e.stopPropagation(); await api('DELETE', `/notifications/${n.id}`); load(); })));
    }
  }
  async function load() { const r = await GET('/notifications'); state.unreadNotifs = r.unread; renderRail(); render(r.items); }
  load();
}

async function showAnnouncements() {
  const list = await GET('/announcements/active', { silent: true }).catch(() => []);
  const seen = JSON.parse(localStorage.getItem('ngg_seen_ann') || '[]');
  const fresh = list.filter(a => !seen.includes(a.id));
  if (!fresh.length) return;
  const a = fresh[0];
  modal({
    title: `📢 ${a.title}`, body: h('p', { style: { whiteSpace: 'pre-wrap' } }, a.content),
    foot: h('button', { class: 'btn primary', onClick: e => e.target.closest('.modal-back').remove() }, 'Entendi'),
    onClose: () => {}
  });
  localStorage.setItem('ngg_seen_ann', JSON.stringify([...seen, ...fresh.map(x => x.id)].slice(-50)));
}

// ===================== PESQUISA GLOBAL =====================
export function openSearch(initial = '') {
  const input = h('input', { class: 'input', placeholder: 'Pesquisar usuários, mensagens, grupos, comunidades, canais, arquivos…', value: initial });
  let type = 'all';
  const results = h('div', { class: 'stack', style: { marginTop: '12px' } });
  const tb = tabs([['all', 'Tudo'], ['users', 'Usuários'], ['conversations', 'Conversas'], ['messages', 'Mensagens'], ['groups', 'Grupos'], ['communities', 'Comunidades'], ['channels', 'Canais'], ['files', 'Arquivos']], 'all', t => { type = t; run(); });
  const m = modal({ title: 'Pesquisa global', size: 'wide', body: h('div', null, h('div', { class: 'search-box' }, icon('search'), input), h('div', { style: { marginTop: '10px' } }, tb), results) });
  let timer;
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 250); });
  const close = fn => () => { m.close(); fn(); };
  const sec = (title, items, render) => items?.length ? [h('div', { class: 'section-label' }, title), ...items.map(render)] : [];
  async function run() {
    const q = input.value.trim();
    clear(results);
    if (!q) return results.appendChild(h('div', { class: 'empty' }, 'Digite algo para pesquisar.'));
    results.appendChild(h('div', { class: 'spinner' }));
    const r = await GET(`/search?q=${encodeURIComponent(q)}&type=${type}`).catch(() => ({}));
    clear(results);
    const nodes = [
      ...sec('Usuários', r.users, u => h('button', { class: 'list-item', onClick: close(() => social.openProfile(u.id)) }, avatar(u, 38, { presence: u.presence }), h('div', { class: 'meta' }, h('div', { class: 'name' }, h('span', null, u.displayName), roleMark(u)), h('div', { class: 'sub' }, '@' + u.username)))),
      ...sec('Conversas', r.conversations, c => h('button', { class: 'list-item', onClick: close(() => chat.openChat(c.id)) }, avatar(c, 38), h('div', { class: 'meta' }, h('div', { class: 'name' }, c.name), h('div', { class: 'sub' }, c.type === 'dm' ? 'Conversa privada' : 'Grupo')))),
      ...sec('Mensagens', r.messages, msg => h('button', { class: 'list-item', onClick: close(() => msg.conversation?.communityId ? go('community', { communityId: msg.conversation.communityId, channelId: msg.conversationId, highlight: msg.id }) : chat.openChat(msg.conversationId, { highlight: msg.id })) },
        avatar(msg.sender || {}, 34), h('div', { class: 'meta' }, h('div', { class: 'name' }, h('span', null, msg.sender?.displayName || ''), h('small', { class: 'faint' }, ` em ${msg.conversation?.type === 'channel' ? `#${msg.conversation.name} · ${msg.conversation.communityName}` : msg.conversation?.name || 'conversa privada'} · ${fmtRelative(msg.createdAt)}`)),
          h('div', { class: 'sub' }, msg.content)))),
      ...sec('Grupos', r.groups, g => h('button', { class: 'list-item', onClick: close(() => g.joined ? chat.openChat(g.id) : social.joinPublicGroup(g.id)) }, avatar(g, 38, { square: true }), h('div', { class: 'meta' }, h('div', { class: 'name' }, g.name), h('div', { class: 'sub' }, g.joined ? 'Você participa' : 'Grupo público · toque para entrar')))),
      ...sec('Comunidades', r.communities, c => h('button', { class: 'list-item', onClick: close(() => c.joined ? go('community', { communityId: c.id }) : community.previewCommunity(c.id)) }, avatar(c, 38, { square: true }), h('div', { class: 'meta' }, h('div', { class: 'name' }, c.name), h('div', { class: 'sub' }, c.description || (c.joined ? 'Membro' : 'Comunidade pública'))))),
      ...sec('Canais', r.channels, c => h('button', { class: 'list-item', onClick: close(() => go('community', { communityId: c.communityId, channelId: c.id })) }, icon('hash'), h('div', { class: 'meta' }, h('div', { class: 'name' }, c.name), h('div', { class: 'sub' }, c.communityName)))),
      ...sec('Arquivos', r.files, f => h('a', { class: 'list-item', href: f.url + '?download=1', style: { textDecoration: 'none', color: 'inherit' } }, icon(f.kind === 'image' ? 'image' : 'file'), h('div', { class: 'meta' }, h('div', { class: 'name' }, f.name), h('div', { class: 'sub' }, fmtRelative(f.createdAt)))))
    ];
    if (!nodes.length) results.appendChild(h('div', { class: 'empty' }, h('span', { class: 'spark' }, '✦'), 'Nada encontrado.'));
    else nodes.forEach(n => results.appendChild(n));
  }
  if (initial) run();
}

// atalhos
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && state.me) { e.preventDefault(); openSearch(); }
});

window.addEventListener('beforeunload', () => { calls.hangupAll?.(); voice.leave(true); });
on('logout', logout);
void confirmDialog;

boot();
