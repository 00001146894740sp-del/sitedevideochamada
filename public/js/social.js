import {
  state, on, api, GET, POST, PATCH, DEL, h, clear, icon, iconBtn, toast, modal, menu, confirmDialog,
  avatar, roleMark, richText, playEffect, fmtRelative, fmtDate, field, tabs, pickFiles, PRESENCE_LABEL, ROLE_LABEL, EMOJI,
  achievementEl
} from './core.js';
import { layout, go, renderRail } from './app.js';
import * as chat from './chat.js';

let requests = { incoming: [], outgoing: [] };
let friendsTab = 'online';

export async function loadFriends() {
  const [f, r] = await Promise.all([GET('/friends', { silent: true }).catch(() => state.friends), GET('/friends/requests', { silent: true }).catch(() => requests)]);
  state.friends = f; requests = r;
  if (state.view.section === 'friends' && layout.side) { renderFriendsSide(); if (!state.view.convId) renderFriendsPage(friendsTab); }
}
export const pendingCount = () => requests.incoming.length;

on('presence', p => {
  const f = state.friends.find(x => x.id === p.userId);
  if (f) { f.presence = p.presence; if (state.view.section === 'friends') renderFriendsSide(); }
});
on('user:update', u => { const f = state.friends.find(x => x.id === u.id); if (f) Object.assign(f, u); });

// ===================== AMIGOS =====================
export function renderFriendsSide() {
  const q = h('input', { class: 'input', placeholder: 'Buscar amigos' });
  const list = h('div', { class: 'side-body' });
  const fill = () => {
    clear(list);
    const s = q.value.toLowerCase();
    const items = state.friends.filter(f => !s || f.displayName.toLowerCase().includes(s) || f.username.toLowerCase().includes(s));
    const fav = items.filter(f => f.favorite);
    const online = items.filter(f => !f.favorite && f.presence !== 'offline');
    const offline = items.filter(f => !f.favorite && f.presence === 'offline');
    const sec = (title, arr) => { if (!arr.length) return; list.appendChild(h('div', { class: 'section-label' }, `${title} — ${arr.length}`)); arr.forEach(f => list.appendChild(friendItem(f))); };
    sec('⭐ Favoritos', fav); sec('Online', online); sec('Offline', offline);
    if (!items.length) list.appendChild(h('div', { class: 'empty' }, h('span', { class: 'spark' }, '✦'), 'Nenhum amigo ainda. Adicione pelo nome de usuário!'));
  };
  q.addEventListener('input', fill);
  layout.setSide(h('div', { style: { display: 'contents' } },
    h('div', { class: 'side-head' },
      h('div', { class: 'row between' }, h('h2', { class: 'side-title' }, h('span', { class: 'spark' }, '✦'), 'Amigos'),
        h('button', { class: 'btn primary sm', onClick: () => { state.view.convId = null; renderFriendsPage('add'); } }, icon('userplus', 16), 'Adicionar')),
      h('div', { class: 'search-box' }, icon('search'), q)),
    list));
  fill();
}
function friendItem(f) {
  return h('div', { class: 'list-item', onClick: () => chat.startDM(f.id), onContextmenu: e => { e.preventDefault(); friendMenu(e, f); } },
    avatar(f, 40, { presence: f.presence }),
    h('div', { class: 'meta' }, h('div', { class: 'name' }, h('span', null, f.displayName), roleMark(f)), h('div', { class: 'sub' }, f.customStatus || PRESENCE_LABEL[f.presence])),
    iconBtn('more', 'Opções', e => { e.stopPropagation(); friendMenu(e, f); }));
}
function friendMenu(e, f) {
  menu(e, [
    { icon: 'chat', label: 'Enviar mensagem', onClick: () => chat.startDM(f.id) },
    { icon: 'user', label: 'Ver perfil', onClick: () => openProfile(f.id) },
    { icon: 'star', label: f.favorite ? 'Remover dos favoritos' : 'Amigo favorito', onClick: async () => { await PATCH(`/friends/${f.id}`, { favorite: !f.favorite }); await loadFriends(); } },
    '-',
    { icon: 'x', label: 'Desfazer amizade', danger: true, onClick: async () => { if (await confirmDialog(`Remover ${f.displayName} dos amigos?`, { danger: true, confirmText: 'Remover' })) { await DEL(`/friends/${f.id}`); await loadFriends(); } } },
    { icon: 'block', label: 'Bloquear', danger: true, onClick: () => toggleBlock(f, true) }
  ]);
}

