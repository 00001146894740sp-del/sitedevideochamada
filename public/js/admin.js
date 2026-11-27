import {
  state, on, api, GET, POST, PATCH, DEL, h, clear, icon, iconBtn, toast, modal, menu, confirmDialog, promptDialog,
  avatar, roleMark, fmtDate, fmtRelative, fmtSize, field, switchEl, tabs, pickFiles, lightbox, ROLE_LABEL
} from './core.js';
import * as social from './social.js';

const RANK = { user: 0, support: 1, moderator: 2, admin: 3, owner: 4 };
const myRank = () => RANK[state.me.role] || 0;
const REASON = { spam: 'Spam', assedio: 'Assédio', odio: 'Discurso de ódio', violencia: 'Violência', conteudo_sexual: 'Conteúdo sexual', golpe: 'Golpe', falsidade: 'Falsidade', outro: 'Outro' };
const STATUS_CHIP = s => ({ active: h('span', { class: 'chip green' }, 'Ativa'), suspended: h('span', { class: 'chip gold' }, 'Suspensa'), banned: h('span', { class: 'chip red' }, 'Banida'), deleted: h('span', { class: 'chip' }, 'Excluída') }[s] || s);

// ===================== PAINEL ADMINISTRATIVO =====================
export function openAdmin(tab = 'dash') {
  const nav = h('nav', { class: 'settings-nav' });
  const mainEl = h('div', { class: 'settings-main' });
  const items = [
    ['dash', 'chart', 'Visão geral', 1], ['users', 'users', 'Usuários', 1], ['reports', 'flag', 'Denúncias', 1], ['tickets', 'support', 'Atendimento', 1],
    ['communities', 'planet', 'Comunidades', 1], ['groups', 'group', 'Grupos', 1], ['announcements', 'megaphone', 'Comunicados', 1],
    ['logs', 'history', 'Registros', 3], ['settings', 'cog', 'Configurações gerais', 3]
  ].filter(i => myRank() >= i[3]);
  const views = { dash, users, reports, tickets, communities, groups, announcements, logs, settings };
  const show = t => { nav.querySelectorAll('button[data-k]').forEach(b => b.classList.toggle('on', b.dataset.k === t)); clear(mainEl); views[t](mainEl); };
  nav.appendChild(h('span', { class: 'label' }, `Nível: ${ROLE_LABEL[state.me.role]}`));
  for (const [k, ic, l] of items) nav.appendChild(h('button', { dataset: { k }, onClick: () => show(k) }, icon(ic), l));
  const m = modal({ title: '🛡️ Administração NEW GG', size: 'xl', body: h('div', { class: 'settings-layout' }, nav, mainEl) });
  m.el.querySelector('.modal-body').style.padding = '0';
  show(tab);
}

async function dash(el) {
  el.append(h('h2', null, 'Visão geral'), h('div', { class: 'spinner' }));
  const s = await GET('/admin/stats');
  el.lastChild.remove();
  const stat = (n, l) => h('div', { class: 'stat' }, h('b', null, typeof n === 'number' ? n.toLocaleString('pt-BR') : n), h('span', null, l));
  el.append(h('div', { class: 'stat-grid' },
    stat(s.users, 'Usuários'), stat(s.users_today, 'Novos hoje'), stat(s.active_today, 'Ativos (24h)'), stat(s.online_connections, 'Conexões agora'),
    stat(s.messages, 'Mensagens'), stat(s.messages_today, 'Mensagens hoje'), stat(s.groups, 'Grupos'), stat(s.communities, 'Comunidades'),
    stat(s.open_reports, 'Denúncias abertas'), stat(s.open_tickets, 'Chamados abertos'), stat(s.calls_today, 'Chamadas hoje'), stat(fmtSize(s.storage_bytes), 'Armazenamento'),
    stat(s.suspended, 'Suspensos'), stat(s.banned, 'Banidos')));
  const chart = (key, title) => {
    const max = Math.max(1, ...s.daily.map(d => d[key]));
    return h('div', { class: 'card' }, h('div', { class: 'label' }, title), h('div', { class: 'bars' }, s.daily.map(d => h('div', { title: `${d.day}: ${d[key]}` }, h('small', null, d[key] || ''), h('i', { style: { height: `${(d[key] / max) * 100}%` } }), d.day.slice(0, 2)))));
  };
  el.append(chart('signups', 'Cadastros — últimos 14 dias'), chart('messages', 'Mensagens — últimos 14 dias'));
}

