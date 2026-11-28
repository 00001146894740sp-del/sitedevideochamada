import {
  state, on, api, GET, POST, PATCH, PUT, DEL, h, clear, icon, iconBtn, toast, modal, menu, confirmDialog, promptDialog,
  avatar, roleMark, verifiedMark, serverTagEl, fmtRelative, fmtDate, field, switchEl, tabs, pickFiles, copy
} from './core.js';
import { layout, go, renderRail } from './app.js';
import * as chat from './chat.js';
import * as social from './social.js';
import * as voice from './voice.js';

const CATS = [['geral', 'Geral', 'hash'], ['anuncios', 'Anúncios', 'megaphone'], ['noticias', 'Notícias', 'megaphone'], ['conversas', 'Conversas', 'hash'], ['suporte', 'Suporte', 'support'], ['midia', 'Mídia', 'image'], ['memes', 'Memes', 'smile'], ['privado', 'Privados', 'lock'], ['voz', 'Canais de voz', 'volume']];
let curCom = null; // detalhe da comunidade aberta

export async function loadCommunities() {
  state.communities = await GET('/communities', { silent: true }).catch(() => state.communities);
}

on('channel:message', m => {
  if (!curCom || m.sender?.id === state.me.id) return;
  const ch = curCom.channels.find(c => c.id === m.conversationId);
  if (ch && state.view.convId !== ch.id) { ch.unread = true; renderComSide(); }
  if (!ch) {
    const c = state.communities.find(x => x.id !== curCom?.id);
    void c;
  }
});
on('channel:read', id => { const ch = curCom?.channels.find(c => c.id === id); if (ch && ch.unread) { ch.unread = false; renderComSide(); } });
on('community:update', d => { if (curCom && d.id === curCom.id) refresh(); });
on('voice:state', () => renderComSide());
on('voice:changed', () => renderComSide());

const has = bit => curCom && (curCom.perms & curCom.permBits[bit]) === curCom.permBits[bit];

async function refresh() {
  if (!curCom) return;
  const d = await GET(`/communities/${curCom.id}`, { silent: true }).catch(() => null);
  if (!d) return;
  curCom = d;
  if (state.view.section === 'community' && state.view.communityId === d.id) renderComSide();
}

export async function openCommunity(id, channelId, highlight) {
  let d;
  try { d = await GET(`/communities/${id}`); } catch { go('discover'); return; }
  if (!d.isMember) return previewCommunity(id);
  curCom = d;
  renderComSide();
  voice.refreshStates(d.channels.filter(c => c.category === 'voz').map(c => c.id));
  const target = channelId || (state.view.lastChannel?.[id] && d.channels.find(c => c.id === state.view.lastChannel[id])?.id) || d.channels.find(c => c.category !== 'voz')?.id;
  if (target) openChannel(target, highlight);
  else layout.setMain(h('div', { class: 'welcome' }, h('h2', null, d.name), h('p', null, 'Nenhum canal disponível para você.')));
  await loadCommunities(); renderRail();
}

function openChannel(cid, highlight) {
  const vch = curCom.channels.find(c => c.id === cid);
  if (vch?.category === 'voz') { voice.join(vch, { id: curCom.id, name: curCom.name }); return; }
  state.view.lastChannel = { ...(state.view.lastChannel || {}), [curCom.id]: cid };
  const ch = curCom.channels.find(c => c.id === cid);
  if (ch) ch.unread = false;
  state.view.convId = cid;
  renderComSide();
  chat.openChat(cid, { community: { id: curCom.id, name: curCom.name }, highlight });
}