export function renderFriendsPage(tab = friendsTab) {
  friendsTab = tab;
  state.view.convId = null;
  const body = h('div', { style: { padding: '20px', overflow: 'auto', flex: 1 } });
  const head = h('header', { class: 'chat-head' }, iconBtn('back', 'Voltar', () => layout.back(), 'back'), icon('users'), h('b', null, 'Amigos'),
    h('div', { class: 'grow', style: { maxWidth: '640px' } }, tabs([['online', 'Online'], ['all', 'Todos'], ['pending', `Pendentes${requests.incoming.length ? ` (${requests.incoming.length})` : ''}`], ['suggest', 'Sugestões'], ['blocked', 'Bloqueados'], ['add', '+ Adicionar']], tab, t => renderFriendsPage(t))));
  layout.setMain(h('section', { class: 'main chat-bg-aurora', style: { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 } }, head, body), { inChat: window.innerWidth <= 860 && tab !== 'online' });
  const row = (u, ...actions) => h('div', { class: 'list-item', style: { borderBottom: '1px solid var(--line)', borderRadius: 0 } },
    h('div', { style: { cursor: 'pointer' }, onClick: () => openProfile(u.id) }, avatar(u, 42, { presence: u.presence })),
    h('div', { class: 'meta' }, h('div', { class: 'name' }, h('span', null, u.displayName), roleMark(u)), h('div', { class: 'sub' }, '@' + u.username + (u.customStatus ? ` · ${u.customStatus}` : ''))), ...actions);
  if (tab === 'online' || tab === 'all') {
    const list = tab === 'online' ? state.friends.filter(f => f.presence !== 'offline') : state.friends;
    body.appendChild(h('div', { class: 'section-label' }, `${tab === 'online' ? 'Online' : 'Todos os amigos'} — ${list.length}`));
    if (!list.length) body.appendChild(h('div', { class: 'empty' }, h('span', { class: 'spark' }, '✦'), tab === 'online' ? 'Nenhum amigo online agora.' : 'Você ainda não tem amigos. Que tal adicionar alguém?'));
    for (const f of list) body.appendChild(row(f, iconBtn('chat', 'Mensagem', () => chat.startDM(f.id)), iconBtn('more', 'Opções', e => friendMenu(e, f))));
  } else if (tab === 'pending') {
    body.appendChild(h('div', { class: 'section-label' }, `Recebidas — ${requests.incoming.length}`));
    for (const r of requests.incoming) body.appendChild(row(r.user,
      h('small', { class: 'faint' }, fmtRelative(r.createdAt)),
      iconBtn('check', 'Aceitar', async () => { await POST(`/friends/requests/${r.requestId}/accept`); toast('Agora vocês são amigos! 🤝', 'ok'); await loadFriends(); renderRail(); renderFriendsPage('pending'); }),
      iconBtn('x', 'Recusar', async () => { await POST(`/friends/requests/${r.requestId}/decline`); await loadFriends(); renderRail(); renderFriendsPage('pending'); }, 'danger')));
    body.appendChild(h('div', { class: 'section-label' }, `Enviadas — ${requests.outgoing.length}`));
    for (const r of requests.outgoing) body.appendChild(row(r.user, h('small', { class: 'faint' }, 'aguardando'),
      iconBtn('x', 'Cancelar', async () => { await DEL(`/friends/requests/${r.requestId}`); await loadFriends(); renderFriendsPage('pending'); }, 'danger')));
    if (!requests.incoming.length && !requests.outgoing.length) body.appendChild(h('div', { class: 'empty' }, 'Nenhuma solicitação pendente.'));
  } else if (tab === 'suggest') {
    body.appendChild(h('div', { class: 'spinner' }));
    GET('/friends/suggestions').then(list => {
      clear(body).appendChild(h('div', { class: 'section-label' }, 'Pessoas que você talvez conheça'));
      if (!list.length) body.appendChild(h('div', { class: 'empty' }, 'Sem sugestões por enquanto. Entre em comunidades para conhecer gente nova!'));
      for (const u of list) body.appendChild(row(u, h('button', { class: 'btn sm primary', onClick: async e => { e.target.disabled = true; await sendRequest({ userId: u.id }); } }, icon('userplus', 15), 'Adicionar')));
    });
  } else if (tab === 'blocked') {
    body.appendChild(h('div', { class: 'spinner' }));
    GET('/blocks').then(list => {
      clear(body).appendChild(h('div', { class: 'section-label' }, `Bloqueados — ${list.length}`));
      if (!list.length) body.appendChild(h('div', { class: 'empty' }, 'Você não bloqueou ninguém.'));
      for (const u of list) body.appendChild(row(u, h('button', { class: 'btn sm', onClick: async () => { await DEL(`/blocks/${u.id}`); toast('Desbloqueado.', 'ok'); renderFriendsPage('blocked'); } }, 'Desbloquear')));
    });
  } else if (tab === 'add') {
    const input = h('input', { class: 'input', placeholder: 'Digite o nome de usuário, ex.: gamer_123' });
    const results = h('div', { class: 'stack', style: { marginTop: '14px' } });
    body.append(h('h2', { style: { fontFamily: 'var(--display)', margin: '0 0 6px' } }, 'Adicionar amigo'), h('p', { class: 'muted' }, 'Você pode adicionar amigos pelo nome de usuário ou pesquisar pelo nome.'),
      h('form', { class: 'row', onSubmit: async e => { e.preventDefault(); if (input.value.trim()) { await sendRequest({ username: input.value.trim().replace(/^@/, '') }); input.value = ''; } } },
        h('div', { class: 'search-box grow' }, icon('search'), input), h('button', { class: 'btn primary', type: 'submit' }, 'Enviar solicitação')), results);
    let t;
    input.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        clear(results);
        if (input.value.trim().length < 2) return;
        const list = await GET(`/users/search?q=${encodeURIComponent(input.value.trim().replace(/^@/, ''))}`);
        for (const u of list) {
          const isFriend = state.friends.some(f => f.id === u.id);
          results.appendChild(row(u, isFriend ? h('span', { class: 'chip green' }, 'Amigo') : h('button', { class: 'btn sm primary', onClick: async e => { e.target.disabled = true; await sendRequest({ userId: u.id }); } }, icon('userplus', 15), 'Adicionar'), iconBtn('chat', 'Mensagem', () => chat.startDM(u.id))));
        }
      }, 250);
    });
    setTimeout(() => input.focus(), 50);
  }
}
async function sendRequest(body) {
  try {
    const r = await POST('/friends/requests', body);
    toast(r.accepted ? 'Vocês agora são amigos! 🤝' : 'Solicitação enviada!', 'ok');
    await loadFriends();
  } catch { /* toast já exibido */ }
}