async function users(el) {
  const q = h('input', { class: 'input', placeholder: 'Buscar por nome, usuário, e-mail ou ID' });
  const status = h('select', { class: 'select', style: { maxWidth: '160px' } }, [['all', 'Todos os status'], ['active', 'Ativos'], ['suspended', 'Suspensos'], ['banned', 'Banidos'], ['deleted', 'Excluídos']].map(([v, l]) => h('option', { value: v }, l)));
  const role = h('select', { class: 'select', style: { maxWidth: '160px' } }, [['all', 'Todos os níveis'], ['owner', 'Dono'], ['admin', 'Admin'], ['moderator', 'Moderador'], ['support', 'Suporte'], ['user', 'Usuário']].map(([v, l]) => h('option', { value: v }, l)));
  const out = h('div');
  let page = 1;
  el.append(h('h2', null, 'Usuários'), h('div', { class: 'row wrap' }, h('div', { class: 'search-box grow' }, icon('search'), q), status, role), out);
  const load = async () => {
    clear(out).appendChild(h('div', { class: 'spinner' }));
    const r = await GET(`/admin/users?q=${encodeURIComponent(q.value)}&status=${status.value}&role=${role.value}&page=${page}`);
    clear(out);
    const tbl = h('table', { class: 'tbl', style: { marginTop: '12px' } }, h('tr', null, h('th', null, 'Usuário'), h('th', null, 'E-mail'), h('th', null, 'Nível'), h('th', null, 'Status'), h('th', null, 'Criado'), h('th')));
    for (const u of r.users) {
      tbl.appendChild(h('tr', { style: { cursor: 'pointer' }, onClick: () => userDetail(u.id, load) },
        h('td', null, h('div', { class: 'row' }, avatar(u, 30), h('div', null, h('b', null, u.displayName, ' ', roleMark(u.role)), h('div', { class: 'faint' }, `@${u.username} · #${u.id}`)))),
        h('td', null, u.email || '—', u.email && !u.emailVerified ? h('small', { class: 'faint' }, ' (não verif.)') : null),
        h('td', null, ROLE_LABEL[u.role]), h('td', null, STATUS_CHIP(u.status), u.suspendedUntil ? h('div', { class: 'faint', style: { fontSize: '.8em' } }, `até ${fmtDate(u.suspendedUntil)}`) : null),
        h('td', null, fmtDate(u.createdAt)), h('td', null, iconBtn('more', 'Ações', e => { e.stopPropagation(); userActions(e, u, load); }))));
    }
    out.append(tbl, h('div', { class: 'row between', style: { marginTop: '12px' } }, h('span', { class: 'faint' }, `${r.total} usuário(s) · página ${page}`),
      h('div', { class: 'row' }, h('button', { class: 'btn sm', disabled: page <= 1, onClick: () => { page--; load(); } }, '← Anterior'), h('button', { class: 'btn sm', disabled: page * 50 >= r.total, onClick: () => { page++; load(); } }, 'Próxima →'))));
  };
  let t; q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { page = 1; load(); }, 300); });
  status.addEventListener('change', () => { page = 1; load(); }); role.addEventListener('change', () => { page = 1; load(); });
  load();
}

