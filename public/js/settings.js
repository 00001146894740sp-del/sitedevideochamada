import {
  state, api, GET, POST, PATCH, DEL, h, clear, icon, iconBtn, toast, modal, confirmDialog, promptDialog,
  avatar, serverTagEl, field, switchEl, pickFiles, fmtDate, fmtRelative, applyAppearance, copy
} from './core.js';
import { renderRail, logout } from './app.js';
import * as social from './social.js';
import * as chat from './chat.js';

export function openSettings(tab = 'account') {
  const nav = h('nav', { class: 'settings-nav' });
  const mainEl = h('div', { class: 'settings-main' });
  const groups = [
    ['Usuário', [['account', 'key', 'Minha conta'], ['profile', 'user', 'Perfil'], ['privacy', 'lock', 'Privacidade e segurança'], ['devices', 'devices', 'Dispositivos e acessos']]],
    ['Aplicativo', [['notifications', 'bell', 'Notificações'], ['appearance', 'palette', 'Aparência'], ['accessibility', 'eye', 'Acessibilidade e sons']]],
    ['Conteúdo', [['favorites', 'star', 'Mensagens favoritas'], ['stories', 'sparkle', 'Arquivo de stories'], ['files', 'file', 'Meus arquivos'], ['data', 'data', 'Dados pessoais']]]
  ];
  const views = { account, profile, privacy, devices, notifications, appearance, accessibility, favorites, stories, files, data };
  const show = t => {
    nav.querySelectorAll('button[data-k]').forEach(b => b.classList.toggle('on', b.dataset.k === t));
    clear(mainEl); views[t](mainEl);
  };
  for (const [label, items] of groups) {
    nav.appendChild(h('span', { class: 'label' }, label));
    for (const [k, ic, l] of items) nav.appendChild(h('button', { dataset: { k }, onClick: () => show(k) }, icon(ic), l));
  }
  nav.appendChild(h('hr', { class: 'divider' }));
  nav.appendChild(h('button', { style: { color: 'var(--danger)' }, onClick: logout }, icon('logout'), 'Sair'));
  const m = modal({ title: 'Configurações', size: 'xl', body: h('div', { class: 'settings-layout' }, nav, mainEl) });
  m.el.querySelector('.modal-body').style.padding = '0';
  show(tab);
}

async function saveSettings(patch) {
  state.settings = await PATCH('/users/me/settings', patch);
  applyAppearance();
}
async function savePrivacy(patch) {
  state.privacy = await PATCH('/users/me/privacy', patch);
  toast('Privacidade atualizada.', 'ok');
}