function renderComSide() {
  if (!curCom || state.view.section !== 'community') return;
  const d = curCom;
  const body = h('div', { class: 'side-body' });
  for (const [cat, label, ic] of CATS) {
    const list = d.channels.filter(c => c.category === cat);
    if (!list.length) continue;
    body.appendChild(h('div', { class: 'section-label' }, label, has('MANAGE_CHANNELS') ? iconBtn('plus', 'Criar canal', () => createChannel(cat)) : null));
    for (const c of list) {
      body.appendChild(h('button', { class: `channel ${state.view.convId === c.id ? 'on' : ''} ${c.unread && cat !== 'voz' ? 'unread' : ''}`, onClick: () => openChannel(c.id), onContextmenu: e => { e.preventDefault(); channelMenu(e, c); } },
        icon(c.isPrivate ? 'lock' : ic), h('span', { class: 'ellipsis' }, c.name), cat === 'voz' && voice.participants(c.id).length ? h('small', { class: 'faint', style: { marginLeft: 'auto' } }, voice.participants(c.id).length) : null));
      if (cat === 'voz' && voice.participants(c.id).length) {
        body.appendChild(h('div', { class: 'voice-users' }, voice.participants(c.id).map(p => h('div', { class: `voice-user ${voice.current()?.speaking?.has(p.id) ? 'speaking' : ''}`, dataset: { voiceUid: p.id } },
          avatar(p, 22), h('span', { class: 'ellipsis grow' }, p.displayName), p.deaf ? icon('headphones') : p.muted ? icon('micoff') : null, p.video ? icon('video') : null))));
      }
    }
  }
  if (!d.channels.length) body.appendChild(h('div', { class: 'empty' }, 'Sem canais visíveis.'));
  const menuBtn = iconBtn('more', 'Opções da comunidade', e => comMenu(e));
  layout.setSide(h('div', { style: { display: 'contents' } },
    h('div', { class: 'com-banner', style: d.banner ? { backgroundImage: `url("${d.banner}")` } : null },
      h('div', { class: 'com-name' }, d.logo ? h('img', { src: d.logo, alt: '', style: { width: '30px', height: '30px', borderRadius: '9px', objectFit: 'cover' } }) : null, h('span', { class: 'ellipsis' }, d.name), d.verified ? verifiedMark('Comunidade verificada') : null, d.isOwner ? icon('crown', 15) : null),
      h('div', { class: 'com-menu' }, menuBtn)),
    d.boostLevel || d.tag ? h('div', { style: { padding: '8px 10px 0', display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
      d.boostLevel ? h('span', { class: 'boost-chip', title: 'Comunidade impulsionada' }, icon('gem', 13), `Impulso nível ${d.boostLevel}`) : null,
      d.tag ? serverTagEl({ ...d.tag, community: d.name }) : null,
      d.tag && state.me.tag?.communityId !== d.id ? h('button', { class: 'btn sm ghost', style: { padding: '3px 8px' }, onClick: async () => { const r = await POST('/users/me/server-tag', { communityId: d.id }); state.me.tag = r.tag; toast(`Agora a tag #${d.tag.text} aparece ao lado do seu nome!`, 'ok'); renderComSide(); } }, 'Usar tag') : null,
      d.tag && state.me.tag?.communityId === d.id ? h('small', { class: 'faint' }, 'Você usa esta tag') : null) : null,
    h('div', { style: { padding: '8px 10px', display: 'flex', gap: '6px', borderBottom: '1px solid var(--line)' } },
      has('CREATE_INVITES') ? h('button', { class: 'btn sm primary grow', onClick: invite }, icon('userplus', 15), 'Convidar') : null,
      h('button', { class: 'btn sm grow', onClick: () => membersModal() }, icon('users', 15), `${d.memberCount}`)),
    body, voice.voiceBar()));
}

function comMenu(e) {
  const d = curCom;
  const canManage = has('MANAGE_COMMUNITY') || has('MANAGE_ROLES') || has('MANAGE_CHANNELS') || has('BAN_MEMBERS') || has('VIEW_AUDIT_LOG') || has('HANDLE_REPORTS');
  menu(e, [
    has('CREATE_INVITES') ? { icon: 'userplus', label: 'Convidar pessoas', onClick: invite } : null,
    canManage ? { icon: 'cog', label: 'Configurações da comunidade', onClick: () => settings() } : null,
    has('MANAGE_CHANNELS') ? { icon: 'plus', label: 'Criar canal', onClick: () => createChannel('conversas') } : null,
    { icon: 'users', label: 'Membros', onClick: () => membersModal() },
    { icon: 'edit', label: 'Meu apelido na comunidade', onClick: async () => { const v = await promptDialog('Apelido (vazio para remover)', { title: 'Apelido' }); if (v !== null) { await PATCH(`/communities/${d.id}/members/me`, { nickname: v }); toast('Apelido atualizado.', 'ok'); } } },
    { icon: 'copy', label: 'Copiar ID da comunidade', onClick: () => copy(String(d.id)) },
    '-',
    !d.isOwner ? { icon: 'flag', label: 'Denunciar comunidade', danger: true, onClick: () => social.openReport('community', d.id) } : null,
    !d.isOwner ? { icon: 'logout', label: 'Sair da comunidade', danger: true, onClick: async () => { if (await confirmDialog(`Sair de ${d.name}?`, { danger: true, confirmText: 'Sair' })) { await POST(`/communities/${d.id}/leave`); await loadCommunities(); go('discover'); } } } : null
  ]);
}
function channelMenu(e, c) {
  menu(e, [
    { icon: 'check', label: 'Marcar como lido', onClick: async () => { await POST(`/conversations/${c.id}/read`); c.unread = false; renderComSide(); } },
    { icon: 'copy', label: 'Copiar ID do canal', onClick: () => copy(String(c.id)) },
    has('MANAGE_CHANNELS') ? '-' : null,
    has('MANAGE_CHANNELS') ? { icon: 'edit', label: 'Editar canal', onClick: () => editChannel(c) } : null,
    has('MANAGE_CHANNELS') ? { icon: 'trash', label: 'Excluir canal', danger: true, onClick: async () => { if (await confirmDialog(`Excluir #${c.name}? As mensagens deixarão de ficar acessíveis.`, { danger: true, confirmText: 'Excluir' })) { await DEL(`/channels/${c.id}`); toast('Canal excluído.', 'ok'); refresh(); } } } : null
  ]);
}

function channelForm(c = {}) {
  const name = h('input', { class: 'input', value: c.name || '', placeholder: 'novo-canal', maxlength: 40 });
  const cat = h('select', { class: 'select' }, CATS.map(([v, l]) => h('option', { value: v }, l)));
  cat.value = c.category || 'conversas';
  const topic = h('input', { class: 'input', value: c.topic || '', placeholder: 'Assunto do canal (opcional)', maxlength: 200 });
  const priv = { v: !!c.isPrivate };
  const roleBox = h('div', { class: 'stack' });
  const sel = new Set(c.roleIds || []);
  for (const r of curCom.roles.filter(x => !x.isDefault)) {
    const cb = h('input', { type: 'checkbox', checked: sel.has(r.id) });
    cb.addEventListener('change', () => cb.checked ? sel.add(r.id) : sel.delete(r.id));
    roleBox.appendChild(h('label', { class: 'row' }, cb, h('span', { style: { color: r.color, fontWeight: 700 } }, r.name)));
  }
  const roleWrap = h('div', { style: { display: priv.v || cat.value === 'privado' ? 'block' : 'none' } }, h('div', { class: 'label', style: { margin: '10px 0 6px' } }, 'Cargos com acesso'), roleBox, h('p', { class: 'hint' }, 'Administradores sempre têm acesso.'));
  const sw = switchEl(priv.v, v => { priv.v = v; roleWrap.style.display = v ? 'block' : 'none'; });
  cat.addEventListener('change', () => { if (cat.value === 'privado') { priv.v = true; sw.querySelector('input').checked = true; roleWrap.style.display = 'block'; } });
  const el = h('div', null, field('Nome', name), field('Categoria', cat, 'Canais de Anúncios e Notícias aceitam mensagens apenas de quem pode publicar avisos.'), field('Assunto', topic),
    h('div', { class: 'toggle-row' }, h('div', null, h('b', null, 'Canal privado'), h('div', { class: 'hint' }, 'Somente cargos escolhidos podem ver.')), sw), roleWrap);
  return { el, value: () => ({ name: name.value, category: cat.value, topic: topic.value, isPrivate: priv.v, roleIds: [...sel] }) };
}
function createChannel(category) {
  const f = channelForm({ category });
  const m = modal({ title: 'Criar canal', body: f.el, foot: [h('button', { class: 'btn ghost', onClick: () => m.close() }, 'Cancelar'), h('button', { class: 'btn primary', onClick: async () => { const r = await POST(`/communities/${curCom.id}/channels`, f.value()); m.close(); await refresh(); openChannel(r.id); } }, 'Criar')] });
}
function editChannel(c) {
  const f = channelForm(c);
  const m = modal({ title: `Editar #${c.name}`, body: f.el, foot: [h('button', { class: 'btn ghost', onClick: () => m.close() }, 'Cancelar'), h('button', { class: 'btn primary', onClick: async () => { await PATCH(`/channels/${c.id}`, f.value()); m.close(); toast('Canal atualizado.', 'ok'); refresh(); } }, 'Salvar')] });
}

async function invite() {
  const out = h('div', { class: 'stack' });
  const maxUses = h('select', { class: 'select' }, h('option', { value: '' }, 'Sem limite'), [1, 5, 10, 25, 100].map(n => h('option', { value: n }, `${n} uso(s)`)));
  const exp = h('select', { class: 'select' }, h('option', { value: '24' }, '1 dia'), h('option', { value: '168', selected: true }, '7 dias'), h('option', { value: '720' }, '30 dias'), h('option', { value: '' }, 'Nunca'));
  const gen = async () => {
    const r = await POST(`/communities/${curCom.id}/invites`, { maxUses: maxUses.value || undefined, expiresHours: exp.value || undefined });
    const link = `${location.origin}/invite/${r.code}`;
    clear(out).append(h('div', { class: 'row' }, h('input', { class: 'input', value: link, readonly: true }), h('button', { class: 'btn primary', onClick: () => copy(link) }, 'Copiar')));
    const friends = h('div', { class: 'stack', style: { maxHeight: '30vh', overflow: 'auto' } });
    for (const f of state.friends) friends.appendChild(h('div', { class: 'list-item' }, avatar(f, 32), h('div', { class: 'meta' }, h('div', { class: 'name' }, f.displayName)),
      h('button', { class: 'btn sm', onClick: async e => { await POST(`/communities/${curCom.id}/invites`, { userId: f.id, maxUses: 1, expiresHours: 168 }); e.target.textContent = 'Enviado ✓'; e.target.disabled = true; } }, 'Convidar')));
    if (state.friends.length) out.append(h('div', { class: 'label' }, 'Convidar amigos diretamente'), friends);
  };
  modal({ title: `Convidar para ${curCom.name}`, body: h('div', null, h('div', { class: 'row' }, h('div', { class: 'grow' }, field('Limite de usos', maxUses)), h('div', { class: 'grow' }, field('Expira em', exp))), h('button', { class: 'btn block', onClick: gen, style: { marginBottom: '12px' } }, 'Gerar novo link'), out) });
  gen();
}

async function membersModal() {
  const q = h('input', { class: 'input', placeholder: 'Buscar membros' });
  const list = h('div', { class: 'stack', style: { marginTop: '10px' } });
  modal({ title: `Membros de ${curCom.name}`, size: 'wide', body: h('div', null, h('div', { class: 'search-box' }, icon('search'), q), list) });
  const load = async () => {
    const members = await GET(`/communities/${curCom.id}/members?q=${encodeURIComponent(q.value)}`);
    clear(list);
    for (const m of members) {
      const roles = curCom.roles.filter(r => m.roleIds.includes(r.id)).sort((a, b) => b.position - a.position);
      list.appendChild(h('div', { class: 'list-item' }, avatar(m, 38, { presence: m.presence }),
        h('div', { class: 'meta' }, h('div', { class: 'name' }, h('span', { style: { color: roles[0]?.color } }, m.nickname || m.displayName), m.isOwner ? icon('crown', 14) : null, roleMark(m)),
          h('div', { class: 'row wrap', style: { gap: '4px', marginTop: '2px' } }, h('small', { class: 'faint' }, '@' + m.username), roles.map(r => h('span', { class: 'chip', style: { color: r.color, background: 'transparent', border: `1px solid ${r.color}55` } }, r.name)))),
        iconBtn('more', 'Opções', e => memberMenu(e, m, load))));
    }
  };
  let t; q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 250); });
  load();
}
function memberMenu(e, m, reload) {
  const isMe = m.id === state.me.id;
  menu(e, [
    { icon: 'user', label: 'Ver perfil', onClick: () => social.openProfile(m.id) },
    !isMe ? { icon: 'chat', label: 'Mensagem privada', onClick: () => chat.startDM(m.id) } : null,
    has('MANAGE_ROLES') && !m.isOwner ? { icon: 'shield', label: 'Gerenciar cargos', onClick: () => editMemberRoles(m, reload) } : null,
    has('KICK_MEMBERS') && !isMe && !m.isOwner ? { icon: 'logout', label: 'Expulsar', danger: true, onClick: async () => { if (await confirmDialog(`Expulsar ${m.displayName}?`, { danger: true, confirmText: 'Expulsar' })) { await DEL(`/communities/${curCom.id}/members/${m.id}`, {}); toast('Membro expulso.', 'ok'); reload(); } } } : null,
    has('BAN_MEMBERS') && !isMe && !m.isOwner ? { icon: 'block', label: 'Banir', danger: true, onClick: async () => { const reason = await promptDialog('Motivo do banimento', { title: `Banir ${m.displayName}`, confirmText: 'Banir' }); if (reason !== null) { await POST(`/communities/${curCom.id}/bans`, { userId: m.id, reason }); toast('Membro banido.', 'ok'); reload(); } } } : null,
    curCom.isOwner && !isMe ? { icon: 'crown', label: 'Transferir propriedade', danger: true, onClick: async () => { if (await confirmDialog(`Transferir a comunidade para ${m.displayName}? Você perderá o controle total.`, { danger: true, confirmText: 'Transferir' })) { await POST(`/communities/${curCom.id}/transfer`, { userId: m.id }); toast('Propriedade transferida.', 'ok'); refresh(); } } } : null
  ]);
}
function editMemberRoles(m, reload) {
  const sel = new Set(m.roleIds);
  const box = h('div', { class: 'stack' });
  for (const r of curCom.roles.filter(x => !x.isDefault)) {
    const can = r.position < curCom.myTopPosition;
    const cb = h('input', { type: 'checkbox', checked: sel.has(r.id), disabled: !can });
    cb.addEventListener('change', () => cb.checked ? sel.add(r.id) : sel.delete(r.id));
    box.appendChild(h('label', { class: 'row' }, cb, h('span', { style: { color: r.color, fontWeight: 700 } }, r.name), !can ? h('small', { class: 'faint' }, '(acima do seu cargo)') : null));
  }
  const mm = modal({ title: `Cargos de ${m.displayName}`, body: box, foot: [h('button', { class: 'btn primary', onClick: async () => { await PUT(`/communities/${curCom.id}/members/${m.id}/roles`, { roleIds: [...sel] }); mm.close(); toast('Cargos atualizados.', 'ok'); reload(); } }, 'Salvar')] });
}