function userActions(e, u, reload) {
  const above = myRank() > RANK[u.role] && u.role !== 'owner' && u.id !== state.me.id;
  menu(e, [
    { icon: 'user', label: 'Ver perfil público', onClick: () => social.openProfile(u.id) },
    { icon: 'info', label: 'Detalhes administrativos', onClick: () => userDetail(u.id, reload) },
    above && myRank() >= 2 && u.status === 'active' ? { icon: 'mute', label: 'Suspender', onClick: () => suspend(u, reload) } : null,
    above && myRank() >= 3 && u.status !== 'banned' ? { icon: 'block', label: 'Banir', danger: true, onClick: () => ban(u, reload) } : null,
    above && myRank() >= 2 && ['suspended', 'banned'].includes(u.status) ? { icon: 'check', label: u.status === 'banned' ? 'Desbanir' : 'Remover suspensão', onClick: async () => { await POST(`/admin/users/${u.id}/unban`); toast('Conta reativada.', 'ok'); reload(); } } : null,
    above && myRank() >= 2 ? { icon: 'logout', label: 'Encerrar todas as sessões', onClick: async () => { await POST(`/admin/users/${u.id}/logout-all`); toast('Sessões encerradas.', 'ok'); } } : null,
    above && myRank() >= 3 ? { icon: 'shield', label: 'Alterar nível de acesso', onClick: () => changeRole(u, reload) } : null
  ]);
}
async function suspend(u, reload) {
  const hours = h('select', { class: 'select' }, [[1, '1 hora'], [24, '1 dia'], [72, '3 dias'], [168, '7 dias'], [720, '30 dias']].map(([v, l]) => h('option', { value: v }, l)));
  const reason = h('textarea', { class: 'textarea', placeholder: 'Motivo (visível para o usuário)' });
  const m = modal({ title: `Suspender ${u.displayName}`, body: h('div', null, field('Duração', hours), field('Motivo', reason)),
    foot: [h('button', { class: 'btn ghost', onClick: () => m.close() }, 'Cancelar'), h('button', { class: 'btn danger', onClick: async () => { await POST(`/admin/users/${u.id}/suspend`, { hours: Number(hours.value), reason: reason.value }); m.close(); toast('Usuário suspenso.', 'ok'); reload?.(); } }, 'Suspender')] });
}
async function ban(u, reload) {
  const reason = await promptDialog('Motivo do banimento (visível para o usuário)', { title: `Banir ${u.displayName}`, multiline: true, confirmText: 'Banir permanentemente' });
  if (reason === null) return;
  await POST(`/admin/users/${u.id}/ban`, { reason }); toast('Usuário banido.', 'ok'); reload?.();
}
function changeRole(u, reload) {
  const opts = [['user', 'Usuário'], ['support', 'Suporte'], ['moderator', 'Moderador'], ['admin', 'Administrador']].filter(([v]) => RANK[v] < myRank());
  const sel = h('select', { class: 'select' }, opts.map(([v, l]) => h('option', { value: v }, l)));
  sel.value = u.role;
  const m = modal({ title: `Nível de acesso de ${u.displayName}`, body: h('div', null, field('Nível', sel), h('p', { class: 'hint' }, 'Você só pode conceder níveis abaixo do seu. O dono não pode perder o acesso por ação de outros administradores.')),
    foot: [h('button', { class: 'btn primary', onClick: async () => { await PATCH(`/admin/users/${u.id}/role`, { role: sel.value }); m.close(); toast('Nível atualizado.', 'ok'); reload?.(); } }, 'Salvar')] });
}
async function userDetail(id, reload) {
  const body = h('div', null, h('div', { class: 'spinner' }));
  const m = modal({ title: 'Detalhes do usuário', size: 'wide', body });
  const u = await GET(`/admin/users/${id}`);
  const badges = await GET('/admin/badges');
  clear(body);
  body.append(
    h('div', { class: 'card row' }, avatar(u, 64), h('div', { class: 'grow' }, h('b', { style: { fontSize: '1.2em' } }, u.displayName, ' ', roleMark(u.role)), h('div', { class: 'muted' }, `@${u.username} · #${u.id} · ${u.email || 'sem e-mail'}`),
      h('div', { class: 'row', style: { marginTop: '6px' } }, STATUS_CHIP(u.status), h('span', { class: 'chip' }, ROLE_LABEL[u.role]), h('span', { class: 'chip' }, `${u.counts.messages} mensagens`), h('span', { class: 'chip' }, `${u.counts.friends} amigos`), h('span', { class: 'chip' }, `${u.activeSessions} sessões`)),
      u.statusReason ? h('p', { class: 'hint' }, `Motivo: ${u.statusReason}`) : null),
    iconBtn('more', 'Ações', e => userActions(e, u, () => { m.close(); reload?.(); }))),
    u.bio ? h('div', { class: 'card' }, h('div', { class: 'label' }, 'Bio'), h('p', null, u.bio)) : null,
    myRank() >= 3 ? h('div', { class: 'card' }, h('div', { class: 'label', style: { marginBottom: '8px' } }, 'Insígnias'),
      h('div', { class: 'row wrap' }, badges.map(b => { const has = u.badges.includes(b.code); return h('button', { class: `badge ${b.special ? 'special' : ''}`, style: { opacity: has ? 1 : 0.45, cursor: 'pointer' }, title: has ? 'Clique para remover' : 'Clique para conceder', onClick: async () => { if (has) await DEL(`/admin/users/${u.id}/badges/${b.code}`); else await POST(`/admin/users/${u.id}/badges`, { code: b.code }); m.close(); userDetail(id, reload); } }, b.icon, b.name); }))) : null,
    myRank() >= 2 && u.avatar ? h('button', { class: 'btn sm danger', onClick: async () => { await DEL(`/admin/users/${u.id}/avatar`); toast('Foto e banner removidos.', 'ok'); } }, 'Remover foto/banner impróprios') : null,
    u.bans.length ? h('div', { class: 'card' }, h('div', { class: 'label' }, 'Histórico de punições'), u.bans.map(b => h('div', { class: 'toggle-row' }, h('span', null, `${b.type === 'ban' ? 'Banimento' : 'Suspensão'} por ${b.actor || '—'}: ${b.reason || ''}`), h('small', { class: 'faint' }, `${fmtDate(b.created_at)}${b.lifted_at ? ' · revogado' : ''}`)))) : null,
    u.logins.length ? h('div', { class: 'card' }, h('div', { class: 'label' }, 'Acessos recentes'), u.logins.map(l => h('div', { class: 'toggle-row' }, h('span', null, `${l.method} · ${l.success ? '✓' : '✗'} · ${l.ip || ''}`), h('small', { class: 'faint' }, fmtDate(l.created_at))))) : null);
}

