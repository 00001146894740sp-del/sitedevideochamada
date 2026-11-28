import {
  state, on, api, GET, POST, PATCH, DEL, h, clear, icon, iconBtn, toast, modal, menu, confirmDialog, promptDialog,
  avatar, roleMark, verifiedMark, serverTagEl, badgeEl, frameEl, playEffect, fmtGG, RARITY, fmtDate, fmtRelative, fmtSize, field, switchEl, tabs, pickFiles, lightbox, ROLE_LABEL
} from './core.js';
import * as social from './social.js';
import { itemPreview } from './shop.js';

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
    ['shop', 'bag', 'Loja e economia', 3], ['ads', 'play', 'Anúncios', 3], ['tags', 'gem', 'Tags, selos e impulso', 4],
    ['logs', 'history', 'Registros', 3], ['settings', 'cog', 'Configurações gerais', 3]
  ].filter(i => myRank() >= i[3]);
  const views = { dash, users, reports, tickets, communities, groups, announcements, logs, settings, shop: shopAdmin, ads: adsAdmin, tags: tagsAdmin };
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
    const tbl = h('table', { class: 'tbl', style: { marginTop: '12px' } }, h('tr', null, h('th', null, 'Usuário'), h('th', null, 'E-mail'), h('th', null, 'Nível'), h('th', null, 'GG'), h('th', null, 'Status'), h('th', null, 'Criado'), h('th')));
    for (const u of r.users) {
      tbl.appendChild(h('tr', { style: { cursor: 'pointer' }, onClick: () => userDetail(u.id, load) },
        h('td', null, h('div', { class: 'row' }, avatar(u, 30), h('div', null, h('b', null, u.displayName, ' ', roleMark(u)), h('div', { class: 'faint' }, `@${u.username} · #${u.id}`)))),
        h('td', null, u.email || '—', u.email && !u.emailVerified ? h('small', { class: 'faint' }, ' (não verif.)') : null),
        h('td', null, ROLE_LABEL[u.role]), h('td', null, fmtGG(u.gg)), h('td', null, STATUS_CHIP(u.status), u.suspendedUntil ? h('div', { class: 'faint', style: { fontSize: '.8em' } }, `até ${fmtDate(u.suspendedUntil)}`) : null),
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
    above && myRank() >= 3 ? { icon: 'shield', label: 'Alterar nível de acesso', onClick: () => changeRole(u, reload) } : null,
    myRank() >= 3 ? '-' : null,
    myRank() >= 3 ? { icon: 'check', label: u.verified ? 'Remover verificação' : 'Verificar conta ✔', onClick: async () => { await POST(`/admin/users/${u.id}/verify`, { verified: !u.verified }); toast(u.verified ? 'Verificação removida.' : 'Conta verificada!', 'ok'); reload?.(); } } : null,
    myRank() >= 3 ? { icon: 'coin', label: 'Dar ou tirar GG', onClick: () => giveGG(u, reload) } : null
  ]);
}
async function giveGG(u, reload) {
  const amount = h('input', { class: 'input', type: 'number', placeholder: 'Ex.: 500 (ou -200 para tirar)' });
  const reason = h('input', { class: 'input', placeholder: 'Motivo (aparece no extrato do usuário)', maxlength: 100 });
  const m = modal({ title: `GG de ${u.displayName}`, body: h('div', null, h('p', { class: 'muted' }, `Saldo atual: ${fmtGG(u.gg)}`), field('Quantidade', amount), field('Motivo', reason)),
    foot: [h('button', { class: 'btn gold', onClick: async () => { const r = await POST(`/admin/users/${u.id}/gg`, { amount: Number(amount.value), reason: reason.value }); m.close(); toast(`Novo saldo: ${fmtGG(r.balance)}`, 'ok'); reload?.(); } }, 'Confirmar')] });
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
    h('div', { class: 'card row' }, avatar(u, 64), h('div', { class: 'grow' }, h('b', { style: { fontSize: '1.2em' } }, u.displayName, ' ', roleMark(u)), h('div', { class: 'muted' }, `@${u.username} · #${u.id} · ${u.email || 'sem e-mail'}`),
      h('div', { class: 'row', style: { marginTop: '6px' } }, STATUS_CHIP(u.status), h('span', { class: 'chip' }, ROLE_LABEL[u.role]), h('span', { class: 'chip' }, `${u.counts.messages} mensagens`), h('span', { class: 'chip' }, `${u.counts.friends} amigos`), h('span', { class: 'chip' }, `${u.activeSessions} sessões`)),
      u.statusReason ? h('p', { class: 'hint' }, `Motivo: ${u.statusReason}`) : null),
    iconBtn('more', 'Ações', e => userActions(e, u, () => { m.close(); reload?.(); }))),
    u.bio ? h('div', { class: 'card' }, h('div', { class: 'label' }, 'Bio'), h('p', null, u.bio)) : null,
    myRank() >= 3 ? h('div', { class: 'card' }, h('div', { class: 'label', style: { marginBottom: '8px' } }, 'Insígnias'),
      h('div', { class: 'row wrap' }, badges.map(b => { const has = u.badges.includes(b.code); return h('button', { class: `badge ach ${b.special ? 'special' : ''}`, style: { opacity: has ? 1 : 0.45, cursor: 'pointer' }, title: has ? 'Clique para remover' : 'Clique para conceder', onClick: async () => { if (has) await DEL(`/admin/users/${u.id}/badges/${b.code}`); else await POST(`/admin/users/${u.id}/badges`, { code: b.code }); m.close(); userDetail(id, reload); } }, icon({pioneer:'compass',first_message:'chat',social:'users',founder:'crown',storyteller:'sparkle',caller:'phone',staff:'shield',verified:'check',supporter:'gem'}[b.code]||'star',14), b.name); }))) : null,
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
    for (const c of list) tbl.appendChild(h('tr', null, h('td', null, h('div', { class: 'row' }, avatar(c, 28, { square: true }), h('b', null, c.name), c.verified ? verifiedMark() : null)), h('td', null, '@' + c.owner), h('td', null, c.memberCount), h('td', null, c.reports ? h('span', { class: 'chip red' }, c.reports) : '0'),
      h('td', null, c.removed ? h('span', { class: 'chip red' }, 'Removida') : c.isPublic ? h('span', { class: 'chip green' }, 'Pública') : h('span', { class: 'chip' }, 'Privada')),
      h('td', null, myRank() >= 4 ? h('button', { class: 'btn sm', style: { marginRight: '6px' }, onClick: () => boostForm(c, load) }, icon('gem', 14), c.boostLevel ? `Nv ${c.boostLevel}` : 'Impulso', c.tag ? ` · #${c.tag.text}` : '') : null, myRank() >= 3 ? h('button', { class: 'btn sm', style: { marginRight: '6px' }, onClick: async () => { await POST(`/admin/communities/${c.id}/verify`, { verified: !c.verified }); load(); } }, c.verified ? 'Tirar selo' : 'Verificar ✔') : null, myRank() >= 3 ? (c.removed ? h('button', { class: 'btn sm', onClick: async () => { await POST(`/admin/communities/${c.id}/restore`); load(); } }, 'Restaurar')
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
const CAT_L = { verificacao: 'Pedido de verificação ✔', conta: 'Conta', login: 'Login e acesso', mensagens: 'Mensagens', chamadas: 'Chamadas', grupos: 'Grupos', comunidades: 'Comunidades', denuncia: 'Denúncia', pagamento: 'Pagamento', bug: 'Erro / bug', sugestao: 'Sugestão', outro: 'Outro' };

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

// ===================== LOJA E ECONOMIA =====================
async function shopAdmin(el) {
  el.append(h('h2', null, 'Loja e economia'), h('div', { class: 'spinner' }));
  const [items, eco] = await Promise.all([GET('/admin/shop/items'), GET('/admin/economy')]);
  el.lastChild.remove();
  const stat = (n, l) => h('div', { class: 'stat' }, h('b', null, n), h('span', null, l));
  el.append(h('div', { class: 'stat-grid' }, stat(fmtGG(eco.circulating), 'GG em circulação'), stat(fmtGG(eco.earned_7d), 'GG ganhos (7 dias)'), stat(fmtGG(eco.spent_7d), 'GG gastos (7 dias)'), stat(eco.ad_views_24h, 'Anúncios assistidos (24h)'), stat(eco.verified_users, 'Contas verificadas')),
    h('div', { class: 'row', style: { marginBottom: '12px' } }, h('button', { class: 'btn primary', onClick: () => itemForm(null, () => shopAdmin(clear(el))) }, icon('plus', 16), 'Novo item')));
  for (const type of ['frame', 'effect']) {
    el.appendChild(h('div', { class: 'section-label' }, type === 'frame' ? 'Molduras' : 'Efeitos de perfil'));
    el.appendChild(h('div', { class: 'shop-grid' }, items.filter(i => i.type === type).map(i => {
      const [rl, rc] = RARITY[i.rarity];
      return h('div', { class: 'shop-card', style: i.active ? null : { opacity: .55 } }, itemPreview(i, { size: 70 }),
        h('span', { class: 'rarity', style: { color: rc } }, rl), h('b', null, i.name),
        h('span', { class: 'price' }, icon('coin', 15), fmtGG(i.price)), h('small', { class: 'faint' }, `${i.owners} dono(s) · ${i.active ? 'à venda' : 'fora da loja'}`),
        h('button', { class: 'btn sm', onClick: () => itemForm(i, () => shopAdmin(clear(el))) }, icon('edit', 14), 'Editar'));
    })));
  }
}

function itemForm(item, done) {
  const isNew = !item;
  const type = h('select', { class: 'select', disabled: !isNew }, h('option', { value: 'frame' }, 'Moldura de avatar'), h('option', { value: 'effect' }, 'Efeito de perfil'));
  type.value = item?.type || 'frame';
  const name = h('input', { class: 'input', value: item?.name || '', maxlength: 40, placeholder: 'Ex.: Coroa Real' });
  const desc = h('input', { class: 'input', value: item?.description || '', maxlength: 200 });
  const price = h('input', { class: 'input', type: 'number', min: 0, value: item?.price ?? 300 });
  const rarity = h('select', { class: 'select' }, Object.entries(RARITY).map(([k, [l]]) => h('option', { value: k }, l)));
  rarity.value = item?.rarity || 'comum';
  let active = item ? item.active : true;
  const kind = h('select', { class: 'select' });
  const cfg = { placement: item?.config?.placement || 'full', duration: item?.config?.duration || 4, colors: [...(item?.config?.colors || ['#9d4dff', '#f5c542'])], emoji: (item?.config?.emoji || ['🔥', '✨']).join(' '), direction: item?.config?.direction || 'down', imageUrl: item?.config?.imageUrl };
  let file = null;
  const dyn = h('div'); const prev = h('div', { style: { width: '220px' } });
  const fillKinds = () => {
    clear(kind);
    const opts = type.value === 'frame'
      ? [['ring', 'Aro com brilho'], ['pulse', 'Aro pulsante (neon)'], ['spin', 'Aro girando (animado)'], ['image', 'Imagem PNG personalizada']]
      : [['gif', 'GIF animado (seu arquivo)'], ['sparkles', 'Brilhos subindo'], ['confetti', 'Confete'], ['snow', 'Neve'], ['fireworks', 'Fogos de artifício']];
    opts.forEach(([v, l]) => kind.appendChild(h('option', { value: v }, l)));
    kind.value = item?.type === type.value && item?.config?.kind ? item.config.kind : opts[0][0];
  };
  const currentConfig = () => {
    const k = kind.value;
    if (k === 'image') return { kind: k, imageUrl: file ? URL.createObjectURL(file) : cfg.imageUrl };
    if (k === 'gif') return { kind: k, imageUrl: file ? (cfg._blob ||= URL.createObjectURL(file)) : cfg.imageUrl, placement: cfg.placement, duration: Number(cfg.duration) || 4 };
    if (k === 'emoji') return { kind: k, emoji: cfg.emoji.split(/\s+/).filter(Boolean), direction: cfg.direction };
    return { kind: k, colors: cfg.colors };
  };
  const drawPreview = () => { clear(prev).appendChild(itemPreview({ type: type.value, config: currentConfig() }, { size: 84 })); };
  const drawDyn = () => {
    clear(dyn);
    const k = kind.value;
    if (k === 'gif') {
      const pl = h('select', { class: 'select' }, h('option', { value: 'full' }, 'Cobrir o perfil inteiro'), h('option', { value: 'banner' }, 'Sobre o banner (topo)'), h('option', { value: 'avatar' }, 'Em volta da foto'));
      pl.value = cfg.placement; pl.addEventListener('change', () => { cfg.placement = pl.value; drawPreview(); });
      const du = h('input', { class: 'input', type: 'number', min: 1, max: 15, value: cfg.duration });
      du.addEventListener('input', () => { cfg.duration = du.value; });
      dyn.append(h('p', { class: 'hint' }, 'Envie um GIF (ou WebP/PNG animado). Fundo transparente fica mais bonito. Ele toca quando alguém abre o perfil de quem equipou.'),
        h('button', { class: 'btn sm', style: { marginBottom: '12px' }, onClick: async () => { const [f] = await pickFiles({ accept: 'image/gif,image/webp,image/png' }); if (f) { file = f; cfg._blob = null; drawPreview(); } } }, icon('image', 15), file || cfg.imageUrl ? 'Trocar GIF' : 'Escolher GIF'),
        h('div', { class: 'row' }, h('div', { class: 'grow' }, field('Posição', pl)), h('div', { class: 'grow' }, field('Duração (segundos)', du))));
    } else if (k === 'image') {
      dyn.append(h('p', { class: 'hint' }, 'Envie um PNG quadrado com o centro transparente (a foto do usuário aparece no meio). Recomendado: 512×512.'),
        h('button', { class: 'btn sm', onClick: async () => { const [f] = await pickFiles({ accept: 'image/png,image/webp,image/gif' }); if (f) { file = f; drawPreview(); } } }, icon('image', 15), 'Escolher imagem'));
    } else if (k === 'emoji') {
      const em = h('input', { class: 'input', value: cfg.emoji, placeholder: '🔥 ✨ 💜' });
      em.addEventListener('input', () => { cfg.emoji = em.value; drawPreview(); });
      const dir = h('select', { class: 'select' }, h('option', { value: 'down' }, 'Caindo'), h('option', { value: 'up' }, 'Subindo'));
      dir.value = cfg.direction; dir.addEventListener('change', () => { cfg.direction = dir.value; drawPreview(); });
      dyn.append(field('Emojis (separados por espaço, até 6)', em), field('Direção', dir));
    } else {
      const row = h('div', { class: 'color-edit' });
      const draw = () => {
        clear(row);
        cfg.colors.forEach((c, i) => {
          const inp = h('input', { type: 'color', value: c });
          inp.addEventListener('input', () => { cfg.colors[i] = inp.value; drawPreview(); });
          row.appendChild(inp);
        });
        if (cfg.colors.length < 8) row.appendChild(h('button', { class: 'btn sm', onClick: () => { cfg.colors.push('#ffffff'); draw(); drawPreview(); } }, '+ cor'));
        if (cfg.colors.length > 1) row.appendChild(h('button', { class: 'btn sm ghost', onClick: () => { cfg.colors.pop(); draw(); drawPreview(); } }, '− cor'));
      };
      draw();
      dyn.append(h('div', { class: 'label', style: { marginBottom: '6px' } }, 'Cores'), row);
    }
  };
  type.addEventListener('change', () => { fillKinds(); drawDyn(); drawPreview(); });
  kind.addEventListener('change', () => { drawDyn(); drawPreview(); });
  fillKinds(); drawDyn(); drawPreview();
  const save = h('button', { class: 'btn primary' }, 'Salvar');
  const m = modal({
    title: isNew ? 'Novo item da loja' : `Editar ${item.name}`, size: 'wide',
    body: h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 240px', gap: '20px' } },
      h('div', null, field('Tipo', type), field('Nome', name), field('Descrição', desc),
        h('div', { class: 'row' }, h('div', { class: 'grow' }, field('Preço (GG)', price)), h('div', { class: 'grow' }, field('Raridade', rarity))),
        field('Estilo', kind), dyn,
        h('div', { class: 'toggle-row' }, h('span', null, 'À venda na loja'), switchEl(active, v => { active = v; }))),
      h('div', null, h('div', { class: 'label', style: { marginBottom: '8px' } }, 'Prévia'), prev)),
    foot: [h('button', { class: 'btn ghost', onClick: () => m.close() }, 'Cancelar'), save]
  });
  save.addEventListener('click', async () => {
    const config = currentConfig(); if (config.kind === 'image' || config.kind === 'gif') delete config.imageUrl;
    const fd = new FormData();
    fd.append('type', type.value); fd.append('name', name.value); fd.append('description', desc.value); fd.append('price', price.value);
    fd.append('rarity', rarity.value); fd.append('active', String(active)); fd.append('config', JSON.stringify(config));
    if (file) fd.append('file', file);
    save.disabled = true;
    try { await api(isNew ? 'POST' : 'PATCH', isNew ? '/admin/shop/items' : `/admin/shop/items/${item.id}`, undefined, { form: fd }); m.close(); toast('Item salvo!', 'ok'); done(); } catch { save.disabled = false; }
  });
}

// ===================== ANÚNCIOS =====================
async function adsAdmin(el) {
  el.append(h('h2', null, 'Anúncios recompensados'), h('p', { class: 'muted' }, 'Defina quanto tempo o usuário precisa assistir, quanto GG ele ganha e quantas vezes por dia pode assistir cada anúncio.'),
    h('button', { class: 'btn primary', style: { marginBottom: '14px' }, onClick: () => adForm(null, () => adsAdmin(clear(el))) }, icon('plus', 16), 'Novo anúncio'), h('div', { class: 'spinner' }));
  const ads = await GET('/admin/ads');
  el.lastChild.remove();
  if (!ads.length) return el.appendChild(h('div', { class: 'empty' }, 'Nenhum anúncio criado ainda.'));
  for (const a of ads) el.appendChild(h('div', { class: 'ad-card', style: a.active ? null : { opacity: .55 } },
    h('div', { class: 'thumb' }, a.mediaKind === 'video' ? h('video', { src: a.mediaUrl, muted: true }) : h('img', { src: a.mediaUrl, alt: '' })),
    h('div', null, h('b', null, a.title, a.active ? '' : ' (pausado)'), h('div', { class: 'row wrap', style: { marginTop: '6px' } },
      h('span', { class: 'chip gold' }, `+${a.reward} GG`), h('span', { class: 'chip' }, `${a.watchSeconds} s`), h('span', { class: 'chip' }, `${a.dailyLimit}x por dia`),
      h('span', { class: 'chip green' }, `${a.views} visualizações`), h('span', { class: 'chip' }, `${fmtGG(a.paid)} pagos`))),
    h('button', { class: 'btn sm', onClick: () => adForm(a, () => adsAdmin(clear(el))) }, icon('edit', 14), 'Editar')));
}

function adForm(a, done) {
  const isNew = !a;
  const title = h('input', { class: 'input', value: a?.title || '', maxlength: 80 });
  const desc = h('input', { class: 'input', value: a?.description || '', maxlength: 300 });
  const link = h('input', { class: 'input', value: a?.linkUrl || '', placeholder: 'https://… (opcional, botão "Saiba mais")' });
  const secs = h('input', { class: 'input', type: 'number', min: 3, max: 600, value: a?.watchSeconds ?? 15 });
  const reward = h('input', { class: 'input', type: 'number', min: 1, value: a?.reward ?? 25 });
  const limit = h('input', { class: 'input', type: 'number', min: 1, max: 100, value: a?.dailyLimit ?? 3 });
  let active = a ? a.active : true; let file = null;
  const fileLabel = h('span', { class: 'hint' }, a ? 'Mídia atual mantida' : 'Nenhum arquivo escolhido');
  const save = h('button', { class: 'btn primary' }, 'Salvar');
  const m = modal({
    title: isNew ? 'Novo anúncio' : `Editar ${a.title}`,
    body: h('div', null, field('Título', title), field('Descrição', desc), field('Link', link),
      h('div', { class: 'row', style: { marginBottom: '14px' } }, h('button', { class: 'btn sm', onClick: async () => { const [f] = await pickFiles({ accept: 'image/*,video/*' }); if (f) { file = f; fileLabel.textContent = f.name; } } }, icon('image', 15), 'Imagem ou vídeo'), fileLabel),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, field('Assistir por (segundos)', secs)), h('div', { class: 'grow' }, field('Recompensa (GG)', reward)), h('div', { class: 'grow' }, field('Vezes por dia', limit))),
      h('div', { class: 'toggle-row' }, h('span', null, 'Anúncio ativo'), switchEl(active, v => { active = v; }))),
    foot: [h('button', { class: 'btn ghost', onClick: () => m.close() }, 'Cancelar'), save]
  });
  save.addEventListener('click', async () => {
    const fd = new FormData();
    fd.append('title', title.value); fd.append('description', desc.value); fd.append('linkUrl', link.value); fd.append('watchSeconds', secs.value);
    fd.append('reward', reward.value); fd.append('dailyLimit', limit.value); fd.append('active', String(active));
    if (file) fd.append('file', file);
    save.disabled = true;
    try { await api(isNew ? 'POST' : 'PATCH', isNew ? '/admin/ads' : `/admin/ads/${a.id}`, undefined, { form: fd }); m.close(); toast('Anúncio salvo!', 'ok'); done(); } catch { save.disabled = false; }
  });
}
void frameEl; void playEffect;

// ===================== TAGS, SELOS E IMPULSO (somente o dono) =====================
function boostForm(c, done) {
  const level = h('select', { class: 'select' }, [0, 1, 2, 3].map(n => h('option', { value: n }, n ? `Nível ${n}` : 'Sem impulso')));
  level.value = c.boostLevel || 0;
  const t = c.tag || {};
  const text = h('input', { class: 'input', value: t.text || '', maxlength: 4, placeholder: 'CPX', style: { textTransform: 'uppercase', maxWidth: '140px' } });
  const mode = h('select', { class: 'select' }, h('option', { value: 'ui' }, 'Interface (cores)'), h('option', { value: 'png' }, 'Ícone PNG + texto'));
  mode.value = t.mode || 'ui';
  const c1 = h('input', { type: 'color', value: t.colors?.[0] || '#9d4dff' }); const c2 = h('input', { type: 'color', value: t.colors?.[1] || '#f5c542' });
  const tc = h('input', { type: 'color', value: t.textColor || '#ffffff' });
  let file = null; let blob = t.imageUrl;
  const prev = h('div', { class: 'row', style: { gap: '10px', padding: '14px', background: 'var(--bg2)', borderRadius: '12px' } });
  const draw = () => { clear(prev).append(avatar(state.me, 32), h('b', null, state.me.displayName), serverTagEl({ text: (text.value || 'TAG').toUpperCase(), mode: mode.value, colors: [c1.value, c2.value], textColor: tc.value, imageUrl: blob, community: c.name })); };
  [text, mode, c1, c2, tc].forEach(i => i.addEventListener('input', draw));
  const save = h('button', { class: 'btn primary' }, 'Salvar');
  const m = modal({
    title: `Impulso e tag — ${c.name}`,
    body: h('div', null, h('p', { class: 'muted' }, 'Só o dono da plataforma pode dar impulso e tag. Os membros da comunidade podem escolher exibir a tag ao lado do nome.'),
      field('Impulso', level),
      h('div', { class: 'row wrap' }, field('Tag (2 a 4 letras/números)', text), h('div', { class: 'grow' }, field('Estilo', mode))),
      h('div', { class: 'row', style: { marginBottom: '12px' } }, h('span', { class: 'label' }, 'Cores'), c1, c2, h('span', { class: 'label' }, 'Texto'), tc,
        h('button', { class: 'btn sm', onClick: async () => { const [f] = await pickFiles({ accept: 'image/png,image/webp,image/gif' }); if (f) { file = f; blob = URL.createObjectURL(f); mode.value = 'png'; draw(); } } }, icon('image', 14), 'Ícone PNG')),
      h('div', { class: 'label', style: { marginBottom: '6px' } }, 'Prévia'), prev),
    foot: [c.tag ? h('button', { class: 'btn danger', onClick: async () => { const fd = new FormData(); fd.append('level', level.value); fd.append('removeTag', 'true'); await api('PATCH', `/admin/communities/${c.id}/boost`, undefined, { form: fd }); m.close(); toast('Tag removida.', 'ok'); done(); } }, 'Remover tag') : null,
      h('button', { class: 'btn ghost', onClick: () => m.close() }, 'Cancelar'), save]
  });
  draw();
  save.addEventListener('click', async () => {
    const fd = new FormData();
    fd.append('level', level.value); fd.append('tagText', text.value.trim()); fd.append('mode', mode.value);
    fd.append('colors', JSON.stringify([c1.value, c2.value])); fd.append('textColor', tc.value);
    if (file) fd.append('file', file);
    save.disabled = true;
    try { await api('PATCH', `/admin/communities/${c.id}/boost`, undefined, { form: fd }); m.close(); toast('Impulso e tag salvos!', 'ok'); done(); } catch { save.disabled = false; }
  });
}

async function tagsAdmin(el) {
  const styles = { ...(await GET('/auth/config')).badgeStyles };
  el.append(h('h2', null, 'Tags, selos e impulso'),
    h('p', { class: 'muted' }, 'Escolha como cada selo aparece ao lado dos nomes: em interface (texto com cores) ou com um PNG seu. Impulso e tag de servidor são dados na aba Comunidades (botão Impulso).'));
  const names = { verified: 'Verificado', owner: 'Dono', admin: 'Administrador', moderator: 'Moderador', support: 'Suporte' };
  for (const key of Object.keys(names)) {
    const st = styles[key] || {};
    const mode = h('select', { class: 'select', style: { maxWidth: '170px' } }, h('option', { value: 'ui' }, 'Interface'), h('option', { value: 'png' }, 'PNG'), h('option', { value: 'off' }, 'Não mostrar'));
    mode.value = st.mode || 'ui';
    const text = h('input', { class: 'input', value: st.text || '', maxlength: 14, style: { maxWidth: '150px' } });
    const c1 = h('input', { type: 'color', value: st.colors?.[0] || '#9d4dff' }); const c2 = h('input', { type: 'color', value: st.colors?.[1] || '#f5c542' });
    const tc = h('input', { type: 'color', value: st.textColor || '#ffffff' });
    let file = null; let img = st.imageUrl;
    const prev = h('span');
    const draw = () => clear(prev).append(badgeEl(key, { mode: mode.value, text: text.value, colors: [c1.value, c2.value], textColor: tc.value, icon: key === 'verified' ? 'check' : undefined, imageUrl: img }) || h('span', { class: 'faint' }, '(oculto)'));
    [mode, text, c1, c2, tc].forEach(i => i.addEventListener('input', draw));
    draw();
    el.appendChild(h('div', { class: 'card' },
      h('div', { class: 'row between', style: { marginBottom: '10px' } }, h('b', null, names[key]), h('div', { class: 'row' }, h('span', { class: 'faint' }, 'Prévia:'), h('b', null, state.me.displayName), prev)),
      h('div', { class: 'row wrap' }, mode, text, h('span', { class: 'label' }, 'Cores'), c1, c2, h('span', { class: 'label' }, 'Texto'), tc,
        h('button', { class: 'btn sm', onClick: async () => { const [f] = await pickFiles({ accept: 'image/png,image/webp,image/gif' }); if (f) { file = f; img = URL.createObjectURL(f); mode.value = 'png'; draw(); } } }, icon('image', 14), 'PNG'),
        h('button', { class: 'btn sm primary', onClick: async () => {
          const fd = new FormData(); fd.append('mode', mode.value); fd.append('text', text.value); fd.append('colors', JSON.stringify([c1.value, c2.value])); fd.append('textColor', tc.value);
          if (file) fd.append('file', file);
          const all = await api('PATCH', `/admin/badge-styles/${key}`, undefined, { form: fd });
          state.config.badgeStyles = all; toast(`Selo "${names[key]}" salvo.`, 'ok');
        } }, 'Salvar'))));
  }
}
