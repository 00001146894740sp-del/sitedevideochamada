import {
  state, emit, on, api, GET, POST, PATCH, DEL, h, clear, icon, iconBtn, toast, modal, menu, closeMenu, confirmDialog, promptDialog,
  avatar, roleMark, richText, fmtTime, fmtDay, fmtShort, fmtSize, fmtDur, fmtRelative, sound, desktopNotify, pickFiles, lightbox,
  copy, field, switchEl, tabs, EMOJI, recentEmojis, pushRecentEmoji, PRESENCE_LABEL, ROLE_LABEL
} from './core.js';
import { layout, go, renderRail } from './app.js';
import * as social from './social.js';
import * as calls from './calls.js';

const QUICK = ['👍', '❤️', '😂', '🔥', '😮', '😢'];
const cache = new Map(); // convId -> { detail, messages, hasMore }
let cur = null; // { id, detail, els, community }
let sideFilter = 'all';
let sideQuery = '';

// ===================== CONVERSAS =====================
export async function loadConversations() {
  state.convs = await GET('/conversations', { silent: true }).catch(() => state.convs);
}
export const isDirectConv = id => state.convs.some(c => c.id === id);
const convById = id => state.convs.find(c => c.id === id);

export function refreshSide() {
  if (state.view.section === 'chats') renderConvSide('all', true);
  else if (state.view.section === 'groups') renderConvSide('groups', true);
}

export function renderConvSide(mode = 'all', keepFilter = false) {
  if (!keepFilter) sideFilter = mode === 'groups' ? 'groups' : 'all';
  const isGroups = mode === 'groups';
  const list = h('div', { class: 'side-body' });
  const searchIn = h('input', { class: 'input', placeholder: isGroups ? 'Buscar grupos' : 'Buscar conversas', value: sideQuery });
  searchIn.addEventListener('input', () => { sideQuery = searchIn.value; fill(); });
  const newBtn = h('button', { class: 'btn primary sm', onClick: e => menu(e, [
    { icon: 'chat', label: 'Nova conversa', onClick: openNewDM },
    { icon: 'group', label: 'Novo grupo', onClick: openNewGroup },
    { icon: 'link', label: 'Entrar com link de convite', onClick: joinByLink },
    isGroups ? { icon: 'compass', label: 'Explorar grupos públicos', onClick: () => social.openPublicGroups() } : null
  ]) }, icon('plus', 16), 'Nova');
  const head = h('div', { class: 'side-head' },
    h('div', { class: 'row between' }, h('h2', { class: 'side-title' }, h('span', { class: 'spark' }, '✦'), isGroups ? 'Grupos' : 'Conversas'), newBtn),
    h('div', { class: 'search-box' }, icon('search'), searchIn));
  if (!isGroups) {
    head.appendChild(social.storiesStrip());
    head.appendChild(tabs([['all', 'Todas'], ['unread', 'Não lidas'], ['dm', 'Privadas'], ['groups', 'Grupos'], ['archived', 'Arquivadas']], sideFilter, f => { sideFilter = f; fill(); }));
  } else {
    head.appendChild(tabs([['groups', 'Meus grupos'], ['archived', 'Arquivados']], sideFilter === 'archived' ? 'archived' : 'groups', f => { sideFilter = f === 'groups' ? 'groups' : 'archived-groups'; fill(); }));
  }
  function fill() {
    clear(list);
    const q = sideQuery.trim().toLowerCase();
    let items = state.convs.filter(c => {
      if (q && !(c.name || '').toLowerCase().includes(q) && !(c.other?.username || '').toLowerCase().includes(q)) return false;
      if (sideFilter === 'archived') return c.archived && (!isGroups || c.type === 'group');
      if (sideFilter === 'archived-groups') return c.archived && c.type === 'group';
      if (c.archived) return false;
      if (sideFilter === 'unread') return c.unread > 0;
      if (sideFilter === 'dm') return c.type === 'dm';
      if (sideFilter === 'groups') return c.type === 'group';
      return true;
    });
    items = items.sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
    if (!items.length) {
      list.appendChild(h('div', { class: 'empty' }, h('span', { class: 'spark' }, '✦'),
        sideFilter === 'archived' ? 'Nenhuma conversa arquivada.' : 'Nenhuma conversa ainda.',
        h('div', { style: { marginTop: '12px' } }, h('button', { class: 'btn sm', onClick: isGroups ? openNewGroup : openNewDM }, isGroups ? 'Criar grupo' : 'Começar conversa'))));
      return;
    }
    for (const c of items) list.appendChild(convItem(c));
  }
  fill();
  layout.setSide(h('div', { style: { display: 'contents' } }, head, list));
}

function lastPreview(c) {
  const typers = state.typing.get(c.id);
  if (typers && typers.size) return { text: `${[...typers.values()].map(t => t.name.split(' ')[0]).join(', ')} digitando…`, typing: true };
  const l = c.last;
  if (!l) return { text: c.type === 'group' ? `${c.memberCount} participantes` : 'Diga olá! 👋' };
  if (l.deleted) return { text: '🚫 Mensagem apagada' };
  const mine = l.senderId === state.me.id ? 'Você: ' : '';
  if (l.type === 'system') return { text: l.content };
  if (l.type === 'call') return { text: `📞 ${l.content}` };
  if (l.type === 'sticker') return { text: `${mine}🏷️ Figurinha` };
  if (l.type === 'gif') return { text: `${mine}🎞️ GIF` };
  if (l.type === 'voice') return { text: `${mine}🎤 Mensagem de voz` };
  if (!l.content && l.attKind) return { text: mine + ({ image: '📷 Foto', video: '🎬 Vídeo', audio: '🎵 Áudio', document: '📄 Documento' }[l.attKind] || '📎 Arquivo') };
  return { text: mine + l.content };
}

function convItem(c) {
  const p = lastPreview(c);
  const el = h('button', { class: `list-item ${state.view.convId === c.id ? 'on' : ''} ${c.unread ? 'unread' : ''}`, onClick: () => openChat(c.id), onContextmenu: e => { e.preventDefault(); convMenu(e, c); } },
    avatar(c.type === 'dm' ? (c.other || c) : c, 46, { presence: c.type === 'dm' ? c.other?.presence : null, square: c.type === 'group' }),
    h('div', { class: 'meta' },
      h('div', { class: 'name' }, h('span', null, c.name || 'Conversa'), c.type === 'dm' ? roleMark(c.other?.role) : null, c.muted ? icon('mute', 14) : null),
      h('div', { class: `sub ${p.typing ? 'typing' : ''}` }, p.text)),
    h('div', { style: { display: 'grid', justifyItems: 'end', gap: '4px' } },
      h('span', { class: 'time' }, c.last ? fmtShort(c.last.createdAt) : ''),
      c.unread ? h('span', { class: 'badge-count', style: c.muted ? { background: 'var(--panel3)', color: 'var(--muted)' } : null }, c.unread > 99 ? '99+' : c.unread) : null));
  return el;
}

function convMenu(e, c) {
  menu(e, [
    { icon: 'archive', label: c.archived ? 'Desarquivar' : 'Arquivar', onClick: () => setMine(c.id, { archived: !c.archived }) },
    { icon: 'mute', label: c.muted ? 'Ativar notificações' : 'Silenciar notificações', onClick: () => setMine(c.id, { muted: !c.muted }) },
    { icon: 'check', label: 'Marcar como lida', onClick: () => markRead(c.id, true) },
    '-',
    { icon: 'trash', label: 'Limpar histórico', danger: true, onClick: () => clearHistory(c.id) }
  ]);
}
async function setMine(id, body) {
  await PATCH(`/conversations/${id}/me`, body);
  const c = convById(id); if (c) Object.assign(c, body);
  if (body.archived !== undefined) toast(body.archived ? 'Conversa arquivada.' : 'Conversa desarquivada.', 'ok');
  refreshSide(); renderRail();
  if (cur?.id === id) { cur.detail.me && Object.assign(cur.detail.me, body); renderInfo(); }
}
async function clearHistory(id) {
  if (!await confirmDialog('As mensagens serão removidas apenas para você. Os outros participantes continuarão vendo o histórico.', { title: 'Limpar histórico', confirmText: 'Limpar', danger: true })) return;
  await POST(`/conversations/${id}/clear`);
  cache.delete(id);
  await loadConversations(); refreshSide();
  if (cur?.id === id) openChat(id);
  toast('Histórico limpo.', 'ok');
}

export function renderWelcome(kind) {
  if (state.view.section !== 'community') state.view.convId = null;
  cur = null;
  layout.setInfo(null);
  const texts = {
    groups: ['Seus grupos', 'Crie um grupo, convide seus amigos por link e defina administradores e permissões.'],
    calls: ['Chamadas', 'Ligue por voz ou vídeo a partir de qualquer conversa ou grupo. Seu histórico aparece ao lado.']
  }[kind] || ['Bem-vindo ao NEW GG', 'Escolha uma conversa ao lado ou comece algo novo. Use Ctrl + K para pesquisar qualquer coisa.'];
  layout.setMain(h('div', { class: 'welcome chat-bg-aurora' },
    h('img', { src: '/img/logo-192.png', alt: '' }),
    h('h2', null, texts[0]), h('p', null, texts[1]),
    h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '8px' } },
      h('button', { class: 'btn primary', onClick: openNewDM }, icon('chat', 18), 'Nova conversa'),
      h('button', { class: 'btn', onClick: openNewGroup }, icon('group', 18), 'Novo grupo'))));
}