async function reports(el) {
  let status = 'open';
  const out = h('div');
  el.append(h('h2', null, 'Denúncias'), tabs([['open', 'Abertas'], ['reviewing', 'Em análise'], ['resolved', 'Resolvidas'], ['dismissed', 'Descartadas'], ['all', 'Todas']], 'open', s => { status = s; load(); }), out);
  const load = async () => {
    clear(out).appendChild(h('div', { class: 'spinner' }));
    const list = await GET(`/admin/reports?status=${status}`);
    clear(out);
    if (!list.length) return out.appendChild(h('div', { class: 'empty' }, h('span', { class: 'spark' }, '✦'), 'Nenhuma denúncia aqui.'));
    for (const r of list) {
      const t = r.target;
      let preview = null; let actions = [];
      if (r.targetType === 'message' && t) {
        preview = h('div', { class: 'reply-quote' }, h('b', null, `${t.sender?.displayName || '—'} em ${t.convType === 'dm' ? 'conversa privada' : t.convType === 'group' ? `grupo ${t.convName}` : `#${t.convName}`}`),
          h('span', { style: { whiteSpace: 'pre-wrap' } }, t.deleted ? '(apagada)' : t.content || ''), t.attachments?.length ? h('div', { class: 'row wrap', style: { marginTop: '6px' } }, t.attachments.map(a => a.kind === 'image' ? h('img', { src: a.url, style: { width: '80px', height: '80px', objectFit: 'cover', borderRadius: '8px', cursor: 'zoom-in' }, onClick: () => lightbox(a.url) }) : h('a', { href: a.url + '?download=1' }, a.name))) : null);
        if (!t.deleted && myRank() >= 2) actions.push(h('button', { class: 'btn sm danger', onClick: async () => { await DEL(`/admin/messages/${t.id}`); await PATCH(`/admin/reports/${r.id}`, { status: 'resolved', resolution: 'Conteúdo removido' }); load(); } }, 'Remover mensagem'));
        if (t.sender && myRank() >= 2) actions.push(h('button', { class: 'btn sm', onClick: () => suspend({ id: t.sender.id, displayName: t.sender.displayName }, load) }, 'Suspender autor'));
      } else if (r.targetType === 'user' && t) {
        preview = h('div', { class: 'row' }, avatar(t, 36), h('div', null, h('b', null, t.displayName), h('div', { class: 'faint' }, `@${t.username} · ${t.status}`), t.bio ? h('small', { class: 'muted' }, t.bio.slice(0, 160)) : null));
        if (myRank() >= 2) actions.push(h('button', { class: 'btn sm', onClick: () => suspend(t, load) }, 'Suspender'));
        if (myRank() >= 3) actions.push(h('button', { class: 'btn sm danger', onClick: () => ban(t, load) }, 'Banir'));
        actions.push(h('button', { class: 'btn sm ghost', onClick: () => social.openProfile(t.id) }, 'Ver perfil'));
      } else if ((r.targetType === 'community' || r.targetType === 'group') && t) {
        preview = h('div', null, h('b', null, t.name), t.removed ? h('span', { class: 'chip red', style: { marginLeft: '6px' } }, 'removido') : null, h('p', { class: 'muted', style: { margin: '4px 0 0' } }, t.description || ''));
        if (!t.removed && myRank() >= 3) actions.push(h('button', { class: 'btn sm danger', onClick: async () => { await POST(`/admin/${r.targetType === 'community' ? 'communities' : 'groups'}/${t.id}/remove`, { reason: `Denúncia #${r.id}` }); await PATCH(`/admin/reports/${r.id}`, { status: 'resolved', resolution: 'Removido' }); load(); } }, `Remover ${r.targetType === 'community' ? 'comunidade' : 'grupo'}`));
      } else if (r.targetType === 'story' && t) {
        preview = h('div', { class: 'row' }, t.url ? h('img', { src: t.url, style: { width: '60px', height: '90px', objectFit: 'cover', borderRadius: '8px' } }) : null, h('span', null, t.text || `[${t.type}]`), t.deleted ? h('span', { class: 'chip red' }, 'removido') : null);
        if (!t.deleted && myRank() >= 2) actions.push(h('button', { class: 'btn sm danger', onClick: async () => { await DEL(`/admin/stories/${t.id}`); await PATCH(`/admin/reports/${r.id}`, { status: 'resolved', resolution: 'Story removido' }); load(); } }, 'Remover story'));
      }
      if (myRank() >= 2 && ['open', 'reviewing'].includes(r.status)) {
        if (r.status === 'open') actions.push(h('button', { class: 'btn sm', onClick: async () => { await PATCH(`/admin/reports/${r.id}`, { status: 'reviewing' }); load(); } }, 'Analisar'));
        actions.push(h('button', { class: 'btn sm', onClick: async () => { const res = await promptDialog('Resolução (opcional)', { title: 'Resolver denúncia', confirmText: 'Resolver' }); if (res !== null) { await PATCH(`/admin/reports/${r.id}`, { status: 'resolved', resolution: res }); load(); } } }, 'Resolver'));
        actions.push(h('button', { class: 'btn sm ghost', onClick: async () => { await PATCH(`/admin/reports/${r.id}`, { status: 'dismissed' }); load(); } }, 'Descartar'));
      }
      out.appendChild(h('div', { class: 'card' },
        h('div', { class: 'row between wrap' }, h('div', { class: 'row wrap' }, h('span', { class: 'chip red' }, REASON[r.reason]), h('span', { class: 'chip' }, { message: 'Mensagem', user: 'Usuário', group: 'Grupo', community: 'Comunidade', story: 'Story' }[r.targetType]), r.communityId ? h('span', { class: 'chip gold' }, 'em comunidade') : null),
          h('small', { class: 'faint' }, `#${r.id} · por ${r.reporter || '—'} · ${fmtRelative(r.createdAt)}${r.handler ? ` · tratado por ${r.handler}` : ''}`)),
        r.details ? h('p', { class: 'muted' }, `“${r.details}”`) : null,
        h('div', { style: { margin: '10px 0' } }, preview || h('span', { class: 'faint' }, 'Alvo não encontrado.')),
        r.resolution ? h('p', { class: 'hint' }, `Resolução: ${r.resolution}`) : null,
        h('div', { class: 'row wrap' }, actions)));
    }
  };
  load();
}

async function communities(el) {
  const q = h('input', { class: 'input', placeholder: 'Buscar comunidades' });
  const out = h('div');
  el.append(h('h2', null, 'Comunidades'), h('div', { class: 'search-box' }, icon('search'), q), out);
  const load = async () => {
    const list = await GET(`/admin/communities?q=${encodeURIComponent(q.value)}`);
    clear(out);
    const tbl = h('table', { class: 'tbl', style: { marginTop: '12px' } }, h('tr', null, h('th', null, 'Comunidade'), h('th', null, 'Dono'), h('th', null, 'Membros'), h('th', null, 'Denúncias'), h('th', null, 'Status'), h('th')));
    for (const c of list) tbl.appendChild(h('tr', null, h('td', null, h('div', { class: 'row' }, avatar(c, 28, { square: true }), h('b', null, c.name))), h('td', null, '@' + c.owner), h('td', null, c.memberCount), h('td', null, c.reports ? h('span', { class: 'chip red' }, c.reports) : '0'),
      h('td', null, c.removed ? h('span', { class: 'chip red' }, 'Removida') : c.isPublic ? h('span', { class: 'chip green' }, 'Pública') : h('span', { class: 'chip' }, 'Privada')),
      h('td', null, myRank() >= 3 ? (c.removed ? h('button', { class: 'btn sm', onClick: async () => { await POST(`/admin/communities/${c.id}/restore`); load(); } }, 'Restaurar')
        : h('button', { class: 'btn sm danger', onClick: async () => { const reason = await promptDialog('Motivo da remoção', { title: `Remover ${c.name}`, confirmText: 'Remover' }); if (reason !== null) { await POST(`/admin/communities/${c.id}/remove`, { reason }); load(); } } }, 'Remover')) : null)));
    out.appendChild(tbl);
  };
  let t; q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 250); });
  load();
}
async function groups(el) {
  const q = h('input', { class: 'input', placeholder: 'Buscar grupos' });
  const out = h('div');
  el.append(h('h2', null, 'Grupos'), h('p', { class: 'muted' }, 'O conteúdo das conversas de grupos não é exibido aqui por privacidade. Mensagens denunciadas aparecem em Denúncias.'), h('div', { class: 'search-box' }, icon('search'), q), out);
  const load = async () => {
    const list = await GET(`/admin/groups?q=${encodeURIComponent(q.value)}`);
    clear(out);
    const tbl = h('table', { class: 'tbl', style: { marginTop: '12px' } }, h('tr', null, h('th', null, 'Grupo'), h('th', null, 'Dono'), h('th', null, 'Participantes'), h('th', null, 'Privacidade'), h('th', null, 'Criado'), h('th')));
    for (const g of list) tbl.appendChild(h('tr', null, h('td', null, h('b', null, g.name), g.removed ? h('span', { class: 'chip red', style: { marginLeft: '6px' } }, 'removido') : null), h('td', null, g.owner ? '@' + g.owner : '—'), h('td', null, g.memberCount), h('td', null, g.privacy === 'public' ? 'Público' : 'Privado'), h('td', null, fmtDate(g.createdAt)),
      h('td', null, myRank() >= 3 ? (g.removed ? h('button', { class: 'btn sm', onClick: async () => { await POST(`/admin/groups/${g.id}/restore`); load(); } }, 'Restaurar') : h('button', { class: 'btn sm danger', onClick: async () => { if (await confirmDialog(`Remover o grupo ${g.name}?`, { danger: true, confirmText: 'Remover' })) { await POST(`/admin/groups/${g.id}/remove`); load(); } } }, 'Remover')) : null)));
    out.appendChild(tbl);
  };
  let t; q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 250); });
  load();
}
async function announcements(el) {
  el.append(h('h2', null, 'Comunicados'));
  if (myRank() >= 3) {
    const title = h('input', { class: 'input', placeholder: 'Título', maxlength: 120 });
    const content = h('textarea', { class: 'textarea', placeholder: 'Mensagem para todos os usuários', maxlength: 3000 });
    el.appendChild(h('div', { class: 'card' }, field('Título', title), field('Conteúdo', content), h('button', { class: 'btn gold', onClick: async () => {
      if (!await confirmDialog('O comunicado será enviado como notificação para todos os usuários ativos.', { confirmText: 'Publicar' })) return;
      await POST('/admin/announcements', { title: title.value, content: content.value }); toast('Comunicado publicado!', 'gold'); clear(el); announcements(el);
    } }, icon('megaphone', 16), 'Publicar comunicado')));
  }
  const list = await GET('/admin/announcements');
  for (const a of list) el.appendChild(h('div', { class: 'card' }, h('div', { class: 'row between' }, h('b', null, a.title), h('div', { class: 'row' }, h('small', { class: 'faint' }, `${a.author || ''} · ${fmtDate(a.created_at)}`),
    myRank() >= 3 ? h('label', { class: 'row', style: { fontSize: '.85em' } }, 'Ativo', switchEl(a.active, v => PATCH(`/admin/announcements/${a.id}`, { active: v }))) : null)),
  h('p', { class: 'muted', style: { whiteSpace: 'pre-wrap', marginBottom: 0 } }, a.content)));
}
async function logs(el) {
  el.append(h('h2', null, 'Registros administrativos'), h('div', { class: 'spinner' }));
  const list = await GET('/admin/logs');
  el.lastChild.remove();
  const tbl = h('table', { class: 'tbl' }, h('tr', null, h('th', null, 'Quando'), h('th', null, 'Quem'), h('th', null, 'Ação'), h('th', null, 'Alvo'), h('th', null, 'Detalhes'), h('th', null, 'IP')));
  for (const l of list) tbl.appendChild(h('tr', null, h('td', null, fmtDate(l.createdAt)), h('td', null, l.actor || 'sistema'), h('td', null, h('code', null, l.action)), h('td', null, l.targetType ? `${l.targetType} #${l.targetId}` : '—'), h('td', { class: 'faint', style: { maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis' } }, JSON.stringify(l.data)), h('td', { class: 'faint' }, l.ip || '')));
  el.appendChild(h('div', { style: { overflowX: 'auto' } }, tbl));
}
async function settings(el) {
  const s = await GET('/admin/settings');
  let open = s.registration_open !== false;
  const mb = h('input', { class: 'input', type: 'number', min: 1, max: 100, value: s.max_upload_mb });
  const len = h('input', { class: 'input', type: 'number', min: 100, max: 10000, value: s.max_message_length });
  const notice = h('input', { class: 'input', value: s.maintenance_notice || '', placeholder: 'Ex.: Manutenção programada hoje às 23h', maxlength: 300 });
  el.append(h('h2', null, 'Configurações gerais'),
    h('div', { class: 'card' }, h('div', { class: 'toggle-row' }, h('div', null, h('b', null, 'Cadastros abertos'), h('div', { class: 'hint' }, 'Permite que novas pessoas criem contas.')), switchEl(open, v => { open = v; })),
      field('Tamanho máximo de upload (MB)', mb, 'Limite rígido do servidor: 100 MB.'), field('Tamanho máximo de mensagem (caracteres)', len), field('Aviso global (faixa no topo para todos)', notice),
      h('button', { class: 'btn primary', onClick: async () => { await PATCH('/admin/settings', { registration_open: open, max_upload_mb: Number(mb.value), max_message_length: Number(len.value), maintenance_notice: notice.value }); toast('Configurações salvas.', 'ok'); } }, 'Salvar')));
}

// ===================== ATENDIMENTO (equipe) =====================
async function tickets(el) {
  let status = 'active';
  const out = h('div');
  el.append(h('h2', null, 'Atendimento'), tabs([['active', 'Em aberto'], ['open', 'Novos'], ['in_progress', 'Em andamento'], ['resolved', 'Resolvidos'], ['closed', 'Encerrados'], ['all', 'Todos']], 'active', s => { status = s; load(); }), out);
  const load = async () => {
    clear(out).appendChild(h('div', { class: 'spinner' }));
    const list = await GET(`/support/admin/tickets?status=${status}`);
    clear(out);
    if (!list.length) return out.appendChild(h('div', { class: 'empty' }, 'Nenhum chamado.'));
    for (const t of list) out.appendChild(h('button', { class: 'list-item', style: { borderBottom: '1px solid var(--line)', borderRadius: 0 }, onClick: () => ticketView(t.id, true) }, avatar(t.user, 36),
      h('div', { class: 'meta' }, h('div', { class: 'name' }, h('span', null, `#${t.id} · ${t.subject}`)), h('div', { class: 'sub' }, `${t.user.displayName} · ${t.category} · atualizado ${fmtRelative(t.updatedAt)}${t.assignee ? ` · com ${t.assignee}` : ''}`)), ticketChip(t.status)));
  };
  load();
  const off = on('support:changed', () => { if (!el.isConnected) return off(); load(); });
}

const ticketChip = s => ({ open: h('span', { class: 'chip gold' }, 'Aberto'), in_progress: h('span', { class: 'chip' }, 'Em andamento'), resolved: h('span', { class: 'chip green' }, 'Resolvido'), closed: h('span', { class: 'chip' }, 'Encerrado') }[s]);
const CAT_L = { conta: 'Conta', login: 'Login e acesso', mensagens: 'Mensagens', chamadas: 'Chamadas', grupos: 'Grupos', comunidades: 'Comunidades', denuncia: 'Denúncia', pagamento: 'Pagamento', bug: 'Erro / bug', sugestao: 'Sugestão', outro: 'Outro' };

async function ticketView(id, staff) {
  const body = h('div', null, h('div', { class: 'spinner' }));
  const m = modal({ title: `Chamado #${id}`, size: 'wide', body });
  const draw = async () => {
    const t = await GET(`/support/tickets/${id}`);
    clear(body);
    body.appendChild(h('div', { class: 'row between wrap', style: { marginBottom: '12px' } }, h('div', null, h('h3', { style: { margin: 0 } }, t.subject), h('small', { class: 'faint' }, `${CAT_L[t.category]} · aberto ${fmtDate(t.createdAt)}`)),
      h('div', { class: 'row' }, ticketChip(t.status),
        staff ? h('select', { class: 'select', style: { width: 'auto' }, onChange: async e => { await PATCH(`/support/tickets/${id}`, { status: e.target.value }); draw(); } }, [['open', 'Aberto'], ['in_progress', 'Em andamento'], ['resolved', 'Resolvido'], ['closed', 'Encerrado']].map(([v, l]) => h('option', { value: v, selected: v === t.status }, l))) : null,
        staff && !t.assignedTo ? h('button', { class: 'btn sm', onClick: async () => { await PATCH(`/support/tickets/${id}`, { assignToMe: true }); draw(); } }, 'Assumir') : null)));
    for (const msg of t.messages) {
      body.appendChild(h('div', { class: 'card', style: msg.isStaff ? { borderColor: 'rgba(245,197,66,.45)' } : null },
        h('div', { class: 'row' }, avatar(msg.author || {}, 28), h('b', null, msg.author?.displayName || '—'), msg.isStaff ? h('span', { class: 'chip gold' }, 'Equipe NEW GG') : null, h('small', { class: 'faint' }, fmtDate(msg.createdAt))),
        h('p', { style: { whiteSpace: 'pre-wrap', margin: '8px 0 0' } }, msg.content),
        msg.files.length ? h('div', { class: 'row wrap', style: { marginTop: '8px' } }, msg.files.map(f => f.kind === 'image' ? h('img', { src: f.url, style: { width: '110px', height: '110px', objectFit: 'cover', borderRadius: '10px', cursor: 'zoom-in' }, onClick: () => lightbox(f.url) }) : h('a', { class: 'chip', href: f.url + '?download=1' }, icon('file', 13), f.name))) : null));
    }
    if (t.status !== 'closed') {
      const ta = h('textarea', { class: 'textarea', placeholder: staff ? 'Responder como equipe…' : 'Escreva uma resposta…' });
      let files = [];
      const fl = h('div', { class: 'row wrap' });
      body.appendChild(h('div', { class: 'card' }, ta, fl, h('div', { class: 'row between', style: { marginTop: '8px' } },
        h('button', { class: 'btn sm ghost', onClick: async () => { files = await pickFiles({ multiple: true, accept: 'image/*,.pdf,.txt,.zip' }); clear(fl).append(...files.map(f => h('span', { class: 'chip' }, f.name))); } }, icon('clip', 15), 'Anexar'),
        h('div', { class: 'row' },
          !staff ? h('button', { class: 'btn sm ghost', onClick: async () => { if (await confirmDialog('Encerrar este chamado?', { confirmText: 'Encerrar' })) { await POST(`/support/tickets/${id}/close`); draw(); } } }, 'Encerrar chamado') : null,
          h('button', { class: 'btn sm primary', onClick: async () => { const fd = new FormData(); fd.append('content', ta.value); files.forEach(f => fd.append('files', f)); await api('POST', `/support/tickets/${id}/messages`, undefined, { form: fd }); draw(); } }, icon('send', 15), 'Enviar')))));
    } else body.appendChild(h('p', { class: 'hint', style: { textAlign: 'center' } }, 'Chamado encerrado. Abra um novo se precisar de ajuda.'));
  };
  draw();
  const off = on('support:changed', d => { if (!m.el.isConnected) return off(); if (d.ticketId === id) draw(); });
}

// ===================== CENTRAL DE SUPORTE (usuário) =====================
export function openSupport(ticketId) {
  const body = h('div');
  const m = modal({ title: '🛟 Central de suporte', size: 'wide', body });
  const list = async () => {
    clear(body).append(h('div', { class: 'row between', style: { marginBottom: '12px' } }, h('p', { class: 'muted', style: { margin: 0 } }, 'Precisa de ajuda? Abra um chamado e nossa equipe responde por aqui.'), h('button', { class: 'btn primary', onClick: create }, icon('plus', 16), 'Abrir chamado')));
    const tickets = await GET('/support/tickets');
    if (!tickets.length) body.appendChild(h('div', { class: 'empty' }, h('span', { class: 'spark' }, '✦'), 'Você não tem chamados.'));
    for (const t of tickets) body.appendChild(h('button', { class: 'list-item', style: { borderBottom: '1px solid var(--line)', borderRadius: 0 }, onClick: () => ticketView(t.id, false) }, icon('support', 22),
      h('div', { class: 'meta' }, h('div', { class: 'name' }, `#${t.id} · ${t.subject}`), h('div', { class: 'sub' }, `${CAT_L[t.category]} · atualizado ${fmtRelative(t.updatedAt)}`)), ticketChip(t.status)));
  };
  const create = async () => {
    const cats = await GET('/support/categories');
    const cat = h('select', { class: 'select' }, cats.map(c => h('option', { value: c }, CAT_L[c] || c)));
    const subject = h('input', { class: 'input', maxlength: 120, placeholder: 'Resumo do problema' });
    const desc = h('textarea', { class: 'textarea', maxlength: 5000, placeholder: 'Descreva o que aconteceu, passos para reproduzir, etc.', style: { minHeight: '140px' } });
    let files = [];
    const fl = h('div', { class: 'row wrap' });
    clear(body).append(field('Categoria', cat), field('Assunto', subject), field('Descrição', desc),
      h('button', { class: 'btn sm', onClick: async () => { files = await pickFiles({ multiple: true, accept: 'image/*,.pdf,.txt,.zip' }); clear(fl).append(...files.map(f => h('span', { class: 'chip' }, f.name))); } }, icon('image', 15), 'Anexar imagens'), fl,
      h('div', { class: 'row', style: { marginTop: '14px', justifyContent: 'flex-end' } }, h('button', { class: 'btn ghost', onClick: list }, 'Voltar'),
        h('button', { class: 'btn primary', onClick: async e => {
          e.target.disabled = true;
          const fd = new FormData(); fd.append('category', cat.value); fd.append('subject', subject.value); fd.append('description', desc.value); files.forEach(f => fd.append('files', f));
          try { const t = await api('POST', '/support/tickets', undefined, { form: fd }); toast('Chamado aberto! Responderemos em breve.', 'ok'); list(); ticketView(t.id, false); } catch { e.target.disabled = false; }
        } }, 'Enviar chamado')));
  };
  list();
  if (ticketId) ticketView(ticketId, false);
  void m;
}