// ===================== CONFIGURAÇÕES DA COMUNIDADE =====================
function settings(tab = 'overview') {
  const nav = h('nav', { class: 'settings-nav' });
  const mainEl = h('div', { class: 'settings-main' });
  const items = [
    has('MANAGE_COMMUNITY') && ['overview', 'cog', 'Visão geral'],
    has('MANAGE_ROLES') && ['roles', 'shield', 'Cargos e permissões'],
    has('MANAGE_CHANNELS') && ['channels', 'hash', 'Canais'],
    has('MANAGE_COMMUNITY') && ['invites', 'link', 'Convites'],
    has('BAN_MEMBERS') && ['bans', 'block', 'Banimentos'],
    has('HANDLE_REPORTS') && ['reports', 'flag', 'Denúncias'],
    has('VIEW_AUDIT_LOG') && ['audit', 'history', 'Registro de atividades'],
    curCom.isOwner && ['danger', 'trash', 'Zona de perigo']
  ].filter(Boolean);
  if (!items.find(i => i[0] === tab)) tab = items[0]?.[0];
  const show = t => {
    nav.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === t));
    clear(mainEl);
    ({ overview, roles, channels, invites, bans, reports, audit, danger })[t](mainEl);
  };
  nav.appendChild(h('span', { class: 'label' }, curCom.name));
  for (const [k, ic, label] of items) nav.appendChild(h('button', { dataset: { k }, onClick: () => show(k) }, icon(ic), label));
  modal({ title: 'Configurações da comunidade', size: 'xl', body: h('div', { class: 'settings-layout' }, nav, mainEl), onClose: refresh }).el.querySelector('.modal-body').style.padding = '0';
  if (tab) show(tab);
}