export async function toggleBlock(u, block) {
  if (block) {
    if (!await confirmDialog(`${u.displayName} não poderá mais enviar mensagens, ligar ou ver seus stories. A amizade será desfeita.`, { title: 'Bloquear usuário', confirmText: 'Bloquear', danger: true })) return;
    await POST(`/blocks/${u.id}`); toast('Usuário bloqueado.', 'ok');
  } else { await DEL(`/blocks/${u.id}`); toast('Usuário desbloqueado.', 'ok'); }
  await loadFriends();
}

// ===================== PERFIL =====================
export async function openProfileByUsername(username) {
  const r = await GET(`/users/search?q=${encodeURIComponent(username)}`, { silent: true }).catch(() => []);
  const u = r.find(x => x.username.toLowerCase() === username.toLowerCase());
  if (u) openProfile(u.id); else if (username.toLowerCase() === state.me.username.toLowerCase()) openProfile(state.me.id); else toast('Usuário não encontrado.', 'error');
}
export async function openProfile(id) {
  let p;
  try { p = await GET(`/users/${id}`); } catch { return; }
  const isMe = id === state.me.id;
  const rel = p.relation || {};
  const actions = h('div', { class: 'row wrap', style: { justifyContent: 'center' } });
  if (isMe) actions.appendChild(h('button', { class: 'btn primary', onClick: async () => { m.close(); (await import('./settings.js')).openSettings('profile'); } }, icon('edit', 16), 'Editar perfil'));
  else {
    actions.appendChild(h('button', { class: 'btn primary', onClick: () => { m.close(); chat.startDM(id); } }, icon('chat', 16), 'Mensagem'));
    if (rel.friend) actions.appendChild(h('span', { class: 'chip green' }, '✓ Amigos'));
    else if (rel.outgoingRequestId) actions.appendChild(h('span', { class: 'chip' }, 'Solicitação enviada'));
    else if (rel.incomingRequestId) actions.appendChild(h('button', { class: 'btn gold', onClick: async () => { await POST(`/friends/requests/${rel.incomingRequestId}/accept`); m.close(); toast('Agora vocês são amigos!', 'ok'); loadFriends(); } }, 'Aceitar amizade'));
    else if (!rel.blocked) actions.appendChild(h('button', { class: 'btn', onClick: async e => { e.target.disabled = true; await sendRequest({ userId: id }); } }, icon('userplus', 16), 'Adicionar'));
    actions.appendChild(iconBtn('more', 'Mais', e => menu(e, [
      rel.friend ? { icon: 'x', label: 'Desfazer amizade', onClick: async () => { await DEL(`/friends/${id}`); m.close(); loadFriends(); } } : null,
      { icon: 'block', label: rel.blocked ? 'Desbloquear' : 'Bloquear', danger: !rel.blocked, onClick: async () => { await toggleBlock(p, !rel.blocked); m.close(); } },
      { icon: 'flag', label: 'Denunciar', danger: true, onClick: () => openReport('user', id) },
      { icon: 'copy', label: 'Copiar nome de usuário', onClick: () => navigator.clipboard.writeText('@' + p.username) }
    ])));
  }
  const body = h('div', null,
    h('div', { class: 'profile-preview' },
      h('div', { class: 'cover', style: p.banner ? { backgroundImage: `url("${p.banner}")` } : { background: `linear-gradient(135deg, ${p.color}, #2b0b5c 60%, var(--gold))` } }),
      h('div', { style: { padding: '0 20px 18px', marginTop: '-46px', textAlign: 'center', display: 'grid', justifyItems: 'center', gap: '4px' } },
        h('div', { style: { border: '5px solid var(--panel)', borderRadius: '50%' } }, avatar(p, 92, { presence: p.presence })),
        h('h2', { style: { fontFamily: 'var(--display)', margin: '6px 0 0', display: 'flex', gap: '8px', alignItems: 'center' } }, p.displayName, roleMark(p)),
        h('div', { class: 'muted' }, '@' + p.username),
        p.customStatus ? h('div', { class: 'chip', style: { marginTop: '4px' } }, p.customStatus) : null,
        h('div', { class: 'faint', style: { fontSize: '.85em' } }, `${PRESENCE_LABEL[p.presence]} · Membro desde ${new Date(p.createdAt).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}`),
        h('div', { style: { marginTop: '10px' } }, actions))),
    p.limited ? h('div', { class: 'card', style: { marginTop: '14px', textAlign: 'center' } }, icon('lock', 18), ' Perfil visível apenas para amigos.') : null,
    p.bio ? h('div', { class: 'card', style: { marginTop: '14px' } }, h('div', { class: 'label' }, 'Sobre'), h('p', { style: { whiteSpace: 'pre-wrap', margin: '6px 0 0' } }, richText(p.bio))) : null,
    p.badges?.length ? h('div', { class: 'card' }, h('div', { class: 'label', style: { marginBottom: '8px' } }, 'Conquistas e insígnias'),
      h('div', { class: 'badges', style: { justifyContent: 'flex-start' } }, p.badges.map(b => achievementEl(b)))) : null,
    p.links?.length ? h('div', { class: 'card' }, h('div', { class: 'label', style: { marginBottom: '8px' } }, 'Links'),
      h('div', { class: 'row wrap' }, p.links.map(l => h('a', { class: 'chip', href: l.url, target: '_blank', rel: 'noopener noreferrer nofollow' }, icon('link', 13), l.label)))) : null,
    p.mutualFriends?.length ? h('div', { class: 'card' }, h('div', { class: 'label', style: { marginBottom: '8px' } }, `Amigos em comum (${p.mutualFriends.length})`),
      h('div', { class: 'row wrap' }, p.mutualFriends.map(f => h('button', { class: 'chip', onClick: () => { m.close(); openProfile(f.id); } }, f.displayName)))) : null,
    p.mutualCommunities?.length ? h('div', { class: 'card' }, h('div', { class: 'label', style: { marginBottom: '8px' } }, 'Comunidades em comum'),
      h('div', { class: 'row wrap' }, p.mutualCommunities.map(c => h('button', { class: 'chip', onClick: () => { m.close(); go('community', { communityId: c.id }); } }, c.name)))) : null);
  const storiesBox = h('div');
  const activityBox = h('div');
  body.append(storiesBox, activityBox);
  const m = modal({ title: null, body, size: '' });
  m.el.querySelector('.modal-body').style.padding = '0 0 16px';
  m.el.style.position = 'relative';
  if (p.effect) setTimeout(() => playEffect(m.el, p.effect), 250);
  m.el.querySelector('.profile-preview').style.borderRadius = '0';
  m.el.querySelectorAll('.card').forEach(c => { c.style.margin = '12px 16px 0'; });
  // stories ativos
  GET(`/stories/user/${id}`, { silent: true }).then(list => {
    if (!list.length) return;
    storiesBox.appendChild(h('div', { class: 'card', style: { margin: '12px 16px 0' } }, h('div', { class: 'row between' }, h('span', { class: 'label' }, `Stories ativos (${list.length})`),
      h('button', { class: 'btn sm primary', onClick: () => { m.close(); openStoryViewer([{ user: p, stories: list }], 0); } }, 'Ver stories'))));
  }).catch(() => {});
  if (p.activityVisible || isMe) {
    GET(`/users/${id}/activity`, { silent: true }).then(list => {
      if (!list.length) return;
      const label = { profile_updated: 'atualizou o perfil', friend_added: 'fez uma nova amizade', group_created: 'criou um grupo', community_created: 'criou uma comunidade', story_posted: 'publicou um story' };
      activityBox.appendChild(h('div', { class: 'card', style: { margin: '12px 16px 0' } }, h('div', { class: 'label', style: { marginBottom: '8px' } }, 'Atividade recente'),
        list.slice(0, 8).map(a => h('div', { class: 'row', style: { padding: '4px 0', fontSize: '.9em' } }, h('span', { class: 'gold' }, '✦'), h('span', { class: 'grow' }, label[a.type] || a.type, a.data?.name ? ` “${a.data.name}”` : ''), h('small', { class: 'faint' }, fmtRelative(a.created_at))))));
    }).catch(() => {});
  }
}