// ===================== NOVA CONVERSA / GRUPO =====================
export function openNewDM() {
  const input = h('input', { class: 'input', placeholder: 'Buscar por nome ou @usuario' });
  const list = h('div', { class: 'stack', style: { marginTop: '10px', maxHeight: '50vh', overflow: 'auto' } });
  const m = modal({ title: 'Nova conversa', body: h('div', null, h('div', { class: 'search-box' }, icon('search'), input), list) });
  const render = users => {
    clear(list);
    if (!users.length) return list.appendChild(h('div', { class: 'empty' }, 'Ninguém encontrado.'));
    for (const u of users) list.appendChild(h('button', { class: 'list-item', onClick: async () => { m.close(); await startDM(u.id); } },
      avatar(u, 40, { presence: u.presence }), h('div', { class: 'meta' }, h('div', { class: 'name' }, h('span', null, u.displayName), roleMark(u.role)), h('div', { class: 'sub' }, '@' + u.username))));
  };
  render(state.friends);
  let t;
  input.addEventListener('input', () => {
    clearTimeout(t);
    const q = input.value.trim().replace(/^@/, '');
    if (!q) return render(state.friends);
    t = setTimeout(async () => render(await GET(`/users/search?q=${encodeURIComponent(q)}`)), 220);
  });
}
export async function startDM(userId) {
  const c = await POST('/conversations/dm', { userId });
  const idx = state.convs.findIndex(x => x.id === c.id);
  if (idx >= 0) state.convs[idx] = c; else state.convs.unshift(c);
  if (state.view.section !== 'chats' && state.view.section !== 'friends') go('chats');
  openChat(c.id);
}

export function openNewGroup(preselect = []) {
  const name = h('input', { class: 'input', placeholder: 'Ex.: Squad do fim de semana', maxlength: 60 });
  const desc = h('textarea', { class: 'textarea', placeholder: 'Sobre o que é o grupo? (opcional)', maxlength: 500 });
  const privacy = h('select', { class: 'select' }, h('option', { value: 'private' }, 'Privado — só por convite'), h('option', { value: 'public' }, 'Público — qualquer um pode encontrar e entrar'));
  const selected = new Set(Array.isArray(preselect) ? preselect : []);
  const list = h('div', { class: 'stack', style: { maxHeight: '34vh', overflow: 'auto' } });
  for (const f of state.friends) {
    const cb = h('input', { type: 'checkbox', checked: selected.has(f.id) });
    cb.addEventListener('change', () => cb.checked ? selected.add(f.id) : selected.delete(f.id));
    list.appendChild(h('label', { class: 'list-item' }, cb, avatar(f, 34), h('div', { class: 'meta' }, h('div', { class: 'name' }, f.displayName), h('div', { class: 'sub' }, '@' + f.username))));
  }
  if (!state.friends.length) list.appendChild(h('div', { class: 'hint' }, 'Adicione amigos para incluí-los agora — ou compartilhe o link de convite depois.'));
  const btn = h('button', { class: 'btn primary' }, 'Criar grupo');
  const m = modal({
    title: 'Novo grupo',
    body: h('div', null, field('Nome do grupo', name), field('Descrição', desc), field('Privacidade', privacy), h('div', { class: 'label', style: { marginBottom: '6px' } }, 'Participantes'), list),
    foot: [h('button', { class: 'btn ghost', onClick: () => m.close() }, 'Cancelar'), btn]
  });
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const g = await POST('/conversations/group', { name: name.value, description: desc.value, privacy: privacy.value, memberIds: [...selected] });
      m.close(); state.convs.unshift(g); toast('Grupo criado!', 'ok'); go('groups'); openChat(g.id);
    } catch { btn.disabled = false; }
  });
}

async function joinByLink() {
  const v = await promptDialog('Cole o link ou código do convite', { title: 'Entrar com convite', placeholder: 'https://…/g/abc123 ou /invite/xyz', confirmText: 'Continuar' });
  if (!v) return;
  const g = v.match(/\/g\/([A-Za-z0-9_-]+)/); const c = v.match(/\/invite\/([A-Za-z0-9_-]+)/);
  if (g) social.openGroupInvite(g[1]);
  else if (c) (await import('./community.js')).openInvite(c[1]);
  else social.openGroupInvite(v.trim());
}

// ===================== ABRIR CHAT =====================
export async function openChat(id, { highlight, community } = {}) {
  state.view.convId = id;
  if (!community && state.view.section !== 'chats' && state.view.section !== 'groups' && state.view.section !== 'friends' && state.view.section !== 'calls') {
    state.view.section = convById(id)?.type === 'group' ? 'groups' : 'chats';
    renderConvSide(state.view.section === 'groups' ? 'groups' : 'all');
    renderRail();
  }
  refreshSide();
  const loading = h('div', { class: 'welcome' }, h('div', { class: 'spinner' }));
  layout.setMain(loading, { inChat: true });
  let detail;
  try { detail = await GET(`/conversations/${id}`); } catch { renderWelcome(); return; }
  if (state.view.convId !== id) return;
  let entry = cache.get(id);
  if (!entry || highlight) {
    const r = await GET(`/conversations/${id}/messages?limit=50${highlight ? `&around=${highlight}` : ''}`);
    entry = { messages: r.messages, hasMore: r.hasMore, around: !!highlight };
    cache.set(id, entry);
  }
  entry.detail = detail;
  cur = { id, detail, community, entry, firstUnread: firstUnreadId(id, entry.messages), selection: new Set() };
  renderChat();
  if (highlight) setTimeout(() => flashMessage(highlight), 80);
  markRead(id);
}

function firstUnreadId(id, msgs) {
  const c = convById(id);
  if (!c?.unread) return null;
  const lastRead = cur?.detail?.me?.lastReadId ?? 0;
  const m = msgs.find(x => x.id > lastRead && x.sender?.id !== state.me.id && x.type !== 'system');
  return m?.id || null;
}

export function resyncOpen() {
  if (cur) { cache.delete(cur.id); openChat(cur.id, { community: cur.community }); }
}

function renderChat() {
  if (window.innerWidth <= 1180 && !cur.keepInfo) state.infoOpen = false;
  const d = cur.detail;
  const isChannel = d.type === 'channel';
  const conv = convById(d.id);
  const title = isChannel ? `# ${d.name}` : d.name;
  const status = h('div', { class: 'status' });
  const head = h('header', { class: 'chat-head' },
    iconBtn('back', 'Voltar', () => layout.back(), 'back'),
    isChannel ? h('div', { class: 'avatar square', style: { width: '40px', height: '40px', background: 'rgba(var(--accent-rgb),.18)', color: 'var(--accent-2)' } }, icon(d.category === 'anuncios' ? 'megaphone' : d.isPrivate ? 'lock' : 'hash', 20))
      : avatar(d.type === 'dm' ? d.other : d, 40, { presence: d.type === 'dm' ? d.other?.presence : null, square: d.type === 'group' }),
    h('div', { class: 'grow', style: { cursor: 'pointer', minWidth: 0 }, onClick: toggleInfo },
      h('div', { class: 'title' }, h('span', { class: 'ellipsis' }, title), d.type === 'dm' ? roleMark(d.other?.role) : null, conv?.muted ? icon('mute', 15) : null),
      status),
    d.type !== 'channel' ? iconBtn('phone', 'Chamada de voz', () => calls.startCall(d.id, 'audio')) : null,
    d.type !== 'channel' ? iconBtn('video', 'Chamada de vídeo', () => calls.startCall(d.id, 'video')) : null,
    iconBtn('pin', 'Mensagens fixadas', openPins, 'hide-m'),
    iconBtn('search', 'Pesquisar na conversa', openConvSearch, 'hide-m'),
    iconBtn('info', 'Detalhes', toggleInfo, state.infoOpen ? 'active' : ''));
  const msgs = h('div', { class: 'messages', role: 'log', 'aria-live': 'polite' });
  const typingLine = h('div', { class: 'typing-line' });
  const composerWrap = h('div', { class: 'composer-wrap', style: { position: 'relative' } });
  const bg = `chat-bg-${state.settings.chatBg || 'aurora'}`;
  const wrap = h('section', { class: `main ${bg}`, style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } }, head);
  if (d.notice) wrap.appendChild(h('div', { class: 'notice-bar' }, icon('megaphone'), h('span', { class: 'grow' }, d.notice)));
  if (isChannel && d.topic) wrap.appendChild(h('div', { class: 'notice-bar' }, icon('info'), h('span', { class: 'grow muted' }, d.topic)));
  wrap.append(msgs, typingLine, composerWrap);
  layout.setMain(wrap, { inChat: true });
  cur.els = { head, status, msgs, typingLine, composerWrap, wrap };
  updateStatus();
  renderMessages(true);
  renderComposer();
  msgs.addEventListener('scroll', onScroll);
  if (state.infoOpen) renderInfo(); else layout.setInfo(null);
}

function updateStatus() {
  if (!cur?.els) return;
  const d = cur.detail; const st = cur.els.status;
  const typers = state.typing.get(d.id);
  clear(st); st.className = 'status';
  if (typers?.size) {
    st.classList.add('typing');
    st.append(h('span', { class: 'dots' }, h('i'), h('i'), h('i')), ` ${[...typers.values()].map(t => t.name.split(' ')[0]).join(', ')} digitando…`);
  } else if (d.type === 'dm') st.textContent = d.blocked ? 'Indisponível' : (d.other?.customStatus || PRESENCE_LABEL[d.other?.presence] || '');
  else if (d.type === 'group') {
    const online = d.members.filter(m => m.status === 'active' && m.presence && m.presence !== 'offline').length;
    st.textContent = `${d.members.filter(m => m.status === 'active').length} participantes${online ? ` · ${online} online` : ''}`;
  } else st.textContent = cur.community?.name || 'Canal';
  // linha de digitando acima do campo
  clear(cur.els.typingLine);
  if (typers?.size && d.type !== 'dm') cur.els.typingLine.append(h('span', { class: 'dots' }, h('i'), h('i'), h('i')), `${[...typers.values()].map(t => t.name).join(', ')} está digitando…`);
}

// ===================== MENSAGENS =====================
function renderMessages(scrollBottom) {
  const { msgs } = cur.els;
  const prevH = msgs.scrollHeight; const prevTop = msgs.scrollTop;
  clear(msgs);
  if (cur.entry.hasMore) msgs.appendChild(h('button', { class: 'btn sm ghost load-more', onClick: loadOlder }, 'Carregar mensagens anteriores'));
  else msgs.appendChild(chatIntro());
  let prev = null;
  for (const m of cur.entry.messages) {
    if (!prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString()) msgs.appendChild(h('div', { class: 'day-sep' }, fmtDay(m.createdAt)));
    if (cur.firstUnread && m.id === cur.firstUnread) msgs.appendChild(h('div', { class: 'unread-sep' }, 'Novas mensagens'));
    msgs.appendChild(messageEl(m, prev));
    prev = m;
  }
  if (cur.entry.around) msgs.appendChild(h('button', { class: 'btn sm ghost load-more', onClick: () => { cache.delete(cur.id); openChat(cur.id, { community: cur.community }); } }, 'Ir para as mensagens mais recentes ↓'));
  if (scrollBottom) msgs.scrollTop = msgs.scrollHeight;
  else msgs.scrollTop = prevTop + (msgs.scrollHeight - prevH);
}