// ---------------- Conta ----------------
async function account(el) {
  const me = (await GET('/auth/me')).user;
  el.append(h('h2', null, 'Minha conta'),
    h('div', { class: 'card row' }, avatar(state.me, 64), h('div', { class: 'grow' }, h('b', { style: { fontSize: '1.15em' } }, me.displayName), h('div', { class: 'muted' }, '@' + me.username), h('div', { class: 'faint', style: { fontSize: '.85em' } }, `Conta criada em ${fmtDate(me.createdAt)}`))));

  el.appendChild(h('div', { class: 'card row between' }, h('div', null, h('b', null, 'Selo de verificado'), h('div', { class: 'hint' }, me.verified ? 'Sua conta é verificada ✔' : 'Criadores, figuras conhecidas e parceiros podem pedir o selo.')),
    me.verified ? h('span', { class: 'chip gold' }, '✔ Verificado') : h('button', { class: 'btn sm', onClick: async () => {
      const why = await promptDialog('Por que sua conta deveria ser verificada? Inclua links que comprovem.', { title: 'Pedir verificação', multiline: true, confirmText: 'Enviar pedido' });
      if (!why) return;
      const fd = new FormData(); fd.append('category', 'verificacao'); fd.append('subject', 'Pedido de verificação'); fd.append('description', why.length >= 10 ? why : why + ' (pedido de selo)');
      await api('POST', '/support/tickets', undefined, { form: fd }); toast('Pedido enviado! A equipe vai analisar pela Central de suporte.', 'ok');
    } }, 'Pedir verificação')));
  const un = h('input', { class: 'input', value: me.username, maxlength: 24 });
  el.appendChild(h('div', { class: 'card' }, field('Nome de usuário', un, 'Seu identificador único. Letras, números, _ e ponto.'),
    h('button', { class: 'btn sm primary', onClick: async () => { await PATCH('/users/me', { username: un.value }); state.me.username = un.value; toast('Nome de usuário alterado!', 'ok'); } }, 'Salvar')));

  const em = h('input', { class: 'input', type: 'email', value: me.email || '' });
  const emPw = h('input', { class: 'input', type: 'password', placeholder: 'Senha atual' });
  el.appendChild(h('div', { class: 'card' }, field('E-mail', em, me.email ? (me.emailVerified ? '✓ Verificado' : '⚠ Não verificado') : 'Nenhum e-mail cadastrado.'),
    me.hasPassword ? field('Confirme com sua senha', emPw) : null,
    h('div', { class: 'row' }, h('button', { class: 'btn sm primary', onClick: async () => { const r = await POST('/auth/change-email', { email: em.value, password: emPw.value }); toast(r.message, 'ok'); } }, 'Alterar e-mail'),
      me.email && !me.emailVerified ? h('button', { class: 'btn sm', onClick: async () => { const r = await POST('/auth/resend-verification'); toast(r.message, 'ok'); } }, 'Reenviar verificação') : null)));

  const cur = h('input', { class: 'input', type: 'password', placeholder: 'Senha atual', autocomplete: 'current-password' });
  const nw = h('input', { class: 'input', type: 'password', placeholder: 'Nova senha (mín. 8, letras e números)', autocomplete: 'new-password' });
  const nw2 = h('input', { class: 'input', type: 'password', placeholder: 'Repita a nova senha', autocomplete: 'new-password' });
  el.appendChild(h('div', { class: 'card' }, h('div', { class: 'label', style: { marginBottom: '10px' } }, me.hasPassword ? 'Alterar senha' : 'Definir senha'),
    me.hasPassword ? field('Senha atual', cur) : h('p', { class: 'hint' }, 'Você entrou com Google/Discord. Defina uma senha para também entrar com usuário e senha.'),
    field('Nova senha', nw), field('Confirmar', nw2),
    h('button', { class: 'btn sm primary', onClick: async () => { if (nw.value !== nw2.value) return toast('As senhas não coincidem.', 'error'); const r = await POST('/auth/change-password', { currentPassword: cur.value, newPassword: nw.value }); toast(r.message, 'ok'); cur.value = nw.value = nw2.value = ''; } }, 'Salvar senha')));

  const prov = (name, label, linked) => h('div', { class: 'toggle-row' }, h('span', null, label, linked ? h('span', { class: 'chip green', style: { marginLeft: '8px' } }, 'Vinculado') : null),
    linked ? h('button', { class: 'btn sm danger', onClick: async () => { await POST(`/auth/oauth/${name}/unlink`); toast('Desvinculado.', 'ok'); clear(el); account(el); } }, 'Desvincular')
      : state.config[name] ? h('a', { class: 'btn sm', href: `/api/auth/oauth/${name}?link=1` }, 'Vincular') : h('small', { class: 'faint' }, 'Indisponível no servidor'));
  el.appendChild(h('div', { class: 'card' }, h('div', { class: 'label' }, 'Contas conectadas'), prov('discord', '🎮 Discord', me.discord), prov('google', '🔎 Google', me.google)));

  if (state.config.ownerClaimAvailable && me.role !== 'owner') {
    const tk = h('input', { class: 'input', type: 'password', placeholder: 'OWNER_SETUP_TOKEN' });
    el.appendChild(h('div', { class: 'card' }, h('div', { class: 'label' }, 'Configuração inicial da plataforma'), h('p', { class: 'hint' }, 'Se você é o responsável por esta instalação e ainda não existe um dono, informe o token de configuração definido no servidor.'),
      h('div', { class: 'row' }, tk, h('button', { class: 'btn gold', onClick: async () => { const r = await POST('/auth/claim-owner', { token: tk.value }); toast(r.message, 'gold'); setTimeout(() => location.reload(), 900); } }, 'Tornar-me dono'))));
  }
}