export async function fillDmInfoExtras(panel, other) {
  if (!other?.id) return;
  const p = await GET(`/users/${other.id}`, { silent: true }).catch(() => null);
  if (!p) return;
  const sec = h('div', { class: 'info-sec' });
  if (p.bio) sec.append(h('h4', null, 'Sobre'), h('p', { style: { whiteSpace: 'pre-wrap', margin: '0 0 10px' } }, richText(p.bio)));
  if (p.badges?.length) sec.append(h('h4', null, 'Insígnias'), h('div', { class: 'badges', style: { justifyContent: 'flex-start' } }, p.badges.map(b => achievementEl(b))));
  if (p.mutualFriends?.length) sec.append(h('h4', { style: { marginTop: '12px' } }, `Amigos em comum · ${p.mutualFriends.length}`), h('div', { class: 'row wrap' }, p.mutualFriends.slice(0, 8).map(f => avatar(f, 30))));
  sec.append(h('h4', { style: { marginTop: '12px' } }, 'Membro desde'), h('div', { class: 'muted' }, new Date(p.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })));
  panel.insertBefore(sec, panel.children[2] || null);
}

// ===================== DENÚNCIAS =====================
export function openReport(targetType, targetId) {
  const reasons = [['spam', 'Spam ou propaganda'], ['assedio', 'Assédio ou bullying'], ['odio', 'Discurso de ódio'], ['violencia', 'Violência ou ameaça'], ['conteudo_sexual', 'Conteúdo sexual impróprio'], ['golpe', 'Golpe ou fraude'], ['falsidade', 'Perfil falso / falsidade ideológica'], ['outro', 'Outro motivo']];
  const sel = h('select', { class: 'select' }, reasons.map(([v, l]) => h('option', { value: v }, l)));
  const det = h('textarea', { class: 'textarea', placeholder: 'Conte o que aconteceu (opcional)', maxlength: 1000 });
  const btn = h('button', { class: 'btn danger' }, icon('flag', 16), 'Enviar denúncia');
  const m = modal({
    title: 'Denunciar', body: h('div', null, h('p', { class: 'muted' }, 'Denúncias são anônimas para a pessoa denunciada e analisadas pela equipe de moderação.'), field('Motivo', sel), field('Detalhes', det)),
    foot: [h('button', { class: 'btn ghost', onClick: () => m.close() }, 'Cancelar'), btn]
  });
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try { const r = await POST('/reports', { targetType, targetId, reason: sel.value, details: det.value }); m.close(); toast(r.message, 'ok'); } catch { btn.disabled = false; }
  });
}