function overview(el) {
  const d = curCom;
  const name = h('input', { class: 'input', value: d.name, maxlength: 60 });
  const desc = h('textarea', { class: 'textarea', value: d.description, maxlength: 1000 });
  let pub = d.isPublic;
  const upl = kind => h('button', { class: 'btn sm', onClick: async () => { const [f] = await pickFiles({ accept: 'image/*' }); if (!f) return; const fd = new FormData(); fd.append('file', f); await api('POST', `/communities/${d.id}/${kind}`, undefined, { form: fd }); toast('Imagem atualizada!', 'ok'); await refresh(); } }, icon('image', 15), kind === 'logo' ? 'Alterar logo' : 'Alterar banner');
  el.append(h('h2', null, 'Visão geral'),
    h('div', { class: 'card' }, h('div', { class: 'row' }, avatar(d, 72, { square: true }), h('div', { class: 'stack' }, upl('logo'), upl('banner')))),
    field('Nome', name), field('Descrição', desc),
    h('div', { class: 'toggle-row' }, h('div', null, h('b', null, 'Comunidade pública'), h('div', { class: 'hint' }, 'Aparece em Explorar e qualquer pessoa pode entrar.')), switchEl(pub, v => { pub = v; })),
    h('button', { class: 'btn primary', style: { marginTop: '14px' }, onClick: async () => { await PATCH(`/communities/${d.id}`, { name: name.value, description: desc.value, isPublic: pub }); toast('Comunidade atualizada!', 'ok'); refresh(); } }, 'Salvar alterações'));
}

