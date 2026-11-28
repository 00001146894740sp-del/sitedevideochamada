// Loja NEW GG: molduras, efeitos de perfil, anúncios recompensados e extrato de GG
import {
  state, on, GET, POST, h, clear, icon, iconBtn, toast, modal, confirmDialog, avatar, tabs,
  playEffect, fmtGG, fmtRelative, RARITY
} from './core.js';
import { layout, renderRail } from './app.js';

let tab = 'frame';
let data = null;

on('wallet', w => {
  state.me.gg = w.balance;
  if (data) data.balance = w.balance;
  document.querySelectorAll('[data-gg-balance]').forEach(el => { el.textContent = fmtGG(w.balance); });
});

export const ggPill = () => h('span', { class: 'gg-pill' }, icon('coin', 18), h('span', { 'data-gg-balance': '1' }, fmtGG(state.me.gg)));

export function renderShopSide() {
  const item = (k, ic, label, sub) => h('button', { class: `list-item ${tab === k ? 'on' : ''}`, onClick: () => { tab = k; renderShopSide(); renderShop(); } },
    h('div', { class: 'avatar square', style: { width: '40px', height: '40px', background: 'rgba(var(--accent-rgb),.16)', color: 'var(--gold)' } }, icon(ic, 20)),
    h('div', { class: 'meta' }, h('div', { class: 'name' }, label), h('div', { class: 'sub' }, sub)));
  layout.setSide(h('div', { style: { display: 'contents' } },
    h('div', { class: 'side-head' }, h('h2', { class: 'side-title' }, h('span', { class: 'spark' }, '✦'), 'Loja GG'), ggPill(),
      h('p', { class: 'hint', style: { margin: 0 } }, 'Ganhe GG assistindo anúncios e troque por molduras e efeitos exclusivos.')),
    h('div', { class: 'side-body' },
      item('frame', 'user', 'Molduras', 'Destaque seu avatar'),
      item('effect', 'sparkle', 'Efeitos de perfil', 'Animação ao abrirem seu perfil'),
      item('earn', 'play', 'Ganhar GG', 'Assista anúncios e ganhe'),
      item('mine', 'bag', 'Meus itens', 'Equipe o que já é seu'),
      item('history', 'history', 'Extrato', 'Tudo que entrou e saiu'))));
}

export async function renderShop() {
  const body = h('div', { style: { padding: '22px', overflow: 'auto', flex: 1 } }, h('div', { class: 'spinner' }));
  const titles = { frame: 'Molduras', effect: 'Efeitos de perfil', earn: 'Ganhar GG', mine: 'Meus itens', history: 'Extrato de GG' };
  layout.setMain(h('section', { class: 'main chat-bg-aurora', style: { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 } },
    h('header', { class: 'chat-head' }, iconBtn('back', 'Voltar', () => layout.back(), 'back'), icon('bag'), h('b', { class: 'grow' }, titles[tab]), ggPill()),
    body), { inChat: window.innerWidth <= 860 });
  if (tab === 'earn') return renderAds(body);
  if (tab === 'history') return renderHistory(body);
  data = await GET('/shop/items');
  state.me.gg = data.balance;
  document.querySelectorAll('[data-gg-balance]').forEach(el => { el.textContent = fmtGG(data.balance); });
  clear(body);
  const list = tab === 'mine' ? data.items.filter(i => i.owned) : data.items.filter(i => i.type === tab && i.active);
  if (!list.length) {
    body.appendChild(h('div', { class: 'empty' }, h('span', { class: 'spark' }, '✦'), tab === 'mine' ? 'Você ainda não tem itens. Que tal ganhar GG assistindo anúncios?' : 'Nenhum item à venda agora.',
      h('div', { style: { marginTop: '12px' } }, h('button', { class: 'btn primary', onClick: () => { tab = 'earn'; renderShopSide(); renderShop(); } }, icon('play', 16), 'Ganhar GG'))));
    return;
  }
  if (tab === 'mine') {
    for (const type of ['frame', 'effect']) {
      const mine = list.filter(i => i.type === type);
      if (!mine.length) continue;
      body.appendChild(h('div', { class: 'section-label' }, type === 'frame' ? 'Molduras' : 'Efeitos de perfil'));
      body.appendChild(h('div', { class: 'shop-grid' }, mine.map(itemCard)));
    }
    return;
  }
  body.appendChild(h('div', { class: 'shop-grid' }, list.map(itemCard)));
}