// ===================== GRUPOS (convites / públicos) =====================
export async function openGroupInvite(code) {
  let g;
  try { g = await GET(`/invites/group/${encodeURIComponent(code)}`); } catch { return; }
  const m = modal({
    title: 'Convite para grupo',
    body: h('div', { style: { textAlign: 'center', display: 'grid', justifyItems: 'center', gap: '8px' } }, avatar(g, 80, { square: true }), h('h2', { style: { fontFamily: 'var(--display)', margin: 0 } }, g.name), h('p', { class: 'muted', style: { margin: 0 } }, g.description || ''), h('span', { class: 'chip' }, `${g.memberCount} participantes`), g.joinApproval ? h('small', { class: 'hint' }, 'A entrada precisa ser aprovada por um administrador.') : null),
    foot: g.myStatus === 'active' ? [h('button', { class: 'btn primary', onClick: () => { m.close(); chat.openChat(g.id); } }, 'Abrir grupo')]
      : [h('button', { class: 'btn ghost', onClick: () => m.close() }, 'Agora não'), h('button', { class: 'btn primary', onClick: async () => {
        const r = await POST(`/invites/group/${encodeURIComponent(code)}/join`);
        m.close();
        if (r.status === 'pending') return toast('Pedido enviado! Aguarde a aprovação.', 'ok');
        await chat.loadConversations(); go('groups'); chat.openChat(r.conversationId);
      } }, g.joinApproval ? 'Pedir para entrar' : 'Entrar no grupo')]
  });
}
export async function joinPublicGroup(id) {
  const r = await POST(`/groups/${id}/join`);
  if (r.status === 'pending') return toast('Pedido enviado! Aguarde a aprovação.', 'ok');
  await chat.loadConversations(); go('groups'); chat.openChat(r.conversationId);
}
export async function openPublicGroups() {
  const input = h('input', { class: 'input', placeholder: 'Buscar grupos públicos' });
  const list = h('div', { class: 'stack', style: { marginTop: '10px' } });
  modal({ title: 'Grupos públicos', body: h('div', null, h('div', { class: 'search-box' }, icon('search'), input), list) });
  const load = async () => {
    const rows = await GET(`/groups/public?q=${encodeURIComponent(input.value)}`);
    clear(list);
    if (!rows.length) list.appendChild(h('div', { class: 'empty' }, 'Nenhum grupo público encontrado.'));
    for (const g of rows) {
      const joined = state.convs.some(c => c.id === g.id);
      list.appendChild(h('div', { class: 'list-item' }, avatar(g, 42, { square: true }), h('div', { class: 'meta' }, h('div', { class: 'name' }, g.name), h('div', { class: 'sub' }, `${g.memberCount} participantes · ${g.description || ''}`)),
        joined ? h('span', { class: 'chip green' }, 'Participando') : h('button', { class: 'btn sm primary', onClick: () => joinPublicGroup(g.id) }, g.joinApproval ? 'Pedir' : 'Entrar')));
    }
  };
  let t; input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 250); });
  load();
}