function chatIntro() {
  const d = cur.detail;
  return h('div', { style: { padding: '30px 6px 10px' } },
    d.type === 'channel' ? h('div', { class: 'avatar square', style: { width: '64px', height: '64px', background: 'rgba(var(--accent-rgb),.18)', color: 'var(--accent-2)' } }, icon('hash', 32)) : avatar(d.type === 'dm' ? d.other : d, 72, { square: d.type === 'group' }),
    h('h2', { style: { fontFamily: 'var(--display)', margin: '12px 0 4px' } }, d.type === 'channel' ? `Bem-vindo a #${d.name}` : d.name),
    h('p', { class: 'muted', style: { margin: 0 } }, d.type === 'dm' ? `Este é o começo da sua conversa com ${d.name}.` : d.type === 'group' ? (d.description || 'Este é o começo do grupo.') : (d.topic || 'Este é o começo do canal.')),
    h('p', { class: 'faint', style: { fontSize: '.8em' } }, '🔒 As mensagens são protegidas em trânsito (HTTPS/WSS) e só são acessíveis aos participantes.'));
}

function msgStatus(m) {
  const d = cur.detail;
  if (d.type === 'channel' || m.sender?.id !== state.me.id) return null;
  const others = (d.members || []).filter(x => x.id !== state.me.id && x.status === 'active');
  if (!others.length) return 'sent';
  const read = others.every(o => o.lastReadId != null && o.lastReadId >= m.id);
  if (read) return 'read';
  if (others.every(o => (o.lastDeliveredId || 0) >= m.id || (o.lastReadId || 0) >= m.id)) return 'delivered';
  return 'sent';
}

function messageEl(m, prev) {
  if (m.type === 'system') {
    return h('div', { class: 'msg system', dataset: { id: m.id } }, h('div', { class: `sys ${m.meta?.notice ? 'notice' : ''}` }, m.content, ' · ', fmtTime(m.createdAt)));
  }
  const mine = m.sender?.id === state.me.id;
  const grouped = prev && prev.type !== 'system' && prev.sender?.id === m.sender?.id && (new Date(m.createdAt) - new Date(prev.createdAt)) < 5 * 60000 && new Date(prev.createdAt).toDateString() === new Date(m.createdAt).toDateString();
  const el = h('div', { class: `msg ${mine ? 'mine' : ''} ${cur.selection?.has(m.id) ? 'selected' : ''}`, dataset: { id: m.id } });
  el.appendChild(h('div', { class: 'av-col' }, !grouped && m.sender ? h('div', { style: { marginTop: '8px', cursor: 'pointer' }, onClick: () => social.openProfile(m.sender.id) }, avatar(m.sender, 36)) : null));
  const body = h('div', { class: 'body' });
  if (!grouped) body.appendChild(h('div', { class: 'who' }, h('b', { style: { color: m.sender?.color }, onClick: () => m.sender && social.openProfile(m.sender.id) }, m.sender?.displayName || 'Usuário removido'), roleMark(m.sender?.role), h('time', null, fmtTime(m.createdAt))));
  const bubble = h('div', { class: 'bubble' });
  if (m.deleted) {
    bubble.classList.add('deleted');
    bubble.append('🚫 Mensagem apagada');
  } else {
    if (m.forwarded) bubble.appendChild(h('div', { class: 'forwarded' }, icon('forward', 13), 'Encaminhada'));
    if (m.replyTo) bubble.appendChild(h('div', { class: 'reply-quote', onClick: () => jumpTo(m.replyTo.id) }, h('b', null, m.replyTo.senderName || 'Mensagem'), h('span', null, m.replyTo.content)));
    if (m.type === 'story_reply') bubble.appendChild(h('div', { class: 'story-ref' }, m.meta.storyThumb ? h('img', { src: m.meta.storyThumb, alt: '' }) : h('span', null, '✨'), h('span', null, `Respondeu ${mine ? 'ao story' : 'ao seu story'}${m.meta.storyText ? `: “${m.meta.storyText}”` : ''}`)));
    if (m.type === 'call') {
      bubble.appendChild(h('div', { class: 'call-pill' }, icon(m.meta.media === 'video' ? 'video' : 'phone'), m.content,
        h('button', { class: 'btn sm ghost', onClick: () => calls.startCall(m.conversationId, m.meta.media) }, 'Ligar de volta')));
    } else if (m.type === 'sticker') {
      bubble.classList.add('media-only'); bubble.appendChild(h('img', { class: 'sticker-img', src: m.meta.url, alt: 'figurinha' }));
    } else if (m.type === 'gif') {
      bubble.classList.add('media-only'); bubble.appendChild(h('img', { class: 'gif-img', src: m.meta.url, alt: 'GIF', loading: 'lazy', onLoad: stickToBottom }));
    } else if (m.content) {
      bubble.appendChild(richText(m.content, { onMention: u => social.openProfileByUsername(u) }));
    }
    if (m.attachments.length) bubble.appendChild(attachmentsEl(m));
    if (!m.content && m.attachments.length && m.attachments.every(a => a.kind === 'image' || a.kind === 'video') && !m.replyTo && !m.forwarded) bubble.classList.add('media-only');
    if (m.linkPreview) {
      const lp = m.linkPreview;
      bubble.appendChild(h('a', { class: 'link-card', href: lp.url, target: '_blank', rel: 'noopener noreferrer nofollow' },
        h('div', null, h('small', null, lp.site), h('b', null, lp.title), lp.description ? h('p', null, lp.description) : null),
        lp.image ? h('img', { src: lp.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : h('span')));
    }
    const st = msgStatus(m);
    bubble.appendChild(h('span', { class: 'meta-line' },
      m.pinned ? h('span', { class: 'pin-mark', title: 'Fixada' }, icon('pin', 12)) : null,
      m.favorite ? h('span', { class: 'pin-mark', title: 'Favorita' }, icon('star', 12)) : null,
      m.editedAt ? h('span', null, 'editada') : null,
      grouped ? fmtTime(m.createdAt) : null,
      st ? h('span', { class: `ticks ${st === 'read' ? 'read' : ''}`, title: { sent: 'Enviada', delivered: 'Entregue', read: 'Visualizada' }[st] }, icon(st === 'sent' ? 'check' : 'checks')) : null));
  }
  body.appendChild(bubble);
  if (m.reactions.length) {
    body.appendChild(h('div', { class: 'reactions' }, m.reactions.map(r => {
      const me = r.users.includes(state.me.id);
      return h('button', { class: `reaction ${me ? 'me' : ''}`, title: `${r.count} reação(ões)`, onClick: () => react(m, r.emoji) }, r.emoji, h('small', null, r.count));
    })));
  }
  el.appendChild(body);
  if (!m.deleted) el.appendChild(toolsEl(m, mine));
  el.addEventListener('contextmenu', e => { if (m.deleted) return; e.preventDefault(); moreMenu(e, m, mine); });
  if (cur.selection?.size) el.addEventListener('click', () => toggleSelect(m.id));
  let pressTimer;
  el.addEventListener('touchstart', () => { pressTimer = setTimeout(() => !m.deleted && moreMenu({ currentTarget: el }, m, mine), 500); }, { passive: true });
  el.addEventListener('touchend', () => clearTimeout(pressTimer));
  return el;
}

// mantém a rolagem no fim quando imagens terminam de carregar
function stickToBottom() {
  const el = cur?.els?.msgs;
  if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 500) el.scrollTop = el.scrollHeight;
}

function attachmentsEl(m) {
  const wrap = h('div', { class: `attachments ${m.attachments.length === 1 ? 'single' : ''}` });
  for (const a of m.attachments) {
    if (a.kind === 'image') wrap.appendChild(h('div', { class: 'att-img', onClick: () => lightbox(a.url, 'image', a.name) }, h('img', { src: a.url, alt: a.name, loading: 'lazy', onLoad: stickToBottom })));
    else if (a.kind === 'video') wrap.appendChild(h('div', { class: 'att-video' }, h('video', { src: a.url, controls: true, preload: 'metadata' })));
    else if (a.kind === 'audio') wrap.appendChild(h('div', { class: 'voice' }, m.type === 'voice' ? icon('mic', 18) : icon('file', 18), h('audio', { src: a.url, controls: true, preload: 'metadata' }), m.meta?.duration ? h('small', { class: 'faint' }, fmtDur(m.meta.duration)) : null));
    else wrap.appendChild(h('a', { class: 'att-file', href: a.url + '?download=1' }, h('span', { class: 'fi' }, icon('file')), h('div', { class: 'grow', style: { minWidth: 0 } }, h('b', { class: 'ellipsis', style: { display: 'block' } }, a.name), h('small', null, `${fmtSize(a.size)} · ${a.mime.split('/').pop()}`)), icon('download', 18)));
  }
  return wrap;
}

function toolsEl(m, mine) {
  return h('div', { class: 'msg-tools' },
    QUICK.slice(0, 3).map(e => h('button', { class: 'quick', title: `Reagir ${e}`, onClick: ev => { ev.stopPropagation(); react(m, e); } }, e)),
    cur.detail.perms.canSend || cur.detail.type === 'channel' ? iconBtn('reply', 'Responder', () => startReply(m)) : null,
    iconBtn('smile', 'Reagir', e => reactPicker(e, m)),
    iconBtn('more', 'Mais', e => moreMenu(e, m, mine)));
}

function moreMenu(e, m, mine) {
  const d = cur.detail;
  const items = [
    { icon: 'reply', label: 'Responder', onClick: () => startReply(m) },
    { icon: 'forward', label: 'Encaminhar', onClick: () => openForward([m.id]) },
    m.content ? { icon: 'copy', label: 'Copiar texto', onClick: () => copy(m.content) } : null,
    mine && m.type === 'text' ? { icon: 'edit', label: 'Editar', onClick: () => startEdit(m) } : null,
    d.perms.canPin ? { icon: 'pin', label: m.pinned ? 'Desafixar' : 'Fixar', onClick: () => togglePin(m) } : null,
    { icon: 'star', label: m.favorite ? 'Remover dos favoritos' : 'Favoritar', onClick: () => toggleFav(m) },
    { icon: 'check', label: 'Selecionar', onClick: () => toggleSelect(m.id) },
    { icon: 'link', label: 'Copiar ID da mensagem', onClick: () => copy(String(m.id)) },
    '-',
    d.type !== 'channel' ? { icon: 'trash', label: 'Apagar para mim', danger: true, onClick: () => deleteMsg(m, false) } : null,
    mine || d.perms.canModerate ? { icon: 'trash', label: 'Apagar para todos', danger: true, onClick: () => deleteMsg(m, true) } : null,
    !mine ? { icon: 'flag', label: 'Denunciar', danger: true, onClick: () => social.openReport('message', m.id) } : null
  ];
  menu(e, items, { emojis: { list: QUICK, pick: em => react(m, em) } });
}

function reactPicker(e, m) {
  const all = [...new Set([...(state.settings.emojiFavorites || []), ...recentEmojis(), ...EMOJI['Carinhas'].slice(0, 20), ...EMOJI['Corações'].slice(0, 8), ...EMOJI['Gestos'].slice(0, 12)])].slice(0, 48);
  const grid = h('div', { class: 'emoji-grid', style: { padding: '6px', width: '300px' } }, all.map(x => h('button', { onClick: () => { closeMenu(); react(m, x); } }, x)));
  const mm = menu(e, []);
  mm.appendChild(grid);
}

async function react(m, emoji) {
  pushRecentEmoji(emoji);
  await POST(`/messages/${m.id}/reactions`, { emoji });
}
async function togglePin(m) {
  if (m.pinned) await DEL(`/messages/${m.id}/pin`); else await POST(`/messages/${m.id}/pin`);
  toast(m.pinned ? 'Mensagem desafixada.' : 'Mensagem fixada.', 'ok');
}
async function toggleFav(m) {
  const r = await POST(`/messages/${m.id}/favorite`);
  m.favorite = r.favorite; replaceMessage(m, { keepFav: false });
  toast(r.favorite ? 'Adicionada aos favoritos ⭐' : 'Removida dos favoritos.', 'ok');
}
async function deleteMsg(m, forAll) {
  if (!await confirmDialog(forAll ? 'A mensagem será apagada para todos os participantes.' : 'A mensagem será removida apenas para você.', { title: 'Apagar mensagem', confirmText: 'Apagar', danger: true })) return;
  await DEL(`/messages/${m.id}?forAll=${forAll ? 1 : 0}`);
  if (!forAll) { cur.entry.messages = cur.entry.messages.filter(x => x.id !== m.id); renderMessages(false); }
}

function toggleSelect(id) {
  if (cur.selection.has(id)) cur.selection.delete(id); else cur.selection.add(id);
  renderMessages(false); renderComposer();
}

async function loadOlder() {
  if (cur.loadingOlder || !cur.entry.hasMore) return;
  cur.loadingOlder = true;
  const first = cur.entry.messages[0];
  try {
    const r = await GET(`/conversations/${cur.id}/messages?before=${first?.id || ''}&limit=50`);
    cur.entry.messages = [...r.messages, ...cur.entry.messages];
    cur.entry.hasMore = r.hasMore;
    renderMessages(false);
  } finally { cur.loadingOlder = false; }
}
function onScroll() {
  const el = cur.els.msgs;
  if (el.scrollTop < 80 && cur.entry.hasMore) loadOlder();
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 60) markRead(cur.id);
}
const nearBottom = () => { const el = cur?.els?.msgs; return el && el.scrollHeight - el.scrollTop - el.clientHeight < 160; };