// ---------------- Perfil ----------------
function profile(el) {
  const me = state.me;
  const dn = h('input', { class: 'input', value: me.displayName, maxlength: 40 });
  const st = h('input', { class: 'input', value: me.customStatus || '', maxlength: 80, placeholder: 'Ex.: 🎮 Jogando ranked' });
  const bio = h('textarea', { class: 'textarea', value: me.bio || '', maxlength: 500, placeholder: 'Conte um pouco sobre você. Suporta *negrito*, _itálico_ e links.' });
  let color = me.color || '#8b2cff';
  const colors = ['#8b2cff', '#ff4dd8', '#4d7cff', '#2ec5d3', '#3ddc97', '#f5c542', '#ff8a3d', '#ff4d6d'];
  const dots = h('div', { class: 'color-dots' }, colors.map(c => h('button', { class: `color-dot ${c === color ? 'on' : ''}`, style: { background: c }, onClick: e => { color = c; dots.querySelectorAll('.color-dot').forEach(x => x.classList.remove('on')); e.currentTarget.classList.add('on'); } })));
  const links = (me.links || []).map(l => ({ ...l }));
  const linksBox = h('div', { class: 'stack' });
  const drawLinks = () => {
    clear(linksBox);
    links.forEach((l, i) => {
      const lab = h('input', { class: 'input', value: l.label, placeholder: 'Rótulo', maxlength: 30, style: { maxWidth: '160px' } });
      const url = h('input', { class: 'input', value: l.url, placeholder: 'https://…' });
      lab.addEventListener('input', () => { l.label = lab.value; }); url.addEventListener('input', () => { l.url = url.value; });
      linksBox.appendChild(h('div', { class: 'row' }, lab, url, iconBtn('trash', 'Remover', () => { links.splice(i, 1); drawLinks(); }, 'danger')));
    });
    if (links.length < 6) linksBox.appendChild(h('button', { class: 'btn sm', onClick: () => { links.push({ label: '', url: '' }); drawLinks(); } }, icon('plus', 14), 'Adicionar link'));
  };
  drawLinks();
  const upload = kind => async () => {
    const [f] = await pickFiles({ accept: 'image/*' });
    if (!f) return;
    const fd = new FormData(); fd.append('file', f);
    const r = await api('POST', `/users/me/${kind}`, undefined, { form: fd });
    state.me[kind] = r.url; toast('Imagem atualizada!', 'ok'); renderRail(); clear(el); profile(el);
  };
  el.append(h('h2', null, 'Perfil'),
    h('div', { class: 'profile-preview', style: { marginBottom: '16px' } },
      h('div', { class: 'cover', style: me.banner ? { backgroundImage: `url("${me.banner}")` } : null }),
      h('div', { class: 'row', style: { padding: '0 16px 14px', marginTop: '-34px', alignItems: 'flex-end' } }, h('div', { style: { border: '5px solid var(--panel)', borderRadius: '50%' } }, avatar(me, 80)),
        h('div', { class: 'row wrap grow', style: { justifyContent: 'flex-end' } },
          h('button', { class: 'btn sm', onClick: upload('avatar') }, icon('image', 15), 'Foto'),
          me.avatar ? h('button', { class: 'btn sm ghost', onClick: async () => { await DEL('/users/me/avatar'); state.me.avatar = null; renderRail(); clear(el); profile(el); } }, 'Remover') : null,
          h('button', { class: 'btn sm', onClick: upload('banner') }, icon('image', 15), 'Banner'),
          me.banner ? h('button', { class: 'btn sm ghost', onClick: async () => { await DEL('/users/me/banner'); state.me.banner = null; clear(el); profile(el); } }, 'Remover') : null))),
    field('Nome de exibição', dn), field('Status personalizado', st), field('Biografia', bio),
    tagPicker(),
    h('div', { class: 'label', style: { marginBottom: '8px' } }, 'Cor do perfil'), dots, h('div', { style: { height: '14px' } }),
    h('div', { class: 'label', style: { marginBottom: '8px' } }, 'Links sociais'), linksBox,
    h('button', { class: 'btn primary', style: { marginTop: '18px' }, onClick: async () => {
      const u = await PATCH('/users/me', { displayName: dn.value, customStatus: st.value, bio: bio.value, profileColor: color, links: links.filter(l => l.url) });
      Object.assign(state.me, u); renderRail(); toast('Perfil salvo!', 'ok');
    } }, 'Salvar perfil'),
    h('button', { class: 'btn ghost', style: { marginTop: '18px', marginLeft: '8px' }, onClick: () => social.openProfile(state.me.id) }, 'Ver como os outros veem'));
}