// ===================== STORIES =====================
let feed = [];
export function storiesStrip() {
  const strip = h('div', { class: 'stories-strip' });
  const render = () => {
    clear(strip);
    const mine = feed.find(g => g.user.id === state.me.id);
    strip.appendChild(h('button', { class: 'story-bubble', onClick: () => mine ? openStoryViewer(feed, feed.indexOf(mine)) : openStoryComposer() },
      h('div', { style: { position: 'relative' } }, h('div', { class: `ring ${mine ? '' : 'seen'}` }, avatar(state.me, 52)), h('span', { class: 'story-add', onClick: e => { e.stopPropagation(); openStoryComposer(); } }, '+')),
      h('small', null, 'Seu story')));
    feed.filter(g => g.user.id !== state.me.id).forEach(g => {
      strip.appendChild(h('button', { class: 'story-bubble', onClick: () => openStoryViewer(feed, feed.indexOf(g)) },
        h('div', { class: `ring ${g.allSeen ? 'seen' : ''}` }, avatar(g.user, 52)), h('small', null, g.user.displayName.split(' ')[0])));
    });
  };
  render();
  GET('/stories/feed', { silent: true }).then(f => { feed = f; render(); }).catch(() => {});
  const off = on('stories:changed', () => { if (!strip.isConnected) return off(); GET('/stories/feed', { silent: true }).then(f => { feed = f; render(); }); });
  return strip;
}