function replaceMessage(m, { keepFav = true } = {}) {
  if (!cur || m.conversationId !== cur.id) return;
  const idx = cur.entry.messages.findIndex(x => x.id === m.id);
  if (idx < 0) return;
  const prevFav = cur.entry.messages[idx].favorite;
  cur.entry.messages[idx] = { ...m, favorite: keepFav ? prevFav : m.favorite };
  const old = cur.els.msgs.querySelector(`.msg[data-id="${m.id}"]`);
  if (old) old.replaceWith(messageEl(cur.entry.messages[idx], cur.entry.messages[idx - 1]));
}

function jumpTo(id) {
  if (cur.entry.messages.some(m => m.id === id)) flashMessage(id);
  else openChat(cur.id, { highlight: id, community: cur.community });
}
function flashMessage(id) {
  const el = cur?.els?.msgs.querySelector(`.msg[data-id="${id}"]`);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

let readTimer;
export function markRead(id, force) {
  const c = convById(id);
  if (!force && (document.hidden || !cur || cur.id !== id || !nearBottom())) return;
  clearTimeout(readTimer);
  readTimer = setTimeout(async () => {
    await POST(`/conversations/${id}/read`, {}, { silent: true }).catch(() => {});
    if (c) { c.unread = 0; refreshSide(); renderRail(); }
    emit('channel:read', id);
  }, 250);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && cur) markRead(cur.id); });

// ===================== EVENTOS EM TEMPO REAL =====================
export function onMessageNew(m) {
  const mine = m.sender?.id === state.me.id;
  const entry = cache.get(m.conversationId);
  if (entry && !entry.around && !entry.messages.some(x => x.id === m.id)) entry.messages.push(m);
  // confirma entrega
  if (!mine && m.type !== 'system') state.socket.emit('delivered', { conversationId: m.conversationId, messageId: m.id });
  // remove "digitando"
  const t = state.typing.get(m.conversationId); if (t && m.sender) { t.delete(m.sender.id); }
  const c = convById(m.conversationId);
  if (c) {
    c.last = { id: m.id, content: m.content.slice(0, 140), type: m.type, senderId: m.sender?.id, createdAt: m.createdAt, deleted: false, attKind: m.attachments[0]?.kind };
    c.lastMessageAt = m.createdAt;
    const viewing = cur && cur.id === m.conversationId && !document.hidden;
    if (!mine && m.type !== 'system' && !viewing) c.unread = (c.unread || 0) + 1;
    if (c.archived && !c.muted) c.archived = false;
    refreshSide(); renderRail();
  } else if (m.conversationId && !cur?.community && (m.type !== 'system')) {
    // conversa nova (ex.: alguém iniciou DM) — recarrega lista
    loadConversations().then(() => { refreshSide(); renderRail(); });
  }
  emit('channel:message', m);
  if (cur && cur.id === m.conversationId) {
    const atBottom = nearBottom();
    if (!entry?.around) {
      const prev = cur.entry.messages[cur.entry.messages.length - 2];
      if (!prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString()) cur.els.msgs.appendChild(h('div', { class: 'day-sep' }, fmtDay(m.createdAt)));
      cur.els.msgs.appendChild(messageEl(m, prev));
      if (atBottom || mine) cur.els.msgs.scrollTop = cur.els.msgs.scrollHeight;
    }
    updateStatus();
    if (!mine) { markRead(cur.id); if (document.hidden) notifyMessage(m, c); }
  } else if (!mine && m.type !== 'system') {
    notifyMessage(m, c);
  }
}
function notifyMessage(m, c) {
  if (c?.muted) return;
  if (!c && !cur?.community) return; // canais: só menções notificam (via notificações)
  if (!c) return;
  if (state.settings?.notifications?.messages === false) return;
  sound('message');
  const text = m.content || (m.attachments.length ? '📎 Anexo' : m.type === 'sticker' ? 'Figurinha' : m.type === 'voice' ? '🎤 Mensagem de voz' : 'Nova mensagem');
  const title = c.type === 'group' ? `${m.sender?.displayName} em ${c.name}` : m.sender?.displayName;
  desktopNotify(title, text.slice(0, 120), () => openChat(m.conversationId));
  if (!cur || cur.id !== m.conversationId) toast(text.slice(0, 100), 'info', { title, onClick: () => openChat(m.conversationId) });
}
export function onMessageUpdate(m) {
  const entry = cache.get(m.conversationId);
  if (entry) {
    const idx = entry.messages.findIndex(x => x.id === m.id);
    if (idx >= 0) entry.messages[idx] = { ...m, favorite: entry.messages[idx].favorite };
  }
  replaceMessage(m);
  const c = convById(m.conversationId);
  if (c?.last?.id === m.id) { c.last.deleted = m.deleted; c.last.content = m.content; refreshSide(); }
}
export function onReceipt(r) {
  const entry = cache.get(r.conversationId);
  const mem = entry?.detail?.members?.find(x => x.id === r.userId);
  if (mem) {
    if (r.lastDeliveredId) mem.lastDeliveredId = Math.max(mem.lastDeliveredId || 0, r.lastDeliveredId);
    if (r.lastReadId) mem.lastReadId = Math.max(mem.lastReadId || 0, r.lastReadId);
  }
  if (cur && cur.id === r.conversationId && r.userId !== state.me.id) {
    // atualiza apenas os ticks das minhas mensagens recentes
    for (const m of cur.entry.messages.slice(-40)) if (m.sender?.id === state.me.id) replaceMessage(m);
  }
}
export function onTyping(t) {
  if (t.userId === state.me.id) return;
  if (!state.typing.has(t.conversationId)) state.typing.set(t.conversationId, new Map());
  const map = state.typing.get(t.conversationId);
  if (t.typing) map.set(t.userId, { name: t.name, t: Date.now() }); else map.delete(t.userId);
  if (cur?.id === t.conversationId) updateStatus();
  refreshSide();
}
setInterval(() => {
  let changed = false;
  for (const [cid, map] of state.typing) for (const [uid, v] of map) if (Date.now() - v.t > 6000) { map.delete(uid); changed = true; if (cur?.id === cid) updateStatus(); }
  if (changed) refreshSide();
}, 2000);
export function onReadElsewhere(r) {
  const c = convById(r.conversationId);
  if (c) { c.unread = 0; refreshSide(); renderRail(); }
}
export async function onConversationUpdate(d) {
  if (cur?.id === d.id) {
    const detail = await GET(`/conversations/${d.id}`, { silent: true }).catch(() => null);
    if (!detail) return;
    cur.detail = detail; cur.entry.detail = detail;
    updateStatus(); renderComposer(); if (state.infoOpen) renderInfo();
  }
  await loadConversations(); refreshSide();
}
on('presence', p => {
  for (const c of state.convs) if (c.other?.id === p.userId) c.other.presence = p.presence;
  if (cur?.detail?.members) { const m = cur.detail.members.find(x => x.id === p.userId); if (m) m.presence = p.presence; if (cur.detail.other?.id === p.userId) cur.detail.other.presence = p.presence; updateStatus(); }
  refreshSide();
});
on('user:update', u => {
  for (const c of state.convs) if (c.other?.id === u.id) { Object.assign(c.other, u); c.name = u.displayName; c.avatar = u.avatar; }
  refreshSide();
});