function roles(el) {
  const d = curCom;
  const list = h('div', { class: 'stack' });
  const editor = h('div');
  el.append(h('h2', null, 'Cargos e permissões'), h('p', { class: 'muted' }, 'Cargos mais altos na lista têm prioridade. Você só pode editar cargos abaixo do seu e conceder permissões que você possui.'),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(180px, 240px) 1fr', gap: '18px' } },
      h('div', null, list, h('button', { class: 'btn sm block', style: { marginTop: '10px' }, onClick: async () => { await POST(`/communities/${d.id}/roles`, { name: 'Novo cargo', permissions: d.permBits.VIEW_CHANNELS | d.permBits.SEND_MESSAGES }); await refresh(); roles(clear(el)); } }, icon('plus', 15), 'Novo cargo')), editor));
  const draw = sel => {
    clear(list);
    for (const r of curCom.roles) list.appendChild(h('button', { class: `list-item ${sel?.id === r.id ? 'on' : ''}`, onClick: () => { draw(r); edit(r); } }, h('span', { style: { width: '12px', height: '12px', borderRadius: '50%', background: r.color, flex: 'none' } }), h('span', { class: 'grow ellipsis' }, r.name)));
  };
  const edit = r => {
    clear(editor);
    const editable = r.isDefault || r.position < curCom.myTopPosition;
    const name = h('input', { class: 'input', value: r.name, disabled: r.isDefault || !editable });
    const color = h('input', { type: 'color', value: r.color, disabled: !editable, style: { width: '60px', height: '40px', border: 0, background: 'none' } });
    let perms = r.permissions;
    const grid = h('div', { class: 'perm-grid' });
    for (const [key, label] of Object.entries(d.permLabels)) {
      const bit = d.permBits[key];
      const mine = (curCom.perms & bit) === bit;
      grid.appendChild(h('div', { class: 'toggle-row' }, h('span', { class: mine ? '' : 'faint' }, label), (() => { const s = switchEl((perms & bit) === bit, v => { perms = v ? perms | bit : perms & ~bit; }); if (!editable || !mine) s.querySelector('input').disabled = true; return s; })()));
    }
    editor.append(h('div', { class: 'row' }, h('div', { class: 'grow' }, field('Nome do cargo', name)), field('Cor', color)), h('div', { class: 'label', style: { margin: '6px 0' } }, 'Permissões'), grid,
      editable ? h('div', { class: 'row', style: { marginTop: '14px' } },
        h('button', { class: 'btn primary', onClick: async () => { await PATCH(`/communities/${d.id}/roles/${r.id}`, { name: r.isDefault ? undefined : name.value, color: color.value, permissions: perms }); toast('Cargo salvo.', 'ok'); await refresh(); draw(curCom.roles.find(x => x.id === r.id)); } }, 'Salvar'),
        !r.isDefault ? h('button', { class: 'btn danger', onClick: async () => { if (await confirmDialog(`Excluir o cargo ${r.name}?`, { danger: true, confirmText: 'Excluir' })) { await DEL(`/communities/${d.id}/roles/${r.id}`); await refresh(); roles(clear(el)); } } }, 'Excluir cargo') : null)
        : h('p', { class: 'hint' }, 'Este cargo está acima do seu e não pode ser editado.'));
  };
  draw(curCom.roles[0]); if (curCom.roles[0]) edit(curCom.roles[0]);
}

function channels(el) {
  el.append(h('h2', null, 'Canais'), h('button', { class: 'btn primary sm', onClick: () => createChannel('conversas') }, icon('plus', 15), 'Criar canal'));
  const tbl = h('table', { class: 'tbl', style: { marginTop: '12px' } }, h('tr', null, h('th', null, 'Canal'), h('th', null, 'Categoria'), h('th', null, 'Visibilidade'), h('th', null, 'Posição'), h('th')));
  for (const c of curCom.channels) {
    const pos = h('input', { class: 'input', type: 'number', value: c.position, style: { width: '80px', padding: '6px' } });
    pos.addEventListener('change', async () => { await PATCH(`/channels/${c.id}`, { position: Number(pos.value) }); refresh(); });
    tbl.appendChild(h('tr', null, h('td', null, '#' + c.name), h('td', null, CATS.find(x => x[0] === c.category)?.[1]), h('td', null, c.isPrivate ? h('span', { class: 'chip gold' }, 'Privado') : h('span', { class: 'chip' }, 'Público')), h('td', null, pos),
      h('td', null, iconBtn('edit', 'Editar', () => editChannel(c)), iconBtn('trash', 'Excluir', async () => { if (await confirmDialog(`Excluir #${c.name}?`, { danger: true, confirmText: 'Excluir' })) { await DEL(`/channels/${c.id}`); await refresh(); channels(clear(el)); } }, 'danger'))));
  }
  el.appendChild(tbl);
}

async function invites(el) {
  el.append(h('h2', null, 'Convites ativos'), h('div', { class: 'spinner' }));
  const list = await GET(`/communities/${curCom.id}/invites`);
  el.lastChild.remove();
  if (!list.length) return el.appendChild(h('div', { class: 'empty' }, 'Nenhum convite ativo.'));
  const tbl = h('table', { class: 'tbl' }, h('tr', null, h('th', null, 'Código'), h('th', null, 'Criado por'), h('th', null, 'Usos'), h('th', null, 'Expira'), h('th')));
  for (const i of list) tbl.appendChild(h('tr', null, h('td', null, h('code', null, i.code)), h('td', null, i.createdBy || '—'), h('td', null, `${i.uses}${i.maxUses ? '/' + i.maxUses : ''}`), h('td', null, i.expiresAt ? fmtDate(i.expiresAt) : 'Nunca'),
    h('td', null, iconBtn('copy', 'Copiar link', () => copy(`${location.origin}/invite/${i.code}`)), iconBtn('trash', 'Revogar', async () => { await DEL(`/invites/community/${i.code}`); invites(clear(el)); }, 'danger'))));
  el.appendChild(tbl);
}

async function bans(el) {
  el.append(h('h2', null, 'Banimentos'), h('div', { class: 'spinner' }));
  const list = await GET(`/communities/${curCom.id}/bans`);
  el.lastChild.remove();
  if (!list.length) return el.appendChild(h('div', { class: 'empty' }, 'Ninguém banido.'));
  for (const b of list) el.appendChild(h('div', { class: 'list-item' }, avatar(b.user, 36), h('div', { class: 'meta' }, h('div', { class: 'name' }, b.user.displayName), h('div', { class: 'sub' }, `${b.reason || 'Sem motivo'} · ${fmtRelative(b.createdAt)}`)),
    h('button', { class: 'btn sm', onClick: async () => { await DEL(`/communities/${curCom.id}/bans/${b.user.id}`); toast('Banimento removido.', 'ok'); bans(clear(el)); } }, 'Remover ban')));
}