// ---------------- Privacidade ----------------
function privacy(el) {
  const p = state.privacy;
  const sel = (key, opts) => { const s = h('select', { class: 'select', style: { maxWidth: '240px' } }, opts.map(([v, l]) => h('option', { value: v }, l))); s.value = p[key]; s.addEventListener('change', () => savePrivacy({ [key]: s.value })); return s; };
  const row = (title, hint, ctl) => h('div', { class: 'toggle-row' }, h('div', null, h('b', null, title), hint ? h('div', { class: 'hint' }, hint) : null), ctl);
  el.append(h('h2', null, 'Privacidade e segurança'),
    h('div', { class: 'card' },
      row('Quem pode me enviar mensagens', 'Vale para novas conversas privadas.', sel('whoCanMessage', [['everyone', 'Todos'], ['friends', 'Somente amigos'], ['nobody', 'Ninguém']])),
      row('Quem pode me adicionar como amigo', null, sel('whoCanAdd', [['everyone', 'Todos'], ['friends_of_friends', 'Amigos de amigos'], ['nobody', 'Ninguém']])),
      row('Visibilidade do perfil', 'Bio, banner, links e insígnias.', sel('profileVisibility', [['everyone', 'Todos'], ['friends', 'Somente amigos']])),
      row('Mostrar quando estou online', 'Desativando, você aparece offline para todos.', switchEl(p.showOnline, v => savePrivacy({ showOnline: v }))),
      row('Confirmações de leitura', 'Se desativar, você também não verá quando os outros leram suas mensagens.', switchEl(p.readReceipts, v => savePrivacy({ readReceipts: v }))),
      row('Mostrar histórico de atividades no perfil', null, switchEl(p.activityVisible, v => savePrivacy({ activityVisible: v })))),
    h('div', { class: 'card' }, h('div', { class: 'row between' }, h('div', null, h('b', null, 'Usuários bloqueados'), h('div', { class: 'hint' }, 'Gerencie quem você bloqueou.')),
      h('button', { class: 'btn sm', onClick: async () => { document.querySelector('.modal-back')?.remove(); const app = await import('./app.js'); app.go('friends'); social.renderFriendsPage('blocked'); } }, 'Abrir lista'))),
    h('div', { class: 'card' }, h('b', null, '🔒 Sobre a segurança das suas mensagens'),
      h('p', { class: 'muted', style: { margin: '6px 0 0' } }, 'As mensagens trafegam criptografadas entre seu dispositivo e o servidor (HTTPS/WSS) e ficam armazenadas no servidor com controle de acesso — somente participantes da conversa conseguem lê-las. O NEW GG não utiliza criptografia de ponta a ponta neste momento.')));
}

// ---------------- Dispositivos ----------------
async function devices(el) {
  el.append(h('h2', null, 'Dispositivos e acessos'), h('div', { class: 'spinner' }));
  const [sessions, history] = await Promise.all([GET('/auth/sessions'), GET('/auth/history')]);
  el.lastChild.remove();
  const ua = s => { const u = s || ''; const b = /Edg/.test(u) ? 'Edge' : /Chrome/.test(u) ? 'Chrome' : /Firefox/.test(u) ? 'Firefox' : /Safari/.test(u) ? 'Safari' : 'Navegador'; const o = /Windows/.test(u) ? 'Windows' : /Android/.test(u) ? 'Android' : /iPhone|iPad/.test(u) ? 'iOS' : /Mac/.test(u) ? 'macOS' : /Linux/.test(u) ? 'Linux' : ''; return `${b}${o ? ' · ' + o : ''}`; };
  el.appendChild(h('div', { class: 'row between', style: { marginBottom: '10px' } }, h('span', { class: 'label' }, `Sessões ativas (${sessions.length})`),
    sessions.length > 1 ? h('button', { class: 'btn sm danger', onClick: async () => { const r = await POST('/auth/sessions/revoke-others'); toast(`${r.revoked} sessão(ões) encerrada(s).`, 'ok'); clear(el); devices(el); } }, 'Encerrar todas as outras') : null));
  for (const s of sessions) {
    el.appendChild(h('div', { class: 'card row' }, h('div', { class: 'avatar', style: { width: '42px', height: '42px', background: 'rgba(var(--accent-rgb),.18)', color: 'var(--accent-2)' } }, icon('devices', 20)),
      h('div', { class: 'grow' }, h('b', null, ua(s.userAgent), s.current ? h('span', { class: 'chip green', style: { marginLeft: '8px' } }, 'Este dispositivo') : null), h('div', { class: 'hint' }, `IP ${s.ip || '—'} · ativo ${fmtRelative(s.lastSeenAt)} · desde ${fmtDate(s.createdAt)}`)),
      !s.current ? h('button', { class: 'btn sm danger', onClick: async () => { await DEL(`/auth/sessions/${s.id}`); toast('Sessão encerrada.', 'ok'); clear(el); devices(el); } }, 'Encerrar') : null));
  }
  const method = { password: 'Senha', register: 'Cadastro', google: 'Google', discord: 'Discord', password_reset: 'Redefinição de senha' };
  const tbl = h('table', { class: 'tbl' }, h('tr', null, h('th', null, 'Data'), h('th', null, 'Método'), h('th', null, 'Resultado'), h('th', null, 'IP'), h('th', null, 'Dispositivo')));
  for (const x of history) tbl.appendChild(h('tr', null, h('td', null, fmtDate(x.created_at)), h('td', null, method[x.method] || x.method), h('td', null, x.success ? h('span', { class: 'chip green' }, 'Sucesso') : h('span', { class: 'chip red' }, 'Falhou')), h('td', null, x.ip || '—'), h('td', null, ua(x.user_agent))));
  el.append(h('div', { class: 'label', style: { margin: '20px 0 8px' } }, 'Histórico de acessos'), h('div', { style: { overflowX: 'auto' } }, tbl));
}