// ===================== COMPOSER =====================
let composerState = { replyTo: null, editing: null, files: [] };
function resetComposer() { composerState = { replyTo: null, editing: null, files: [] }; }

function startReply(m) { composerState.replyTo = m; composerState.editing = null; renderComposer(); }
function startEdit(m) { composerState.editing = m; composerState.replyTo = null; renderComposer(m.content); }

function renderComposer(prefill) {
  if (!cur?.els) return;
  const wrap = clear(cur.els.composerWrap);
  const d = cur.detail;
  if (composerState.convId !== cur.id) { resetComposer(); composerState.convId = cur.id; }
  if (cur.selection.size) {
    wrap.appendChild(h('div', { class: 'select-bar' },
      h('b', { class: 'grow' }, `${cur.selection.size} selecionada(s)`),
      h('button', { class: 'btn sm', onClick: () => openForward([...cur.selection]) }, icon('forward', 16), 'Encaminhar'),
      h('button', { class: 'btn sm danger', onClick: bulkDelete }, icon('trash', 16), 'Apagar'),
      h('button', { class: 'btn sm ghost', onClick: () => { cur.selection.clear(); renderMessages(false); renderComposer(); } }, 'Cancelar')));
    return;
  }
  if (!d.perms.canSend) {
    const why = d.blocked ? 'Você não pode enviar mensagens para este usuário.' : d.perms.silenced ? 'Você está silenciado neste grupo.' : d.type === 'channel' ? 'Você não tem permissão para enviar mensagens neste canal.' : d.onlyAdminsSend ? 'Somente administradores podem enviar mensagens.' : 'Você não pode enviar mensagens aqui.';
    wrap.appendChild(h('div', { class: 'composer-blocked' }, icon('lock', 16), ' ', why));
    return;
  }
  const ta = h('textarea', { rows: 1, placeholder: d.type === 'channel' ? `Conversar em #${d.name}` : `Mensagem para ${d.name}`, maxlength: 4000, 'aria-label': 'Mensagem' });
  if (prefill !== undefined) ta.value = prefill;
  else if (composerState.draft) ta.value = composerState.draft;
  const autosize = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 180) + 'px'; };
  let lastTyping = 0; let typingOff;
  ta.addEventListener('input', () => {
    autosize(); composerState.draft = ta.value;
    if (Date.now() - lastTyping > 2500) { state.socket.emit('typing', { conversationId: cur.id, typing: true }); lastTyping = Date.now(); }
    clearTimeout(typingOff); typingOff = setTimeout(() => { state.socket.emit('typing', { conversationId: cur.id, typing: false }); lastTyping = 0; }, 3500);
    mentionCheck();
  });
  ta.addEventListener('keydown', e => {
    if (mentionPop && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) return mentionKey(e);
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    if (e.key === 'Escape') { if (composerState.editing || composerState.replyTo) { composerState.editing = null; composerState.replyTo = null; renderComposer(''); } }
    if (e.key === 'ArrowUp' && !ta.value) {
      const last = [...cur.entry.messages].reverse().find(m => m.sender?.id === state.me.id && m.type === 'text' && !m.deleted);
      if (last) { e.preventDefault(); startEdit(last); }
    }
  });
  ta.addEventListener('paste', e => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); addFiles(files); }
  });

  // contexto (resposta / edição)
  if (composerState.replyTo || composerState.editing) {
    const m = composerState.replyTo || composerState.editing;
    wrap.appendChild(h('div', { class: 'composer-ctx' }, icon(composerState.editing ? 'edit' : 'reply', 16),
      h('div', { class: 'grow' }, h('b', null, composerState.editing ? 'Editando mensagem' : `Respondendo a ${m.sender?.displayName || ''}`), h('div', { class: 'q' }, m.content || '[anexo]')),
      iconBtn('x', 'Cancelar', () => { composerState.replyTo = null; composerState.editing = null; renderComposer(''); })));
  }
  if (composerState.files.length) {
    wrap.appendChild(h('div', { class: 'pending-files' }, composerState.files.map(pf => {
      const prev = pf.file.type.startsWith('image/') ? h('img', { src: pf.preview, alt: '' }) : pf.file.type.startsWith('video/') ? h('video', { src: pf.preview, muted: true }) : null;
      return h('div', { class: 'pending-file', title: pf.file.name }, prev, prev ? null : h('span', null, icon('file', 22), h('br'), pf.file.name.slice(0, 18)),
        h('button', { onClick: () => { composerState.files = composerState.files.filter(x => x !== pf); renderComposer(ta.value); } }, '×'),
        h('span', { class: 'prog', style: { width: `${Math.round((pf.progress || 0) * 100)}%` } }));
    })));
  }
  const attach = iconBtn('clip', 'Anexar arquivos', async () => addFiles(await pickFiles({ multiple: true, accept: 'image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.txt,.csv,.zip,.rar,.7z,.md,.json' })));
  if (!d.perms.canSendMedia) attach.disabled = true;
  const emojiBtn = iconBtn('smile', 'Emojis, figurinhas e GIFs', () => togglePicker(ta));
  const micBtn = iconBtn('mic', 'Gravar mensagem de voz', () => startRecording());
  if (!d.perms.canSendMedia) micBtn.disabled = true;
  const sendBtn = h('button', { class: 'icon-btn send', title: 'Enviar', onClick: () => send() }, icon('send'));
  const comp = h('div', { class: 'composer' }, attach, emojiBtn, ta, micBtn, sendBtn);
  wrap.appendChild(comp);
  cur.els.ta = ta; cur.els.comp = comp;
  setTimeout(() => { autosize(); if (window.innerWidth > 860) ta.focus(); }, 0);
  // arrastar e soltar
  cur.els.wrap.ondragover = e => { e.preventDefault(); };
  cur.els.wrap.ondrop = e => { e.preventDefault(); if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]); };
}

async function addFiles(files) {
  if (!files.length) return;
  const max = (state.config.maxUploadMb || 25) * 1024 * 1024;
  for (const f of files.slice(0, 10)) {
    if (f.size > max) { toast(`${f.name} excede ${state.config.maxUploadMb || 25} MB.`, 'error'); continue; }
    const pf = { file: f, preview: URL.createObjectURL(f), progress: 0 };
    composerState.files.push(pf);
    const form = new FormData(); form.append('files', f, f.name);
    pf.promise = api('POST', '/uploads', undefined, { form, onProgress: p => { pf.progress = p; const bar = cur?.els?.composerWrap.querySelectorAll('.pending-file .prog')[composerState.files.indexOf(pf)]; if (bar) bar.style.width = `${Math.round(p * 100)}%`; } })
      .then(r => { pf.uploaded = r[0]; pf.progress = 1; })
      .catch(() => { composerState.files = composerState.files.filter(x => x !== pf); renderComposer(cur?.els?.ta?.value); });
  }
  renderComposer(cur.els.ta?.value);
}

async function send(extra = {}) {
  const ta = cur.els.ta;
  const text = ta ? ta.value.trim() : '';
  if (composerState.editing) {
    if (!text) return;
    await PATCH(`/messages/${composerState.editing.id}`, { content: text });
    composerState.editing = null; composerState.draft = ''; renderComposer('');
    return;
  }
  const pending = composerState.files;
  if (!text && !pending.length && !extra.type) return;
  if (pending.some(p => !p.uploaded)) {
    toast('Aguarde o envio dos arquivos…');
    await Promise.all(pending.map(p => p.promise));
  }
  const body = { content: extra.type ? '' : text, replyToId: composerState.replyTo?.id, fileIds: extra.fileIds || composerState.files.filter(p => p.uploaded).map(p => p.uploaded.id), ...extra };
  const saved = { ...composerState };
  composerState.replyTo = null; composerState.files = []; composerState.draft = '';
  if (!extra.type) renderComposer('');
  try {
    await POST(`/conversations/${cur.id}/messages`, body);
    state.socket.emit('typing', { conversationId: cur.id, typing: false });
    sound('send');
  } catch {
    if (!extra.type) { composerState.replyTo = saved.replyTo; composerState.files = saved.files; renderComposer(text); }
  }
}

async function bulkDelete() {
  const ids = [...cur.selection];
  const msgs = cur.entry.messages.filter(m => ids.includes(m.id));
  const canAll = msgs.every(m => m.sender?.id === state.me.id) || cur.detail.perms.canModerate;
  const forAll = canAll && await confirmDialog(`Apagar ${ids.length} mensagem(ns) para todos?`, { title: 'Apagar mensagens', confirmText: 'Apagar para todos', danger: true });
  if (!forAll) {
    if (cur.detail.type === 'channel') return;
    if (!await confirmDialog(`Apagar ${ids.length} mensagem(ns) apenas para você?`, { title: 'Apagar para mim', confirmText: 'Apagar', danger: true })) return;
  }
  await POST('/messages/bulk-delete', { messageIds: ids, forAll });
  if (!forAll) cur.entry.messages = cur.entry.messages.filter(m => !ids.includes(m.id));
  cur.selection.clear(); renderMessages(false); renderComposer();
}