async function reports(el) {
  el.append(h('h2', null, 'Denúncias da comunidade'), h('div', { class: 'spinner' }));
  const list = await GET(`/communities/${curCom.id}/reports`);
  el.lastChild.remove();
  if (!list.length) return el.appendChild(h('div', { class: 'empty' }, h('span', { class: 'spark' }, '✦'), 'Nenhuma denúncia. Tudo em ordem!'));
  const reasonL = { spam: 'Spam', assedio: 'Assédio', odio: 'Ódio', violencia: 'Violência', conteudo_sexual: 'Conteúdo sexual', golpe: 'Golpe', falsidade: 'Falsidade', outro: 'Outro' };
  for (const r of list) {
    const statusChip = { open: h('span', { class: 'chip red' }, 'Aberta'), reviewing: h('span', { class: 'chip gold' }, 'Em análise'), resolved: h('span', { class: 'chip green' }, 'Resolvida'), dismissed: h('span', { class: 'chip' }, 'Descartada') }[r.status];
    el.appendChild(h('div', { class: 'card' },
      h('div', { class: 'row between' }, h('div', { class: 'row' }, statusChip, h('b', null, reasonL[r.reason]), h('small', { class: 'faint' }, `por ${r.reporter || '—'} · ${fmtRelative(r.createdAt)}`))),
      r.details ? h('p', { class: 'muted' }, r.details) : null,
      r.target?.messageId ? h('div', { class: 'reply-quote', style: { marginTop: '8px' } }, h('b', null, r.target.author || ''), h('span', { style: { whiteSpace: 'normal' } }, r.target.content)) : null,
      r.target?.username ? h('div', { class: 'row', style: { marginTop: '8px' } }, avatar(r.target, 28), r.target.displayName) : null,
      h('div', { class: 'row wrap', style: { marginTop: '10px' } },
        r.target?.messageId && r.target.content !== '(apagada)' ? h('button', { class: 'btn sm danger', onClick: async () => { await DEL(`/messages/${r.target.messageId}?forAll=1`); await PATCH(`/communities/${curCom.id}/reports/${r.id}`, { status: 'resolved', resolution: 'Mensagem removida' }); reports(clear(el)); } }, 'Apagar mensagem') : null,
        r.target?.authorId && has('BAN_MEMBERS') ? h('button', { class: 'btn sm danger', onClick: async () => { await POST(`/communities/${curCom.id}/bans`, { userId: r.target.authorId, reason: `Denúncia #${r.id}` }); await PATCH(`/communities/${curCom.id}/reports/${r.id}`, { status: 'resolved', resolution: 'Autor banido' }); reports(clear(el)); } }, 'Banir autor') : null,
        r.status === 'open' ? h('button', { class: 'btn sm', onClick: async () => { await PATCH(`/communities/${curCom.id}/reports/${r.id}`, { status: 'reviewing' }); reports(clear(el)); } }, 'Analisar') : null,
        ['open', 'reviewing'].includes(r.status) ? h('button', { class: 'btn sm', onClick: async () => { await PATCH(`/communities/${curCom.id}/reports/${r.id}`, { status: 'resolved' }); reports(clear(el)); } }, 'Resolver') : null,
        ['open', 'reviewing'].includes(r.status) ? h('button', { class: 'btn sm ghost', onClick: async () => { await PATCH(`/communities/${curCom.id}/reports/${r.id}`, { status: 'dismissed' }); reports(clear(el)); } }, 'Descartar') : null)));
  }
}

async function audit(el) {
  el.append(h('h2', null, 'Registro de atividades'), h('div', { class: 'spinner' }));
  const list = await GET(`/communities/${curCom.id}/audit`);
  el.lastChild.remove();
  const L = { community_created: 'criou a comunidade', community_updated: 'atualizou a comunidade', logo_updated: 'alterou o logo', banner_updated: 'alterou o banner', member_joined: 'entrou', member_left: 'saiu', member_kicked: 'expulsou um membro', member_banned: 'baniu um membro', member_unbanned: 'removeu um banimento', member_roles_updated: 'alterou cargos de um membro', role_created: 'criou um cargo', role_updated: 'editou um cargo', role_deleted: 'excluiu um cargo', channel_created: 'criou um canal', channel_updated: 'editou um canal', channel_deleted: 'excluiu um canal', invite_created: 'criou um convite', invite_revoked: 'revogou um convite', message_deleted: 'apagou uma mensagem', ownership_transferred: 'transferiu a propriedade', report_resolved: 'resolveu uma denúncia', report_dismissed: 'descartou uma denúncia', report_reviewing: 'começou a analisar uma denúncia' };
  const tbl = h('table', { class: 'tbl' }, h('tr', null, h('th', null, 'Quando'), h('th', null, 'Quem'), h('th', null, 'Ação'), h('th', null, 'Detalhes')));
  for (const a of list) tbl.appendChild(h('tr', null, h('td', null, fmtDate(a.createdAt)), h('td', null, a.actor || '—'), h('td', null, L[a.action] || a.action), h('td', { class: 'faint' }, a.data?.name || a.data?.reason || (a.data?.roles ? a.data.roles.join(', ') : '') || a.target || '')));
  el.appendChild(tbl);
}