// ---------------- Notificações ----------------
function notifications(el) {
  const n = state.settings.notifications;
  const items = [['messages', 'Novas mensagens', 'Som, alerta e notificação do navegador para mensagens.'], ['mentions', 'Menções', 'Quando alguém marcar você com @.'], ['replies', 'Respostas', 'Respostas às suas mensagens e stories.'], ['reactions', 'Reações'], ['friendRequests', 'Solicitações de amizade'], ['calls', 'Chamadas recebidas'], ['groupInvites', 'Convites para grupos'], ['communityInvites', 'Convites para comunidades'], ['admin', 'Avisos administrativos', 'Comunicados importantes sempre são entregues.']];
  el.append(h('h2', null, 'Notificações'),
    h('div', { class: 'card' }, items.map(([k, label, hint]) => h('div', { class: 'toggle-row' }, h('div', null, h('b', null, label), hint ? h('div', { class: 'hint' }, hint) : null), switchEl(n[k], v => saveSettings({ notifications: { [k]: v } }).then(() => toast('Preferência salva.', 'ok')))))),
    h('div', { class: 'card row between' }, h('div', null, h('b', null, 'Notificações do navegador'), h('div', { class: 'hint' }, 'Status: ' + ('Notification' in window ? { granted: 'permitidas', denied: 'bloqueadas no navegador', default: 'não configuradas' }[Notification.permission] : 'não suportadas'))),
      h('button', { class: 'btn sm', onClick: () => Notification.requestPermission().then(p => toast(p === 'granted' ? 'Notificações ativadas!' : 'Permissão não concedida.', p === 'granted' ? 'ok' : 'error')) }, 'Permitir')));
}

// ---------------- Aparência ----------------
function appearance(el) {
  const s = state.settings;
  const themes = [['dark', 'Noite violeta'], ['midnight', 'Meia-noite'], ['light', 'Claro']];
  const accents = ['#9d4dff', '#c026d3', '#ff4dd8', '#4d7cff', '#06b6d4', '#10b981', '#f5c542', '#ff6b3d'];
  const bgs = [['aurora', 'Aurora'], ['nebula', 'Nebulosa'], ['grid', 'Grade'], ['gold', 'Dourado'], ['plain', 'Liso']];
  const redraw = () => { clear(el); appearance(el); };
  el.append(h('h2', null, 'Aparência'),
    h('div', { class: 'label', style: { marginBottom: '8px' } }, 'Tema'),
    h('div', { class: 'row wrap', style: { marginBottom: '18px' } }, themes.map(([v, l]) => h('button', { class: `btn ${s.theme === v ? 'primary' : ''}`, onClick: async () => { await saveSettings({ theme: v }); redraw(); } }, l))),
    h('div', { class: 'label', style: { marginBottom: '8px' } }, 'Cor de destaque'),
    h('div', { class: 'color-dots', style: { marginBottom: '18px' } }, accents.map(c => h('button', { class: `color-dot ${s.accent === c ? 'on' : ''}`, style: { background: c }, title: c, onClick: async () => { await saveSettings({ accent: c }); redraw(); } }))),
    h('div', { class: 'label', style: { marginBottom: '8px' } }, 'Plano de fundo das conversas'),
    h('div', { class: 'bg-options', style: { marginBottom: '18px' } }, bgs.map(([v, l]) => h('button', { class: `bg-opt chat-bg-${v} ${s.chatBg === v ? 'on' : ''}`, onClick: async () => { await saveSettings({ chatBg: v }); redraw(); chat.resyncOpen(); } }, l))),
    h('div', { class: 'label', style: { marginBottom: '8px' } }, 'Aparência das mensagens'),
    h('div', { class: 'row wrap' }, [['rounded', 'Arredondadas'], ['square', 'Retas'], ['minimal', 'Minimalistas']].map(([v, l]) => h('button', { class: `btn ${s.bubbleStyle === v ? 'primary' : ''}`, onClick: async () => { await saveSettings({ bubbleStyle: v }); redraw(); } }, l))),
    h('div', { class: 'card', style: { marginTop: '18px' } }, h('div', { class: 'msg mine', style: { animation: 'none' } }, h('div', { class: 'body' }, h('div', { class: 'bubble' }, 'Assim ficam suas mensagens ✨'))),
      h('div', { class: 'msg', style: { animation: 'none' } }, h('div', { class: 'body' }, h('div', { class: 'bubble' }, 'E assim as dos outros!')))));
}