// ---------- menções (@) ----------
let mentionPop = null; let mentionIdx = 0; let mentionList = [];
async function mentionCheck() {
  const ta = cur.els.ta;
  const before = ta.value.slice(0, ta.selectionStart);
  const m = before.match(/@([a-zA-Z0-9_.]{0,24})$/);
  if (!m) return closeMention();
  const q = m[1].toLowerCase();
  let pool = cur.detail.members || [];
  if (cur.detail.type === 'channel' && cur.community) {
    if (!cur.memberPool) cur.memberPool = await GET(`/communities/${cur.community.id}/members`, { silent: true }).catch(() => []);
    pool = cur.memberPool;
  }
  mentionList = pool.filter(u => u.id !== state.me.id && (u.username.toLowerCase().startsWith(q) || u.displayName.toLowerCase().includes(q))).slice(0, 8);
  if (!mentionList.length) return closeMention();
  mentionIdx = 0; drawMention();
}
function drawMention() {
  mentionPop?.remove();
  mentionPop = h('div', { class: 'mention-pop' }, mentionList.map((u, i) => h('button', { class: `list-item ${i === mentionIdx ? 'on' : ''}`, onMousedown: e => { e.preventDefault(); pickMention(u); } }, avatar(u, 28), h('div', { class: 'meta' }, h('div', { class: 'name' }, u.displayName), h('div', { class: 'sub' }, '@' + u.username)))));
  cur.els.composerWrap.appendChild(mentionPop);
}
function mentionKey(e) {
  e.preventDefault();
  if (e.key === 'Escape') return closeMention();
  if (e.key === 'ArrowDown') { mentionIdx = (mentionIdx + 1) % mentionList.length; drawMention(); }
  else if (e.key === 'ArrowUp') { mentionIdx = (mentionIdx - 1 + mentionList.length) % mentionList.length; drawMention(); }
  else pickMention(mentionList[mentionIdx]);
}
function pickMention(u) {
  const ta = cur.els.ta; const pos = ta.selectionStart;
  const before = ta.value.slice(0, pos).replace(/@([a-zA-Z0-9_.]{0,24})$/, `@${u.username} `);
  ta.value = before + ta.value.slice(pos);
  ta.selectionStart = ta.selectionEnd = before.length; ta.focus();
  closeMention();
}
function closeMention() { mentionPop?.remove(); mentionPop = null; }

// ---------- painel de emojis / figurinhas / GIFs ----------
let picker = null;
function togglePicker(ta) {
  if (picker) { picker.remove(); picker = null; return; }
  const body = h('div', { class: 'picker-body' });
  const insert = e => { const p = ta.selectionStart; ta.value = ta.value.slice(0, p) + e + ta.value.slice(ta.selectionEnd); ta.selectionStart = ta.selectionEnd = p + e.length; ta.focus(); pushRecentEmoji(e); ta.dispatchEvent(new Event('input')); };
  const showEmoji = () => {
    clear(body);
    const favs = state.settings.emojiFavorites || [];
    const groups = { 'Favoritos': favs, 'Recentes': recentEmojis(), ...EMOJI };
    for (const [g, list] of Object.entries(groups)) {
      if (!list.length) continue;
      body.appendChild(h('div', { class: 'section-label' }, g));
      body.appendChild(h('div', { class: 'emoji-grid' }, list.map(e => h('button', { title: e, onClick: () => insert(e), onContextmenu: ev => { ev.preventDefault(); toggleFavEmoji(e); } }, e))));
    }
    body.appendChild(h('p', { class: 'hint' }, 'Dica: clique com o botão direito num emoji para (des)favoritar.'));
  };
  const showStickers = async () => {
    clear(body).appendChild(h('div', { class: 'spinner' }));
    const list = await GET('/stickers');
    clear(body);
    body.appendChild(h('div', { class: 'row between', style: { margin: '4px 0 8px' } }, h('span', { class: 'hint' }, 'Suas figurinhas e favoritas'),
      h('button', { class: 'btn sm', onClick: async () => { const [f] = await pickFiles({ accept: 'image/png,image/webp,image/gif,image/jpeg' }); if (!f) return; const fd = new FormData(); fd.append('file', f); await api('POST', '/stickers', undefined, { form: fd }); toast('Figurinha criada!', 'ok'); showStickers(); } }, icon('plus', 14), 'Criar')));
    if (!list.length) body.appendChild(h('div', { class: 'empty' }, 'Crie figurinhas a partir das suas imagens (PNG/WebP/GIF até 2 MB).'));
    body.appendChild(h('div', { class: 'sticker-grid' }, list.sort((a, b) => b.favorite - a.favorite).map(s => h('button', {
      title: s.name || 'Figurinha',
      onClick: () => { picker?.remove(); picker = null; send({ type: 'sticker', stickerId: s.id }); },
      onContextmenu: e => { e.preventDefault(); menu(e, [{ icon: 'star', label: s.favorite ? 'Desfavoritar' : 'Favoritar', onClick: async () => { await POST(`/stickers/${s.id}/favorite`); showStickers(); } }, s.mine ? { icon: 'trash', label: 'Excluir', danger: true, onClick: async () => { await DEL(`/stickers/${s.id}`); showStickers(); } } : null]); }
    }, h('img', { src: s.url, alt: '' }), s.favorite ? h('span', { class: 'fav' }, '★') : null))));
  };
  const showGifs = () => {
    clear(body);
    if (!state.config.gifs) return body.appendChild(h('div', { class: 'empty' }, 'GIFs não estão configurados neste servidor (TENOR_API_KEY).'));
    const q = h('input', { class: 'input', placeholder: 'Buscar GIFs no Tenor' });
    const grid = h('div', { class: 'gif-grid', style: { marginTop: '8px' } });
    body.append(q, grid);
    const load = async () => {
      clear(grid).appendChild(h('div', { class: 'spinner' }));
      const list = await GET(`/gifs?q=${encodeURIComponent(q.value)}`).catch(() => []);
      clear(grid);
      for (const g of list) grid.appendChild(h('button', { title: g.title || 'GIF', onClick: () => { picker?.remove(); picker = null; send({ type: 'gif', gifUrl: g.url, width: g.width, height: g.height }); } }, h('img', { src: g.preview || g.url, alt: '', loading: 'lazy' })));
    };
    let t; q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 300); });
    load();
  };
  picker = h('div', { class: 'picker' }, tabs([['emoji', '😀 Emojis'], ['stickers', '🏷️ Figurinhas'], ['gifs', '🎞️ GIFs']], 'emoji', k => ({ emoji: showEmoji, stickers: showStickers, gifs: showGifs })[k]()), body);
  cur.els.composerWrap.appendChild(picker);
  showEmoji();
  setTimeout(() => document.addEventListener('mousedown', function off(e) { if (picker && !picker.contains(e.target) && !e.target.closest('.composer')) { picker.remove(); picker = null; document.removeEventListener('mousedown', off); } }), 0);
}
async function toggleFavEmoji(e) {
  const favs = state.settings.emojiFavorites || [];
  const next = favs.includes(e) ? favs.filter(x => x !== e) : [...favs, e].slice(-24);
  state.settings = await PATCH('/users/me/settings', { emojiFavorites: next });
  toast(favs.includes(e) ? 'Removido dos favoritos.' : 'Adicionado aos favoritos!', 'ok');
}

// ---------- gravação de voz ----------
async function startRecording() {
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return toast('Permita o acesso ao microfone para gravar.', 'error'); }
  const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(t => window.MediaRecorder?.isTypeSupported?.(t)) || '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = []; const started = Date.now(); let cancelled = false;
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const timer = h('span', null, '0:00');
  const iv = setInterval(() => { timer.textContent = fmtDur((Date.now() - started) / 1000); if (Date.now() - started > 5 * 60000) rec.stop(); }, 250);
  const comp = cur.els.comp;
  const restore = clear(comp);
  void restore;
  comp.append(
    iconBtn('trash', 'Cancelar', () => { cancelled = true; rec.stop(); }, 'danger'),
    h('div', { class: 'recording' }, h('span', { class: 'rec-dot' }), 'Gravando… ', timer),
    h('button', { class: 'icon-btn send', title: 'Enviar áudio', onClick: () => rec.stop() }, icon('send')));
  rec.onstop = async () => {
    clearInterval(iv); stream.getTracks().forEach(t => t.stop());
    const dur = Math.round((Date.now() - started) / 1000);
    renderComposer('');
    if (cancelled || dur < 1) return;
    const type = rec.mimeType || 'audio/webm';
    const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'weba';
    const fd = new FormData(); fd.append('files', new Blob(chunks, { type }), `voice-${Date.now()}.${ext}`);
    try {
      const [f] = await api('POST', '/uploads', undefined, { form: fd });
      await POST(`/conversations/${cur.id}/messages`, { type: 'voice', fileIds: [f.id], duration: dur, replyToId: composerState.replyTo?.id });
      composerState.replyTo = null;
    } catch { /* toast já exibido */ }
  };
  rec.start(250);
}