function danger(el) {
  el.append(h('h2', null, 'Zona de perigo'),
    h('div', { class: 'card' }, h('b', null, 'Excluir comunidade'), h('p', { class: 'muted' }, 'Todos os canais e mensagens deixarão de estar acessíveis. Esta ação não pode ser desfeita por você.'),
      h('button', { class: 'btn danger', onClick: async () => {
        const v = await promptDialog(`Digite "${curCom.name}" para confirmar`, { title: 'Excluir comunidade', confirmText: 'Excluir para sempre' });
        if (v === null) return;
        await DEL(`/communities/${curCom.id}`, { confirm: v });
        document.querySelectorAll('.modal-back').forEach(m => m.remove());
        toast('Comunidade excluída.', 'ok'); await loadCommunities(); go('discover');
      } }, 'Excluir comunidade')));
}

// ===================== CRIAR / EXPLORAR / CONVITES =====================
export function openCreate() {
  const name = h('input', { class: 'input', placeholder: 'Ex.: Arena GG', maxlength: 60 });
  const desc = h('textarea', { class: 'textarea', placeholder: 'Do que se trata a comunidade?', maxlength: 1000 });
  let pub = true; let logo = null;
  const logoBtn = h('div', { class: 'upload-zone', onClick: async () => { const [f] = await pickFiles({ accept: 'image/*' }); if (f) { logo = f; clear(logoBtn).append(h('img', { src: URL.createObjectURL(f), alt: '', style: { width: '72px', height: '72px', borderRadius: '20px', objectFit: 'cover' } })); } } }, icon('image', 26), h('div', null, 'Logo (opcional)'));
  const btn = h('button', { class: 'btn primary' }, 'Criar comunidade');
  const m = modal({
    title: 'Criar comunidade',
    body: h('div', null, h('p', { class: 'muted' }, 'Sua comunidade já começa com canais de boas-vindas, avisos, bate-papo, mídia e memes, além dos cargos Administração e Moderação.'), logoBtn, h('div', { style: { height: '12px' } }), field('Nome', name), field('Descrição', desc),
      h('div', { class: 'toggle-row' }, h('div', null, h('b', null, 'Pública'), h('div', { class: 'hint' }, 'Qualquer pessoa pode encontrar e entrar.')), switchEl(pub, v => { pub = v; }))),
    foot: [h('button', { class: 'btn ghost', onClick: () => m.close() }, 'Cancelar'), btn]
  });
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const c = await POST('/communities', { name: name.value, description: desc.value, isPublic: pub });
      if (logo) { const fd = new FormData(); fd.append('file', logo); await api('POST', `/communities/${c.id}/logo`, undefined, { form: fd }).catch(() => {}); }
      m.close(); toast('Comunidade criada! 🏰', 'gold'); await loadCommunities(); go('community', { communityId: c.id });
    } catch { btn.disabled = false; }
  });
}

export function renderDiscoverSide() {
  const list = h('div', { class: 'side-body' });
  list.appendChild(h('div', { class: 'section-label' }, 'Suas comunidades'));
  if (!state.communities.length) list.appendChild(h('div', { class: 'hint', style: { padding: '0 10px' } }, 'Você ainda não participa de nenhuma.'));
  for (const c of state.communities) list.appendChild(h('button', { class: 'list-item', onClick: () => go('community', { communityId: c.id }) }, avatar(c, 40, { square: true }), h('div', { class: 'meta' }, h('div', { class: 'name' }, c.name, c.verified ? verifiedMark() : null, c.unread ? h('span', { class: 'gold' }, '✦') : null), h('div', { class: 'sub' }, `${c.memberCount} membros`))));
  layout.setSide(h('div', { style: { display: 'contents' } },
    h('div', { class: 'side-head' }, h('div', { class: 'row between' }, h('h2', { class: 'side-title' }, h('span', { class: 'spark' }, '✦'), 'Comunidades'), h('button', { class: 'btn primary sm', onClick: openCreate }, icon('plus', 16), 'Criar'))),
    list));
}

export async function renderDiscover() {
  const q = h('input', { class: 'input', placeholder: 'Explorar comunidades públicas' });
  const grid = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '14px', marginTop: '16px' } });
  layout.setMain(h('section', { class: 'main chat-bg-aurora', style: { flex: 1, overflow: 'auto', padding: '26px' } },
    h('div', { class: 'row' }, iconBtn('back', 'Voltar', () => layout.back(), 'back'), h('h2', { style: { fontFamily: 'var(--display)', margin: 0 } }, 'Explorar comunidades')),
    h('p', { class: 'muted' }, 'Encontre gente com os mesmos interesses que você.'),
    h('div', { class: 'row' }, h('div', { class: 'search-box grow' }, icon('search'), q), h('button', { class: 'btn primary', onClick: openCreate }, icon('plus', 16), 'Criar a sua')),
    grid), { inChat: false });
  const load = async () => {
    clear(grid).appendChild(h('div', { class: 'spinner' }));
    const list = await GET(`/communities/discover?q=${encodeURIComponent(q.value)}`);
    clear(grid);
    if (!list.length) grid.appendChild(h('div', { class: 'empty' }, 'Nenhuma comunidade encontrada. Que tal criar a primeira?'));
    for (const c of list) {
      grid.appendChild(h('div', { class: 'card', style: { padding: 0, overflow: 'hidden', cursor: 'pointer' }, onClick: () => c.joined ? go('community', { communityId: c.id }) : previewCommunity(c.id) },
        h('div', { style: { height: '90px', background: c.banner ? `center/cover url("${c.banner}")` : 'linear-gradient(135deg,#3b0a78,var(--accent),var(--gold))' } }),
        h('div', { style: { padding: '0 14px 14px', marginTop: '-26px' } }, h('div', { style: { border: '4px solid var(--bg2)', borderRadius: '30%', display: 'inline-block' } }, avatar(c, 52, { square: true })),
          h('h3', { style: { margin: '6px 0 2px', display: 'flex', gap: '6px', alignItems: 'center' } }, c.name, c.verified ? verifiedMark('Comunidade verificada') : null), h('p', { class: 'muted', style: { margin: '0 0 8px', fontSize: '.88em', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } }, c.description || 'Sem descrição.'),
          h('div', { class: 'row between' }, h('span', { class: 'chip' }, `${c.memberCount} membros`), c.joined ? h('span', { class: 'chip green' }, 'Membro') : h('span', { class: 'chip gold' }, 'Entrar')))));
    }
  };
  let t; q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 250); });
  load();
}