export function itemPreview(item, { size = 84 } = {}) {
  const box = h('div', { class: 'preview' });
  if (item.type === 'frame') {
    box.appendChild(avatar({ ...state.me, frame: { ...item.config } }, size));
  } else {
    box.appendChild(avatar(state.me, size * 0.8));
    const play = () => playEffect(box, item.config, { duration: 3000 });
    box.style.cursor = 'pointer'; box.title = 'Clique para ver o efeito';
    box.addEventListener('click', play);
    box.appendChild(h('small', { class: 'faint', style: { position: 'absolute', bottom: '6px', fontSize: '.72em' } }, '▶ toque para ver'));
  }
  return box;
}

function itemCard(item) {
  const equipped = data.equipped[item.type] === item.id;
  const [rl, rc] = RARITY[item.rarity] || RARITY.comum;
  const card = h('div', { class: `shop-card ${equipped ? 'equipped' : ''}` },
    item.owned ? h('span', { class: `chip ${equipped ? 'gold' : 'green'} owned-tag` }, equipped ? 'Equipado' : 'Seu') : null,
    itemPreview(item),
    h('span', { class: 'rarity', style: { color: rc } }, rl),
    h('b', null, item.name),
    item.description ? h('small', { class: 'muted' }, item.description) : null);
  if (item.owned) {
    card.appendChild(equipped
      ? h('button', { class: 'btn sm ghost', onClick: () => equip(item.type, null) }, 'Remover')
      : h('button', { class: 'btn sm primary', onClick: () => equip(item.type, item.id) }, 'Equipar'));
  } else {
    const can = (data.balance || 0) >= item.price;
    card.append(h('span', { class: 'price' }, icon('coin', 16), fmtGG(item.price)),
      h('button', { class: `btn sm ${can ? 'gold' : ''}`, disabled: !can, title: can ? '' : 'GG insuficiente', onClick: () => buy(item) }, can ? 'Comprar' : 'GG insuficiente'));
  }
  return card;
}

async function buy(item) {
  if (!await confirmDialog(`Comprar "${item.name}" por ${fmtGG(item.price)}?`, { title: 'Confirmar compra', confirmText: 'Comprar' })) return;
  const r = await POST(`/shop/items/${item.id}/buy`);
  state.me.gg = r.balance;
  toast(r.message, 'gold');
  if (await confirmDialog('Quer equipar agora?', { title: 'Item adquirido! ✨', confirmText: 'Equipar' })) await equip(item.type, item.id);
  else renderShop();
}
async function equip(type, itemId) {
  const r = await POST('/shop/equip', { type, itemId });
  if (type === 'frame') state.me.frame = r.equipped; else state.me.effect = r.equipped;
  toast(itemId ? 'Item equipado!' : 'Item removido.', 'ok');
  renderRail(); renderShop();
}

// ===================== ANÚNCIOS =====================
async function renderAds(body) {
  const ads = await GET('/ads');
  clear(body);
  body.appendChild(h('p', { class: 'muted' }, 'Assista aos anúncios até o fim para ganhar GG. Cada anúncio tem um limite por dia.'));
  if (!ads.length) return body.appendChild(h('div', { class: 'empty' }, h('span', { class: 'spark' }, '✦'), 'Nenhum anúncio disponível agora. Volte mais tarde!'));
  for (const ad of ads) {
    body.appendChild(h('div', { class: 'ad-card' },
      h('div', { class: 'thumb' }, ad.mediaKind === 'video' ? h('video', { src: ad.mediaUrl, muted: true, preload: 'metadata' }) : h('img', { src: ad.mediaUrl, alt: '' })),
      h('div', null, h('b', null, ad.title), ad.description ? h('div', { class: 'muted', style: { fontSize: '.9em' } }, ad.description) : null,
        h('div', { class: 'row wrap', style: { marginTop: '6px' } }, h('span', { class: 'chip gold' }, `+${ad.reward} GG`), h('span', { class: 'chip' }, `${ad.watchSeconds} s`), h('span', { class: 'chip' }, `${ad.remainingToday}/${ad.dailyLimit} hoje`))),
      h('button', { class: 'btn primary', disabled: !ad.remainingToday, onClick: () => watch(ad) }, icon('play', 15), ad.remainingToday ? 'Assistir' : 'Volte amanhã')));
  }
}