// ===================== MODAIS DA CONVERSA =====================
async function openPins() {
  const list = h('div', { class: 'stack' }, h('div', { class: 'spinner' }));
  const m = modal({ title: '📌 Mensagens fixadas', body: list });
  const pins = await GET(`/conversations/${cur.id}/pins`);
  clear(list);
  if (!pins.length) return list.appendChild(h('div', { class: 'empty' }, h('span', { class: 'spark' }, '✦'), 'Nenhuma mensagem fixada.'));
  for (const p of pins) list.appendChild(h('button', { class: 'list-item', onClick: () => { m.close(); jumpTo(p.id); } }, avatar(p.sender || {}, 34),
    h('div', { class: 'meta' }, h('div', { class: 'name' }, p.sender?.displayName || '', h('small', { class: 'faint' }, ' · ' + fmtRelative(p.createdAt))), h('div', { class: 'sub' }, p.content || '[anexo]'))));
}
function openConvSearch() {
  const input = h('input', { class: 'input', placeholder: 'Pesquisar nesta conversa' });
  const list = h('div', { class: 'stack', style: { marginTop: '10px' } });
  const m = modal({ title: 'Pesquisar mensagens', body: h('div', null, h('div', { class: 'search-box' }, icon('search'), input), list) });
  let t;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      clear(list);
      if (!input.value.trim()) return;
      const r = await GET(`/conversations/${cur.id}/search?q=${encodeURIComponent(input.value.trim())}`);
      if (!r.length) return list.appendChild(h('div', { class: 'empty' }, 'Nada encontrado.'));
      for (const x of r) list.appendChild(h('button', { class: 'list-item', onClick: () => { m.close(); jumpTo(x.id); } }, avatar(x.sender || {}, 32),
        h('div', { class: 'meta' }, h('div', { class: 'name' }, x.sender?.displayName || '', h('small', { class: 'faint' }, ' · ' + fmtRelative(x.createdAt))), h('div', { class: 'sub' }, x.content))));
    }, 250);
  });
}
export function openForward(ids) {
  const selected = new Set();
  const list = h('div', { class: 'stack', style: { maxHeight: '50vh', overflow: 'auto' } });
  for (const c of state.convs.filter(x => !x.archived)) {
    const cb = h('input', { type: 'checkbox' });
    cb.addEventListener('change', () => cb.checked ? selected.add(c.id) : selected.delete(c.id));
    list.appendChild(h('label', { class: 'list-item' }, cb, avatar(c.type === 'dm' ? (c.other || c) : c, 34, { square: c.type === 'group' }), h('div', { class: 'meta' }, h('div', { class: 'name' }, c.name), h('div', { class: 'sub' }, c.type === 'dm' ? 'Conversa privada' : 'Grupo'))));
  }
  const btn = h('button', { class: 'btn primary' }, icon('forward', 16), 'Encaminhar');
  const m = modal({ title: `Encaminhar ${ids.length} mensagem(ns)`, body: list, foot: [h('button', { class: 'btn ghost', onClick: () => m.close() }, 'Cancelar'), btn] });
  btn.addEventListener('click', async () => {
    if (!selected.size) return toast('Escolha ao menos uma conversa.', 'error');
    btn.disabled = true;
    try { const r = await POST('/messages/forward', { messageIds: ids, conversationIds: [...selected] }); m.close(); toast(`${r.sent} mensagem(ns) encaminhada(s).`, 'ok'); if (cur) { cur.selection.clear(); renderMessages(false); renderComposer(); } } catch { btn.disabled = false; }
  });
}

// ===================== PAINEL DE DETALHES =====================
function toggleInfo() {
  state.infoOpen = !state.infoOpen;
  if (state.infoOpen) renderInfo(); else layout.setInfo(null);
  cur?.els?.head.querySelector('.icon-btn[title="Detalhes"]')?.classList.toggle('active', state.infoOpen);
}
export function renderInfo() {
  if (!cur || !state.infoOpen) return;
  const d = cur.detail;
  const panel = h('aside', { class: 'info' });
  const close = h('div', { style: { position: 'absolute', top: '8px', right: '8px', zIndex: 2 } }, iconBtn('x', 'Fechar', toggleInfo));
  if (d.type === 'dm') {
    const u = d.other || {};
    panel.append(h('div', { class: 'info-cover', style: u.banner ? { backgroundImage: `url("${u.banner}")` } : null }, close),
      h('div', { class: 'info-head' }, avatar(u, 84, { presence: u.presence }), h('h3', null, u.displayName, ' ', roleMark(u.role)), h('div', { class: 'muted' }, '@' + (u.username || '')),
        u.customStatus ? h('div', { class: 'chip' }, u.customStatus) : null,
        h('div', { class: 'row', style: { marginTop: '8px' } },
          h('button', { class: 'btn sm', onClick: () => social.openProfile(u.id) }, icon('user', 15), 'Perfil'),
          iconBtn('phone', 'Ligar', () => calls.startCall(d.id, 'audio')), iconBtn('video', 'Vídeo', () => calls.startCall(d.id, 'video')))));
  } else if (d.type === 'group') {
    panel.append(h('div', { class: 'info-cover', style: d.banner ? { backgroundImage: `url("${d.banner}")` } : null }, close),
      h('div', { class: 'info-head' }, avatar(d, 84, { square: true }), h('h3', null, d.name),
        h('div', { class: 'muted' }, `Grupo ${d.privacy === 'public' ? 'público' : 'privado'} · ${d.members.filter(m => m.status === 'active').length} participantes`),
        d.description ? h('p', { class: 'muted', style: { whiteSpace: 'pre-wrap', margin: '6px 0 0' } }, d.description) : null));
  } else {
    panel.append(h('div', { class: 'info-head', style: { marginTop: '24px' } }, close, h('div', { class: 'avatar square', style: { width: '70px', height: '70px', background: 'rgba(var(--accent-rgb),.18)', color: 'var(--accent-2)' } }, icon('hash', 34)), h('h3', null, '#' + d.name), h('div', { class: 'muted' }, d.topic || cur.community?.name || '')));
  }
  panel.appendChild(h('div', { class: 'info-sec row' },
    h('button', { class: 'btn sm grow', onClick: openPins }, icon('pin', 15), 'Fixadas'),
    h('button', { class: 'btn sm grow', onClick: openConvSearch }, icon('search', 15), 'Pesquisar')));
  // ações
  if (d.type !== 'channel') {
    const me = d.me || {};
    const actions = h('div', { class: 'info-sec stack' },
      h('div', { class: 'toggle-row' }, h('span', null, 'Silenciar notificações'), switchEl(me.muted, v => setMine(d.id, { muted: v }))),
      h('button', { class: 'btn ghost block', style: { justifyContent: 'flex-start' }, onClick: () => setMine(d.id, { archived: !me.archived }) }, icon('archive', 17), me.archived ? 'Desarquivar' : 'Arquivar conversa'),
      h('button', { class: 'btn ghost block', style: { justifyContent: 'flex-start' }, onClick: () => clearHistory(d.id) }, icon('trash', 17), 'Limpar histórico'));
    if (d.type === 'group') {
      if (d.inviteCode) actions.appendChild(h('button', { class: 'btn ghost block', style: { justifyContent: 'flex-start' }, onClick: () => copy(`${location.origin}/g/${d.inviteCode}`) }, icon('link', 17), 'Copiar link de convite'));
      if (d.perms.canManage || d.me?.canInvite) actions.appendChild(h('button', { class: 'btn ghost block', style: { justifyContent: 'flex-start' }, onClick: () => addMembers(d) }, icon('userplus', 17), 'Adicionar participantes'));
      if (d.perms.canManage) actions.appendChild(h('button', { class: 'btn ghost block', style: { justifyContent: 'flex-start' }, onClick: () => groupSettings(d) }, icon('cog', 17), 'Configurações do grupo'));
      actions.appendChild(h('button', { class: 'btn ghost block', style: { justifyContent: 'flex-start' }, onClick: () => groupHistory(d) }, icon('history', 17), 'Histórico de participantes'));
      actions.appendChild(h('button', { class: 'btn ghost block', style: { justifyContent: 'flex-start', color: 'var(--danger)' }, onClick: () => social.openReport('group', d.id) }, icon('flag', 17), 'Denunciar grupo'));
      actions.appendChild(h('button', { class: 'btn danger block', onClick: async () => { if (await confirmDialog('Você deixará de receber mensagens deste grupo.', { title: 'Sair do grupo', confirmText: 'Sair', danger: true })) { await POST(`/conversations/${d.id}/leave`); await loadConversations(); go('groups'); } } }, icon('logout', 17), 'Sair do grupo'));
    } else {
      const u = d.other || {};
      actions.appendChild(h('button', { class: 'btn ghost block', style: { justifyContent: 'flex-start', color: 'var(--danger)' }, onClick: () => social.toggleBlock(u, true).then(() => openChat(d.id)) }, icon('block', 17), d.blocked ? 'Bloqueio ativo' : 'Bloquear usuário'));
      actions.appendChild(h('button', { class: 'btn ghost block', style: { justifyContent: 'flex-start', color: 'var(--danger)' }, onClick: () => social.openReport('user', u.id) }, icon('flag', 17), 'Denunciar usuário'));
    }
    panel.appendChild(actions);
  }
  // participantes
  if (d.type === 'group') {
    const pending = d.members.filter(m => m.status === 'pending');
    if (pending.length && d.perms.canManage) {
      panel.appendChild(h('div', { class: 'info-sec' }, h('h4', null, `Aguardando aprovação (${pending.length})`),
        pending.map(m => h('div', { class: 'list-item' }, avatar(m, 34), h('div', { class: 'meta' }, h('div', { class: 'name' }, m.displayName)),
          iconBtn('check', 'Aprovar', async () => { await POST(`/conversations/${d.id}/members/${m.id}/approve`); }),
          iconBtn('x', 'Recusar', async () => { await POST(`/conversations/${d.id}/members/${m.id}/reject`); }, 'danger')))));
    }
    const sec = h('div', { class: 'info-sec' }, h('h4', null, `Participantes (${d.members.filter(m => m.status === 'active').length})`));
    for (const m of d.members.filter(x => x.status === 'active')) {
      sec.appendChild(h('div', { class: 'list-item', onClick: e => memberMenu(e, d, m) },
        avatar(m, 36, { presence: m.presence }),
        h('div', { class: 'meta' }, h('div', { class: 'name' }, h('span', null, m.displayName), m.id === state.me.id ? h('small', { class: 'faint' }, '(você)') : null),
          h('div', { class: 'sub' }, m.silencedUntil && new Date(m.silencedUntil) > new Date() ? '🔇 silenciado' : (m.customStatus || '@' + m.username))),
        m.memberRole !== 'member' ? h('span', { class: `chip ${m.memberRole === 'owner' ? 'gold' : ''}` }, ROLE_LABEL[m.memberRole]) : null));
    }
    panel.appendChild(sec);
  }
  // mídia/arquivos/links
  const mediaBody = h('div');
  const loadMedia = async kind => {
    clear(mediaBody).appendChild(h('div', { class: 'spinner' }));
    if (kind === 'links') {
      const links = await GET(`/conversations/${d.id}/links`);
      clear(mediaBody);
      if (!links.length) return mediaBody.appendChild(h('div', { class: 'hint' }, 'Nenhum link compartilhado.'));
      for (const l of links) mediaBody.appendChild(h('a', { class: 'list-item', href: l.url, target: '_blank', rel: 'noopener noreferrer nofollow', style: { color: 'inherit', textDecoration: 'none' } }, icon('link', 18), h('div', { class: 'meta' }, h('div', { class: 'name' }, l.preview?.title || l.url), h('div', { class: 'sub' }, l.url))));
      return;
    }
    const files = await GET(`/conversations/${d.id}/media?kind=${kind}`);
    clear(mediaBody);
    if (!files.length) return mediaBody.appendChild(h('div', { class: 'hint' }, kind === 'media' ? 'Nenhuma foto ou vídeo.' : 'Nenhum arquivo.'));
    if (kind === 'media') mediaBody.appendChild(h('div', { class: 'media-grid' }, files.map(f => h('div', { onClick: () => lightbox(f.url, f.kind, f.name) }, f.kind === 'image' ? h('img', { src: f.url, alt: '', loading: 'lazy' }) : h('video', { src: f.url, muted: true, preload: 'metadata' })))));
    else for (const f of files) mediaBody.appendChild(h('a', { class: 'list-item', href: f.url + '?download=1', style: { color: 'inherit', textDecoration: 'none' } }, icon(f.kind === 'audio' ? 'mic' : 'file', 18), h('div', { class: 'meta' }, h('div', { class: 'name' }, f.name), h('div', { class: 'sub' }, `${fmtSize(f.size)} · ${fmtRelative(f.createdAt)}`))));
  };
  panel.appendChild(h('div', { class: 'info-sec' }, h('h4', null, 'Compartilhados'), tabs([['media', 'Mídia'], ['document', 'Arquivos'], ['audio', 'Áudios'], ['links', 'Links']], 'media', loadMedia), h('div', { style: { marginTop: '10px' } }, mediaBody)));
  loadMedia('media');
  if (d.type === 'dm') social.fillDmInfoExtras(panel, d.other);
  layout.setInfo(panel);
}