// Ao clicar numa tag (#CPX): mostra o servidor de origem; entra direto se for público.
export async function serverTagCard(cid) {
  let d;
  try { d = await GET(`/server-tags/${cid}`); } catch { return; }
  const cover = d.banner ? `center/cover url("${d.banner}")` : 'linear-gradient(135deg,#3b0a78,var(--accent),var(--gold))';
  const status = d.banned ? h('div', { class: 'form-error' }, 'Você foi banido deste servidor.')
    : d.isMember ? h('span', { class: 'chip green' }, 'Você já é membro')
    : !d.isPublic ? h('div', { class: 'tag-private' }, icon('lock', 16), h('span', null, 'Servidor privado — só dá para entrar com convite.')) : null;
  const enter = async (btn) => {
    btn.disabled = true;
    try { await POST(`/communities/${d.id}/join`); m.close(); await loadCommunities(); go('community', { communityId: d.id }); }
    catch { btn.disabled = false; }
  };
  const foot = [h('button', { class: 'btn ghost', onClick: () => m.close() }, 'Fechar')];
  if (d.isMember) foot.push(h('button', { class: 'btn primary', onClick: () => { m.close(); go('community', { communityId: d.id }); } }, 'Abrir servidor'));
  else if (d.isPublic && !d.banned) foot.push(h('button', { class: 'btn primary', onClick: e => enter(e.currentTarget) }, icon('userplus', 16), 'Entrar pelo #' + d.tag.text));
  const m = modal({
    title: null,
    body: h('div', null, h('div', { style: { height: '100px', background: cover } }),
      h('div', { style: { textAlign: 'center', padding: '0 20px 14px', marginTop: '-38px', display: 'grid', justifyItems: 'center', gap: '8px' } },
        h('div', { style: { border: '5px solid var(--panel)', borderRadius: '30%' } }, avatar(d, 72, { square: true })),
        h('h2', { style: { fontFamily: 'var(--display)', margin: 0, display: 'flex', gap: '8px', alignItems: 'center' } }, d.name, d.verified ? verifiedMark() : null),
        h('div', { class: 'row', style: { gap: '6px', justifyContent: 'center' } }, serverTagEl({ ...d.tag }), d.boostLevel ? h('span', { class: 'boost-chip' }, icon('gem', 12), `Impulso nível ${d.boostLevel}`) : null),
        d.description ? h('p', { class: 'muted', style: { margin: 0 } }, d.description) : null,
        h('span', { class: 'chip' }, `${d.memberCount} ${d.memberCount === 1 ? "membro" : "membros"}`), status)),
    foot
  });
  m.el.querySelector('.modal-body').style.padding = '0';
}
on('open-server-tag', serverTagCard);

export async function previewCommunity(id) {
  let d;
  try { d = await GET(`/communities/${id}`); } catch { return; }
  const m = modal({
    title: null,
    body: h('div', null, h('div', { style: { height: '110px', background: d.banner ? `center/cover url("${d.banner}")` : 'linear-gradient(135deg,#3b0a78,var(--accent),var(--gold))' } }),
      h('div', { style: { textAlign: 'center', padding: '0 20px 10px', marginTop: '-40px', display: 'grid', justifyItems: 'center', gap: '6px' } }, h('div', { style: { border: '5px solid var(--panel)', borderRadius: '30%' } }, avatar(d, 76, { square: true })), h('h2', { style: { fontFamily: 'var(--display)', margin: 0, display: 'flex', gap: '8px', alignItems: 'center' } }, d.name, d.verified ? verifiedMark('Comunidade verificada') : null), h('p', { class: 'muted', style: { margin: 0 } }, d.description), h('span', { class: 'chip' }, `${d.memberCount} ${d.memberCount === 1 ? "membro" : "membros"}`),
        d.banned ? h('div', { class: 'form-error' }, 'Você foi banido desta comunidade.') : null)),
    foot: d.banned ? null : [h('button', { class: 'btn ghost', onClick: () => m.close() }, 'Agora não'), h('button', { class: 'btn primary', onClick: async () => { await POST(`/communities/${id}/join`); m.close(); await loadCommunities(); go('community', { communityId: id }); } }, 'Entrar na comunidade')]
  });
  m.el.querySelector('.modal-body').style.padding = '0';
}

export async function openInvite(code) {
  let inv;
  try { inv = await GET(`/invites/community/${encodeURIComponent(code)}`); } catch { return; }
  if (inv.isMember) return go('community', { communityId: inv.communityId });
  const m = modal({
    title: 'Você foi convidado!',
    body: h('div', { style: { textAlign: 'center', display: 'grid', justifyItems: 'center', gap: '8px' } }, avatar(inv, 80, { square: true }), h('h2', { style: { fontFamily: 'var(--display)', margin: 0, display: 'flex', gap: '8px', alignItems: 'center' } }, inv.name, inv.verified ? verifiedMark('Comunidade verificada') : null), h('p', { class: 'muted', style: { margin: 0 } }, inv.description), h('span', { class: 'chip' }, `${inv.memberCount} membros`)),
    foot: [h('button', { class: 'btn ghost', onClick: () => m.close() }, 'Recusar'), h('button', { class: 'btn primary', onClick: async () => { const r = await POST(`/invites/community/${encodeURIComponent(code)}/join`); m.close(); await loadCommunities(); go('community', { communityId: r.communityId }); } }, 'Aceitar convite')]
  });
}