export function openStoryComposer() {
  let type = 'text'; let file = null;
  const text = h('textarea', { class: 'textarea', placeholder: 'Escreva algo…', maxlength: 700 });
  const colors = ['#3b0a78', '#9d4dff', '#ff4dd8', '#1d4ed8', '#047857', '#b45309', '#111827'];
  let bg = colors[0];
  const preview = h('div', { class: 'story-frame', style: { height: '320px', width: '100%', maxWidth: '220px', margin: '0 auto 14px' } });
  const drawPreview = () => {
    clear(preview);
    if (type === 'text') preview.appendChild(h('div', { class: 'story-text', style: { background: bg, fontSize: '16px' } }, text.value || 'Seu texto aqui'));
    else if (file) preview.appendChild(type === 'image' ? h('img', { src: URL.createObjectURL(file), alt: '' }) : h('video', { src: URL.createObjectURL(file), muted: true, autoplay: true, loop: true }));
    else preview.appendChild(h('div', { class: 'upload-zone', onClick: choose }, icon('image', 30), h('div', null, 'Escolher foto ou vídeo')));
  };
  const choose = async () => {
    const [f] = await pickFiles({ accept: 'image/*,video/*' });
    if (!f) return;
    file = f; type = f.type.startsWith('video/') ? 'video' : 'image'; const nt = tb2(); tb.replaceWith(nt); tb = nt; drawPreview();
  };
  text.addEventListener('input', drawPreview);
  const dots = h('div', { class: 'color-dots' }, colors.map(c => h('button', { class: `color-dot ${c === bg ? 'on' : ''}`, style: { background: c }, onClick: e => { bg = c; dots.querySelectorAll('.color-dot').forEach(d => d.classList.remove('on')); e.target.classList.add('on'); drawPreview(); } })));
  const privacy = h('select', { class: 'select' }, h('option', { value: 'friends' }, 'Amigos'), h('option', { value: 'close' }, 'Amigos favoritos'), h('option', { value: 'public' }, 'Público (qualquer pessoa com acesso ao seu perfil)'));
  const duration = h('select', { class: 'select' }, [6, 12, 24, 48].map(n => h('option', { value: n, selected: n === 24 }, `${n} horas`)));
  const tb2 = () => tabs([['text', '✍️ Texto'], ['media', '📷 Foto/Vídeo']], type === 'text' ? 'text' : 'media', k => { if (k === 'text') { type = 'text'; file = null; } else { type = 'image'; if (!file) choose(); } drawPreview(); });
  let tb = tb2();
  const btn = h('button', { class: 'btn primary' }, icon('send', 16), 'Publicar');
  const m = modal({
    title: 'Novo story',
    body: h('div', null, tb, h('div', { style: { height: '12px' } }), preview, field('Texto / legenda', text), h('div', { class: 'label', style: { marginBottom: '6px' } }, 'Cor de fundo'), dots, h('div', { style: { height: '12px' } }),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, field('Quem pode ver', privacy)), h('div', { class: 'grow' }, field('Duração', duration)))),
    foot: [h('button', { class: 'btn ghost', onClick: () => m.close() }, 'Cancelar'), btn]
  });
  drawPreview();
  btn.addEventListener('click', async () => {
    const fd = new FormData();
    fd.append('type', file ? type : 'text'); fd.append('text', text.value); fd.append('bg', bg); fd.append('privacy', privacy.value); fd.append('durationHours', duration.value);
    if (file) fd.append('file', file);
    btn.disabled = true;
    try { await api('POST', '/stories', undefined, { form: fd }); m.close(); toast('Story publicado! ✨', 'gold'); } catch { btn.disabled = false; }
  });
}