function accessibility(el) {
  const s = state.settings;
  const range = h('input', { type: 'range', min: '0.8', max: '1.4', step: '0.05', value: s.fontScale, style: { width: '100%' } });
  const lbl = h('b', null, `${Math.round(s.fontScale * 100)}%`);
  range.addEventListener('input', () => { lbl.textContent = `${Math.round(range.value * 100)}%`; document.documentElement.style.setProperty('--scale', range.value); });
  range.addEventListener('change', () => saveSettings({ fontScale: Number(range.value) }));
  el.append(h('h2', null, 'Acessibilidade e sons'),
    h('div', { class: 'card' }, h('div', { class: 'row between' }, h('span', { class: 'label' }, 'Tamanho da interface'), lbl), range),
    h('div', { class: 'card' },
      h('div', { class: 'toggle-row' }, h('div', null, h('b', null, 'Reduzir movimento'), h('div', { class: 'hint' }, 'Desativa animações e transições.')), switchEl(s.reduceMotion, v => saveSettings({ reduceMotion: v }))),
      h('div', { class: 'toggle-row' }, h('div', null, h('b', null, 'Alto contraste'), h('div', { class: 'hint' }, 'Aumenta o contraste de textos secundários e bordas.')), switchEl(s.highContrast, v => saveSettings({ highContrast: v }))),
      h('div', { class: 'toggle-row' }, h('div', null, h('b', null, 'Sons'), h('div', { class: 'hint' }, 'Sons de mensagens, notificações e chamadas.')), switchEl(s.sounds, v => saveSettings({ sounds: v })))));
}