async function watch(ad) {
  let start;
  try { start = await POST(`/ads/${ad.id}/start`); } catch { return; }
  const total = start.watchSeconds;
  let elapsed = 0; let done = false;
  const bar = h('i');
  const label = h('span', { class: 'muted' }, `Faltam ${total} s`);
  const claimBtn = h('button', { class: 'btn gold', disabled: true }, icon('coin', 16), `Resgatar +${start.reward} GG`);
  const media = ad.mediaKind === 'video' ? h('video', { src: ad.mediaUrl, autoplay: true, muted: true, loop: true, playsinline: true }) : h('img', { src: ad.mediaUrl, alt: ad.title });
  const body = h('div', { style: { position: 'relative' } },
    h('div', { class: 'ad-player' }, media),
    h('div', { class: 'ad-progress' }, bar),
    h('div', { class: 'row between' }, label, ad.linkUrl ? h('a', { class: 'btn sm ghost', href: ad.linkUrl, target: '_blank', rel: 'noopener noreferrer nofollow' }, 'Saiba mais') : h('span')));
  const m = modal({ title: ad.title, size: 'wide', body, foot: [claimBtn], onClose: () => clearInterval(iv) });
  // o tempo só conta com a aba visível; o servidor também confere o tempo mínimo
  const iv = setInterval(() => {
    if (document.hidden || done) return;
    elapsed += 0.25;
    bar.style.width = `${Math.min(100, (elapsed / total) * 100)}%`;
    const left = Math.max(0, Math.ceil(total - elapsed));
    label.textContent = left ? `Faltam ${left} s` : 'Pronto! Resgate sua recompensa.';
    if (elapsed >= total + 0.3) { done = true; claimBtn.disabled = false; clearInterval(iv); }
  }, 250);
  claimBtn.addEventListener('click', async () => {
    claimBtn.disabled = true;
    try {
      const r = await POST(`/ads/views/${start.viewId}/claim`);
      state.me.gg = r.balance;
      playEffect(m.el, { kind: 'confetti', colors: ['#f5c542', '#9d4dff', '#ffffff', '#ff4dd8'] }, { duration: 2200 });
      toast(`Você ganhou ${r.reward} GG! 💰`, 'gold');
      setTimeout(() => { m.close(); renderShop(); }, 1600);
    } catch { claimBtn.disabled = false; }
  });
}

async function renderHistory(body) {
  const w = await GET('/wallet');
  clear(body);
  body.appendChild(h('div', { class: 'card row between' }, h('div', null, h('div', { class: 'label' }, 'Saldo atual'), h('b', { style: { fontSize: '1.8em', fontFamily: 'var(--display)', color: 'var(--gold-2)' } }, fmtGG(w.balance))), icon('coin', 40)));
  if (!w.transactions.length) return body.appendChild(h('div', { class: 'empty' }, 'Nenhuma movimentação ainda.'));
  const tbl = h('table', { class: 'tbl' }, h('tr', null, h('th', null, 'Quando'), h('th', null, 'Descrição'), h('th', null, 'Valor'), h('th', null, 'Saldo')));
  for (const t of w.transactions) tbl.appendChild(h('tr', null, h('td', null, fmtRelative(t.created_at)), h('td', null, t.reason),
    h('td', { style: { color: t.amount > 0 ? 'var(--ok)' : 'var(--danger)', fontWeight: 800 } }, `${t.amount > 0 ? '+' : ''}${t.amount}`), h('td', null, fmtGG(t.balance_after))));
  body.appendChild(tbl);
}