export function openStoryViewer(groups, gi = 0, si = null) {
  if (!groups[gi]) return;
  let g = groups[gi];
  let idx = si ?? Math.max(0, g.stories.findIndex(s => !s.seen));
  let timer; let start; let paused = false; let elapsed = 0;
  const frame = h('div', { class: 'story-frame' });
  const root = h('div', { class: 'story-viewer' }, frame, iconBtn('x', 'Fechar', close, 'close-x'));
  document.body.appendChild(root);
  const esc = e => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') next(); if (e.key === 'ArrowLeft') prev(); };
  document.addEventListener('keydown', esc);
  function close() { clearInterval(timer); root.remove(); document.removeEventListener('keydown', esc); GET('/stories/feed', { silent: true }).then(f => { feed = f; }); }
  function next() { if (idx < g.stories.length - 1) { idx++; show(); } else if (gi < groups.length - 1) { gi++; g = groups[gi]; idx = 0; show(); } else close(); }
  function prev() { if (idx > 0) { idx--; show(); } else if (gi > 0) { gi--; g = groups[gi]; idx = g.stories.length - 1; show(); } }
  function show() {
    clearInterval(timer); clear(frame); elapsed = 0; paused = false;
    const s = g.stories[idx];
    const mine = g.user.id === state.me.id;
    if (!mine) POST(`/stories/${s.id}/view`, {}, { silent: true }).catch(() => {});
    s.seen = true;
    const bars = h('div', { class: 'story-progress' }, g.stories.map((x, i) => h('span', null, h('i', { style: { width: i < idx ? '100%' : '0' } }))));
    const cur = bars.children[idx].firstChild;
    let content; let duration = 6000;
    if (s.type === 'text') content = h('div', { class: 'story-text', style: { background: s.bg } }, s.text);
    else if (s.type === 'image') content = h('img', { src: s.url, alt: '' });
    else { content = h('video', { src: s.url, autoplay: true, playsinline: true }); content.addEventListener('loadedmetadata', () => { duration = Math.min(content.duration * 1000, 60000) || 15000; }); }
    frame.append(content,
      h('div', { class: 'story-top' }, bars, h('div', { class: 'row' }, avatar(g.user, 34), h('b', { style: { color: '#fff' } }, g.user.displayName), h('small', { style: { color: 'rgba(255,255,255,.7)' } }, fmtRelative(s.createdAt)),
        h('span', { class: 'grow' }),
        mine ? iconBtn('eye', 'Visualizações', () => { paused = true; showViewers(s); }) : null,
        mine ? iconBtn('trash', 'Excluir', async () => { paused = true; if (await confirmDialog('Excluir este story?', { danger: true, confirmText: 'Excluir' })) { await DEL(`/stories/${s.id}`); g.stories.splice(idx, 1); if (!g.stories.length) close(); else { idx = Math.min(idx, g.stories.length - 1); show(); } } else paused = false; }) : null,
        !mine ? iconBtn('flag', 'Denunciar', () => { paused = true; openReport('story', s.id); }) : null)),
      s.type !== 'text' && s.text ? h('div', { class: 'story-caption' }, s.text) : null,
      h('div', { class: 'story-nav l', onClick: prev }), h('div', { class: 'story-nav r', onClick: next }));
    if (!mine) {
      const reply = h('input', { class: 'input', placeholder: `Responder a ${g.user.displayName.split(' ')[0]}…` });
      reply.addEventListener('focus', () => { paused = true; });
      reply.addEventListener('blur', () => { paused = false; });
      const sendReply = async () => { if (!reply.value.trim()) return; await POST(`/stories/${s.id}/reply`, { text: reply.value.trim() }); reply.value = ''; toast('Resposta enviada na conversa privada.', 'ok'); paused = false; };
      reply.addEventListener('keydown', e => e.key === 'Enter' && sendReply());
      frame.appendChild(h('div', { class: 'story-bottom' }, reply,
        ['😍', '😂', '🔥', '😮'].map(em => h('button', { class: 'icon-btn', style: { fontSize: '20px' }, onClick: async () => { await POST(`/stories/${s.id}/react`, { emoji: em }); toast(`Você reagiu ${em}`, 'ok'); } }, em)),
        iconBtn('send', 'Enviar', sendReply)));
    }
    start = Date.now();
    timer = setInterval(() => {
      if (paused || root.querySelector('.modal-back')) { start = Date.now() - elapsed; return; }
      elapsed = Date.now() - start;
      cur.style.width = Math.min(100, (elapsed / duration) * 100) + '%';
      if (elapsed >= duration) next();
    }, 50);
  }
  async function showViewers(s) {
    const list = h('div', { class: 'stack' }, h('div', { class: 'spinner' }));
    modal({ title: 'Visualizações', body: list, onClose: () => { paused = false; } });
    const v = await GET(`/stories/${s.id}/viewers`);
    clear(list);
    if (!v.length) list.appendChild(h('div', { class: 'empty' }, 'Ninguém visualizou ainda.'));
    for (const x of v) list.appendChild(h('div', { class: 'list-item' }, avatar(x.user, 34), h('div', { class: 'meta' }, h('div', { class: 'name' }, x.user.displayName), h('div', { class: 'sub' }, fmtRelative(x.viewedAt))), x.reaction ? h('span', { style: { fontSize: '20px' } }, x.reaction) : null));
  }
  show();
}

export async function openStoryArchive() {
  const grid = h('div', { class: 'media-grid' }, h('div', { class: 'spinner' }));
  modal({ title: 'Arquivo de stories', size: 'wide', body: h('div', null, h('p', { class: 'muted' }, 'Seus stories ficam guardados aqui mesmo depois que expiram. Só você vê este arquivo.'), grid) });
  const list = await GET('/stories/archive');
  clear(grid);
  if (!list.length) grid.replaceWith(h('div', { class: 'empty' }, 'Você ainda não publicou stories.'));
  for (const s of list) {
    grid.appendChild(h('div', { style: { position: 'relative' }, onClick: () => openStoryViewer([{ user: state.me, stories: [s] }], 0, 0) },
      s.type === 'text' ? h('div', { class: 'story-text', style: { background: s.bg, fontSize: '11px', padding: '8px' } }, s.text.slice(0, 60)) : s.type === 'image' ? h('img', { src: s.url, alt: '' }) : h('video', { src: s.url, muted: true }),
      h('small', { style: { position: 'absolute', left: '6px', bottom: '4px', color: '#fff', textShadow: '0 1px 4px #000', fontSize: '.7em' } }, `${fmtDate(s.createdAt)} · 👁 ${s.views}${s.expired ? ' · expirado' : ''}`)));
  }
}

void EMOJI; void iconBtn;