// ---------------- Conteúdo ----------------
async function favorites(el) {
  el.append(h('h2', null, 'Mensagens favoritas'), h('div', { class: 'spinner' }));
  const list = await GET('/favorites');
  el.lastChild.remove();
  if (!list.length) return el.appendChild(h('div', { class: 'empty' }, h('span', { class: 'spark' }, '★'), 'Favorite mensagens pelo menu da mensagem para encontrá-las aqui.'));
  for (const m of list) el.appendChild(h('div', { class: 'card', style: { cursor: 'pointer' }, onClick: () => { document.querySelectorAll('.modal-back').forEach(x => x.remove()); chat.openChat(m.conversationId, { highlight: m.id }); } },
    h('div', { class: 'row' }, avatar(m.sender || {}, 28), h('b', null, m.sender?.displayName || ''), h('small', { class: 'faint' }, fmtDate(m.createdAt))),
    h('p', { style: { margin: '8px 0 0', whiteSpace: 'pre-wrap' } }, m.content || (m.attachments.length ? `📎 ${m.attachments.map(a => a.name).join(', ')}` : '[mídia]'))));
}
function stories(el) {
  el.append(h('h2', null, 'Stories'), h('p', { class: 'muted' }, 'Publique um story ou veja o arquivo com todos os que você já postou.'),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onClick: social.openStoryComposer }, icon('plus', 16), 'Novo story'), h('button', { class: 'btn', onClick: social.openStoryArchive }, icon('archive', 16), 'Abrir arquivo')));
}
async function files(el) {
  el.append(h('h2', null, 'Meus arquivos'), h('p', { class: 'muted' }, 'Arquivos que você enviou em conversas e stories. Ao excluir, eles deixam de estar disponíveis para todos.'), h('div', { class: 'spinner' }));
  const list = await GET('/files');
  el.lastChild.remove();
  if (!list.length) return el.appendChild(h('div', { class: 'empty' }, 'Nenhum arquivo enviado.'));
  const tbl = h('table', { class: 'tbl' }, h('tr', null, h('th', null, 'Arquivo'), h('th', null, 'Tipo'), h('th', null, 'Tamanho'), h('th', null, 'Enviado'), h('th')));
  for (const f of list) tbl.appendChild(h('tr', null, h('td', null, h('a', { href: f.url + '?download=1' }, f.name)), h('td', null, f.kind), h('td', null, `${(f.size / 1024).toFixed(0)} KB`), h('td', null, fmtRelative(f.createdAt)),
    h('td', null, iconBtn('trash', 'Excluir', async () => { if (await confirmDialog(`Excluir ${f.name}?`, { danger: true, confirmText: 'Excluir' })) { await DEL(`/files/${f.id}`); clear(el); files(el); } }, 'danger'))));
  el.appendChild(h('div', { style: { overflowX: 'auto' } }, tbl));
}
function data(el) {
  const me = state.me;
  const pw = h('input', { class: 'input', type: 'password', placeholder: me.hasPassword === false ? `Digite ${me.username}` : 'Sua senha' });
  el.append(h('h2', null, 'Dados pessoais'),
    h('div', { class: 'card' }, h('b', null, 'Baixar meus dados'), h('p', { class: 'muted' }, 'Gera um arquivo JSON com seu perfil, amigos, mensagens enviadas, sessões e histórico de acessos.'),
      h('a', { class: 'btn', href: '/api/users/me/export' }, icon('download', 16), 'Baixar dados')),
    h('div', { class: 'card', style: { borderColor: 'rgba(255,77,109,.4)' } }, h('b', { style: { color: 'var(--danger)' } }, 'Excluir minha conta'),
      h('p', { class: 'muted' }, 'Sua conta será anonimizada após 7 dias: perfil, amizades, stories e arquivos são removidos. Você pode cancelar durante esse período.'),
      me.deletionRequestedAt ? h('button', { class: 'btn', onClick: async () => { await POST('/users/me/delete-cancel'); toast('Exclusão cancelada.', 'ok'); setTimeout(() => location.reload(), 600); } }, 'Cancelar exclusão agendada')
        : h('div', { class: 'row' }, pw, h('button', { class: 'btn danger', onClick: async () => {
          if (!await confirmDialog('Tem certeza? Após 7 dias não será possível recuperar a conta.', { danger: true, confirmText: 'Solicitar exclusão' })) return;
          const r = await POST('/users/me/delete-request', { password: pw.value, confirm: pw.value }); toast(r.message, 'ok'); setTimeout(() => location.reload(), 1200);
        } }, 'Solicitar exclusão'))));
  void copy;
}

function tagPicker() {
  const box = h('div', { class: 'card' }, h('div', { class: 'label', style: { marginBottom: '8px' } }, 'Tag de servidor'), h('div', { class: 'spinner' }));
  GET('/users/me/server-tags').then(list => {
    box.lastChild.remove();
    if (!list.length) return box.appendChild(h('p', { class: 'hint', style: { margin: 0 } }, 'Nenhuma comunidade sua tem tag ainda. Comunidades impulsionadas podem ganhar uma tag de 3 letras (ex.: #CPX).'));
    const row = h('div', { class: 'row wrap' });
    const pick = async id => { const r = await POST('/users/me/server-tag', { communityId: id }); state.me.tag = r.tag; renderRail(); toast(id ? 'Tag atualizada!' : 'Tag removida.', 'ok'); draw(); };
    const draw = () => {
      clear(row);
      row.appendChild(h('button', { class: `btn sm ${!state.me.tag ? 'primary' : ''}`, onClick: () => pick(null) }, 'Nenhuma'));
      for (const t of list) row.appendChild(h('button', { class: `btn sm ${state.me.tag?.communityId === t.communityId ? 'primary' : ''}`, onClick: () => pick(t.communityId), title: t.name }, serverTagEl({ ...t.tag, community: t.name }), ' ', t.name));
    };
    draw(); box.appendChild(row);
  });
  return box;
}