function memberMenu(e, d, m) {
  if (m.id === state.me.id) return social.openProfile(m.id);
  const myRole = d.me?.role || 'member';
  const rank = { owner: 3, admin: 2, moderator: 1, member: 0 };
  const can = d.perms.canModerate && rank[m.memberRole] < rank[myRole];
  const setRole = role => PATCH(`/conversations/${d.id}/members/${m.id}`, { role }).then(() => toast('Cargo atualizado.', 'ok'));
  menu(e, [
    { icon: 'user', label: 'Ver perfil', onClick: () => social.openProfile(m.id) },
    { icon: 'chat', label: 'Mensagem privada', onClick: () => startDM(m.id) },
    can && d.perms.canManage ? '-' : null,
    can && d.perms.canManage && myRole === 'owner' && m.memberRole !== 'admin' ? { icon: 'shield', label: 'Tornar administrador', onClick: () => setRole('admin') } : null,
    can && d.perms.canManage && m.memberRole !== 'moderator' ? { icon: 'shield', label: 'Tornar moderador', onClick: () => setRole('moderator') } : null,
    can && d.perms.canManage && m.memberRole !== 'member' ? { icon: 'user', label: 'Tornar membro', onClick: () => setRole('member') } : null,
    can ? { icon: 'key', label: 'Permissões individuais', onClick: () => memberPerms(d, m) } : null,
    can ? { icon: 'mute', label: m.silencedUntil && new Date(m.silencedUntil) > new Date() ? 'Remover silêncio' : 'Silenciar', onClick: () => silence(d, m) } : null,
    can ? { icon: 'logout', label: 'Remover do grupo', danger: true, onClick: async () => { if (await confirmDialog(`Remover ${m.displayName} do grupo?`, { danger: true, confirmText: 'Remover' })) await DEL(`/conversations/${d.id}/members/${m.id}`); } } : null
  ]);
}
async function silence(d, m) {
  if (m.silencedUntil && new Date(m.silencedUntil) > new Date()) return PATCH(`/conversations/${d.id}/members/${m.id}`, { silenceMinutes: 0 });
  const v = await promptDialog('Por quantos minutos?', { title: `Silenciar ${m.displayName}`, value: '60', type: 'number', confirmText: 'Silenciar' });
  if (v) await PATCH(`/conversations/${d.id}/members/${m.id}`, { silenceMinutes: Number(v) });
}
function memberPerms(d, m) {
  const p = { ...m.perms };
  const row = (k, label) => h('div', { class: 'toggle-row' }, h('span', null, label), switchEl(p[k], v => { p[k] = v; }));
  const mm = modal({
    title: `Permissões de ${m.displayName}`,
    body: h('div', null, row('canSend', 'Enviar mensagens'), row('canSendMedia', 'Enviar fotos, vídeos e arquivos'), row('canInvite', 'Adicionar participantes'), row('canPin', 'Fixar mensagens')),
    foot: [h('button', { class: 'btn primary', onClick: async () => { await PATCH(`/conversations/${d.id}/members/${m.id}`, p); mm.close(); toast('Permissões salvas.', 'ok'); } }, 'Salvar')]
  });
}
function addMembers(d) {
  const ids = new Set(d.members.filter(m => m.status === 'active').map(m => m.id));
  const selected = new Set();
  const input = h('input', { class: 'input', placeholder: 'Buscar usuários' });
  const list = h('div', { class: 'stack', style: { maxHeight: '45vh', overflow: 'auto', marginTop: '10px' } });
  const render = users => {
    clear(list);
    for (const u of users.filter(x => !ids.has(x.id))) {
      const cb = h('input', { type: 'checkbox', checked: selected.has(u.id) });
      cb.addEventListener('change', () => cb.checked ? selected.add(u.id) : selected.delete(u.id));
      list.appendChild(h('label', { class: 'list-item' }, cb, avatar(u, 34), h('div', { class: 'meta' }, h('div', { class: 'name' }, u.displayName), h('div', { class: 'sub' }, '@' + u.username))));
    }
  };
  render(state.friends);
  let t; input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(async () => render(input.value ? await GET(`/users/search?q=${encodeURIComponent(input.value)}`) : state.friends), 220); });
  const btn = h('button', { class: 'btn primary' }, 'Adicionar');
  const m = modal({ title: 'Adicionar participantes', body: h('div', null, h('div', { class: 'search-box' }, icon('search'), input), list), foot: [btn] });
  btn.addEventListener('click', async () => {
    if (!selected.size) return;
    const r = await POST(`/conversations/${d.id}/members`, { userIds: [...selected] });
    m.close(); toast(r.pending ? 'Pedido enviado para aprovação dos administradores.' : `${r.added} participante(s) adicionado(s).`, 'ok');
  });
}
function groupSettings(d) {
  const name = h('input', { class: 'input', value: d.name, maxlength: 60 });
  const desc = h('textarea', { class: 'textarea', value: d.description, maxlength: 500 });
  const notice = h('textarea', { class: 'textarea', value: d.notice, maxlength: 500, placeholder: 'Aviso fixo exibido no topo do grupo' });
  const privacy = h('select', { class: 'select' }, h('option', { value: 'private' }, 'Privado'), h('option', { value: 'public' }, 'Público'));
  privacy.value = d.privacy;
  const s = { joinApproval: d.joinApproval, onlyAdminsSend: d.onlyAdminsSend };
  const upl = kind => h('button', { class: 'btn sm', onClick: async () => { const [f] = await pickFiles({ accept: 'image/*' }); if (!f) return; const fd = new FormData(); fd.append('file', f); await api('POST', `/conversations/${d.id}/${kind}`, undefined, { form: fd }); toast('Imagem atualizada!', 'ok'); } }, icon('image', 15), kind === 'avatar' ? 'Alterar foto' : 'Alterar banner');
  const m = modal({
    title: 'Configurações do grupo', size: 'wide',
    body: h('div', null,
      h('div', { class: 'row', style: { marginBottom: '14px' } }, avatar(d, 64, { square: true }), upl('avatar'), upl('banner')),
      field('Nome', name), field('Descrição', desc), field('Aviso do grupo', notice, 'Ao salvar um novo aviso, ele também é publicado no chat.'), field('Privacidade', privacy),
      h('div', { class: 'toggle-row' }, h('div', null, h('b', null, 'Aprovar novos participantes'), h('div', { class: 'hint' }, 'Entradas por link e convites de membros precisam de aprovação.')), switchEl(s.joinApproval, v => { s.joinApproval = v; })),
      h('div', { class: 'toggle-row' }, h('div', null, h('b', null, 'Somente administradores enviam mensagens'), h('div', { class: 'hint' }, 'Transforma o grupo em um canal de avisos.')), switchEl(s.onlyAdminsSend, v => { s.onlyAdminsSend = v; })),
      h('div', { class: 'toggle-row' }, h('div', null, h('b', null, 'Link de convite'), h('div', { class: 'hint' }, d.inviteCode ? `${location.origin}/g/${d.inviteCode}` : '')),
        h('button', { class: 'btn sm', onClick: async () => { const r = await POST(`/conversations/${d.id}/invite-link`); d.inviteCode = r.inviteCode; copy(`${location.origin}/g/${r.inviteCode}`); } }, 'Gerar novo'))),
    foot: [h('button', { class: 'btn ghost', onClick: () => m.close() }, 'Cancelar'), h('button', { class: 'btn primary', onClick: async () => {
      await PATCH(`/conversations/${d.id}`, { name: name.value, description: desc.value, privacy: privacy.value, ...s, ...(notice.value !== d.notice ? { notice: notice.value } : {}) });
      m.close(); toast('Grupo atualizado!', 'ok');
    } }, 'Salvar')]
  });
}
async function groupHistory(d) {
  const list = h('div', { class: 'stack' }, h('div', { class: 'spinner' }));
  modal({ title: 'Histórico de participantes', body: list });
  const rows = await GET(`/conversations/${d.id}/history`);
  clear(list);
  const label = { created: 'criou o grupo', added: 'foi adicionado', removed: 'foi removido', left: 'saiu', joined_link: 'entrou pelo link', requested: 'pediu para entrar', approved: 'foi aprovado', rejected: 'teve a entrada recusada' };
  for (const r of rows) list.appendChild(h('div', { class: 'list-item' }, icon('history', 18), h('div', { class: 'meta' },
    h('div', { style: { whiteSpace: 'normal' } }, h('b', null, r.user_name), ' ', r.action.startsWith('role:') ? `agora é ${ROLE_LABEL[r.action.slice(5)]}` : (label[r.action] || r.action), r.actor_name && r.actor_name !== r.user_name ? ` por ${r.actor_name}` : ''),
    h('div', { class: 'sub' }, fmtRelative(r.created_at)))));
}

export const current = () => cur;
