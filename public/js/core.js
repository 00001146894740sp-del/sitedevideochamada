// Núcleo do front-end: API, estado, DOM seguro, ícones, modais e utilitários
// append() nativo converte null em texto "null"; filtramos valores vazios em todo o app
const nativeAppend = Element.prototype.append;
Element.prototype.append = function (...nodes) {
  return nativeAppend.apply(this, nodes.flat(Infinity).filter(n => n !== null && n !== undefined && n !== false));
};

export const state = {
  me: null, settings: null, privacy: null, config: {}, csrf: '',
  socket: null,
  convs: [], communities: [], friends: [],
  view: { section: 'chats', convId: null, communityId: null },
  typing: new Map(), // convId -> Map(userId -> {name, t})
  unreadNotifs: 0,
  infoOpen: window.innerWidth > 1180
};

// ---------- barramento de eventos local ----------
const bus = new Map();
export const on = (ev, fn) => { if (!bus.has(ev)) bus.set(ev, new Set()); bus.get(ev).add(fn); return () => bus.get(ev).delete(fn); };
export const emit = (ev, data) => bus.get(ev)?.forEach(fn => { try { fn(data); } catch (e) { console.error(e); } });

// ---------- API ----------
export async function api(method, path, body, { form, silent, onProgress } = {}) {
  const headers = {};
  if (state.csrf) headers['X-CSRF-Token'] = state.csrf;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  if (onProgress && form) {
    res = await xhrUpload(method, path, form, headers, onProgress);
  } else {
    try {
      res = await fetch('/api' + path, { method, headers, body: payload, credentials: 'same-origin' });
    } catch {
      const e = new Error('Sem conexão com o servidor.');
      if (!silent) toast(e.message, 'error');
      throw e;
    }
  }
  let data = null;
  const ct = res.headers?.get ? (res.headers.get('content-type') || '') : (res.contentType || '');
  if (ct.includes('json')) data = res.json ? await res.json() : res.data;
  if (!res.ok) {
    const e = new Error(data?.error || `Erro ${res.status}`);
    e.status = res.status; e.code = data?.code;
    if (res.status === 401 && state.me && !path.startsWith('/auth/')) { location.href = '/'; }
    if (!silent) toast(e.message, 'error');
    throw e;
  }
  if (data && data.csrfToken) state.csrf = data.csrfToken;
  return data;
}
function xhrUpload(method, path, form, headers, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open(method, '/api' + path);
    for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v);
    x.upload.onprogress = e => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => {
      let data = null; try { data = JSON.parse(x.responseText); } catch { /* */ }
      resolve({ ok: x.status < 400, status: x.status, contentType: 'json', data });
    };
    x.onerror = () => reject(new Error('Falha no envio.'));
    x.send(form);
  });
}
export const GET = (p, o) => api('GET', p, undefined, o);
export const POST = (p, b, o) => api('POST', p, b ?? {}, o);
export const PATCH = (p, b, o) => api('PATCH', p, b, o);
export const PUT = (p, b, o) => api('PUT', p, b, o);
export const DEL = (p, b, o) => api('DELETE', p, b, o);

// ---------- DOM seguro (nunca usa innerHTML com dados do usuário) ----------
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k === 'html') el.innerHTML = v; // somente para SVGs internos constantes
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export const clear = el => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const $ = (s, r = document) => r.querySelector(s);

// ---------- ícones (SVG próprios, traço) ----------
const P = {
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2 .7 3.2 2.4 3.5 5.2"/>',
  group: '<circle cx="12" cy="7.5" r="3"/><circle cx="5" cy="10" r="2.2"/><circle cx="19" cy="10" r="2.2"/><path d="M6.5 20c.5-3.3 2.7-5 5.5-5s5 1.7 5.5 5M1.5 18.5c.3-2 1.5-3.2 3.3-3.4M22.5 18.5c-.3-2-1.5-3.2-3.3-3.4"/>',
  planet: '<circle cx="12" cy="12" r="6"/><path d="M3.5 16.5c-2-1.6 1.6-5.2 8-7.9s11.7-3 12-.5c.2 1.4-1.8 3.4-5.2 5.4"/>',
  phone: '<path d="M5 3h3.5l1.8 4.6-2.3 1.5a11.5 11.5 0 0 0 5.9 5.9l1.5-2.3L20 14.5V18a2 2 0 0 1-2.2 2A16 16 0 0 1 3 5.2 2 2 0 0 1 5 3z"/>',
  video: '<rect x="2.5" y="6" width="13" height="12" rx="2.5"/><path d="M15.5 10.5 21.5 7v10l-6-3.5"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  shield: '<path d="M12 2.5 4 5.5v6c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10v-6z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  send: '<path d="M21.5 2.5 10.5 13.5M21.5 2.5l-7 19-4-8-8-4z"/>',
  clip: '<path d="m21 11.5-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l8-8"/>',
  smile: '<circle cx="12" cy="12" r="9.5"/><path d="M8 14.5s1.5 2 4 2 4-2 4-2"/><circle cx="9" cy="9.5" r=".6" fill="currentColor"/><circle cx="15" cy="9.5" r=".6" fill="currentColor"/>',
  mic: '<rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3.5"/>',
  micoff: '<path d="m2 2 20 20M9 9v2a3 3 0 0 0 5.1 2.1M15 9.3V5.5a3 3 0 0 0-5.7-1.3M5 11a7 7 0 0 0 11.4 5.4M19 11a7 7 0 0 1-.6 2.9M12 18v3.5"/>',
  videooff: '<path d="m2 2 20 20M15.5 10.5 21.5 7v10l-3-1.8M13 6h1.5a1 1 0 0 1 1 1v3M15.5 15.5V16a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2H6"/>',
  screen: '<rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 21h8M12 17v4M9 10.5l3-3 3 3M12 7.5v6"/>',
  hangup: '<path d="M3.5 14.5c4.7-4.7 12.3-4.7 17 0l-1.8 2.3-3.4-1.3V13a12 12 0 0 0-6.6 0v2.5l-3.4 1.3z"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="m4.5 12.5 5 5 10-11"/>',
  checks: '<path d="m1.5 12.5 5 5 10-11M11.5 16l1.5 1.5 10-11"/>',
  reply: '<path d="M9.5 14.5 4 9l5.5-5.5"/><path d="M4 9h10.5a6 6 0 0 1 6 6v5"/>',
  forward: '<path d="m14.5 14.5 5.5-5.5-5.5-5.5"/><path d="M20 9H9.5a6 6 0 0 0-6 6v5"/>',
  edit: '<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3.5 6h17M8.5 6V4h7v2M6 6l1 14h10l1-14M10 10.5v6M14 10.5v6"/>',
  pin: '<path d="M9 3.5h6l-1 6 4 3v2H6v-2l4-3zM12 14.5v6"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
  more: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
  info: '<circle cx="12" cy="12" r="9.5"/><path d="M12 11v6M12 7.5v.5"/>',
  back: '<path d="M15 5.5 8.5 12l6.5 6.5"/>',
  hash: '<path d="M5 9h15M4 15h15M10 3.5 8 20.5M16 3.5l-2 17"/>',
  megaphone: '<path d="M3.5 10v4l3 .5 11 4.5V5L6.5 9.5z"/><path d="M7 15l1.5 5h3l-1.2-4.2M21 10v4"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
  image: '<rect x="3" y="3.5" width="18" height="17" rx="3"/><circle cx="9" cy="9.5" r="2"/><path d="m21 16-5-5L5 20.5"/>',
  file: '<path d="M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z"/><path d="M14 2.5V8h5.5M8.5 13h7M8.5 17h5"/>',
  download: '<path d="M12 3.5v12M7 11l5 5 5-5M4.5 20.5h15"/>',
  logout: '<path d="M15 4.5h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3M10 16.5 14.5 12 10 7.5M14.5 12H3.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4.2 4-6.5 8-6.5s7.2 2.3 8 6.5"/>',
  userplus: '<circle cx="9.5" cy="8" r="4"/><path d="M2 21c.8-4.2 3.6-6.5 7.5-6.5s6.7 2.3 7.5 6.5M19 8v6M16 11h6"/>',
  flag: '<path d="M5 21.5V4M5 4.5c4-2.5 7 2.5 14 0v9c-7 2.5-10-2.5-14 0"/>',
  block: '<circle cx="12" cy="12" r="9.5"/><path d="m5.3 5.3 13.4 13.4"/>',
  archive: '<rect x="2.5" y="4" width="19" height="5" rx="1.5"/><path d="M4.5 9v9.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V9M10 13h4"/>',
  mute: '<path d="M11 5 6 9H2.5v6H6l5 4zM22 9l-6 6M16 9l6 6"/>',
  copy: '<rect x="8.5" y="8.5" width="12.5" height="12.5" rx="2.5"/><path d="M15.5 8.5V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8.5a2 2 0 0 0 2 2h3.5"/>',
  link: '<path d="M10 13.5a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 10.5a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  support: '<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="4"/><path d="m4.9 4.9 4.3 4.3M14.8 14.8l4.3 4.3M14.8 9.2l4.3-4.3M4.9 19.1l4.3-4.3"/>',
  sparkle: '<path d="M12 2.5c.6 4.8 2.7 6.9 7.5 7.5-4.8.6-6.9 2.7-7.5 7.5-.6-4.8-2.7-6.9-7.5-7.5 4.8-.6 6.9-2.7 7.5-7.5z" fill="currentColor" stroke="none"/>',
  crown: '<path d="m3 7 4.5 4L12 4.5 16.5 11 21 7l-2 11.5H5z"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5"/><path d="M3.5 3.5v5h5M12 7.5V12l3 2"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  palette: '<path d="M12 21.5a9.5 9.5 0 1 1 9.5-9.5c0 2.6-2.1 3.5-4 3.5h-1.8a1.8 1.8 0 0 0-1.3 3c.5.6.4 3-2.4 3z"/><circle cx="7.5" cy="11" r="1" fill="currentColor"/><circle cx="10.5" cy="7" r="1" fill="currentColor"/><circle cx="15.5" cy="7.5" r="1" fill="currentColor"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  devices: '<rect x="2" y="4" width="14" height="10" rx="1.5"/><path d="M5 18h8M9 14v4"/><rect x="17" y="8" width="5" height="12" rx="1.5"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m11 12 9.5-9.5M17 6l3 3M14.5 8.5l2 2"/>',
  data: '<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  sticker: '<path d="M15.5 3H6a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h7l8-8V6a3 3 0 0 0-3-3z"/><path d="M13 21v-5a3 3 0 0 1 3-3h5"/>',
  gif: '<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M10 10H8a1.5 1.5 0 0 0-1.5 1.5v1A1.5 1.5 0 0 0 8 14h1.5v-1.5M12.5 10v4M15.5 14v-4H18M15.5 12h2"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>',
  compass: '<circle cx="12" cy="12" r="9.5"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  inbox: '<path d="M21.5 12.5h-6l-2 3h-3l-2-3h-6"/><path d="M5.5 5h13l3 7.5V18a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2v-5.5z"/>',
  chart: '<path d="M3.5 3.5v17h17"/><path d="M7.5 15v-3M12 15V8M16.5 15v-5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  minimize: '<path d="M8 3.5v3a2 2 0 0 1-2 2H3M21 8.5h-3a2 2 0 0 1-2-2v-3M3 15.5h3a2 2 0 0 1 2 2v3M16 20.5v-3a2 2 0 0 1 2-2h3"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  volume: '<path d="M11 5 6 9H2.5v6H6l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  headphones: '<path d="M3.5 14v-2a8.5 8.5 0 0 1 17 0v2"/><rect x="3" y="14" width="5" height="7" rx="2"/><rect x="16" y="14" width="5" height="7" rx="2"/>',
  gem: '<path d="M6.5 3.5h11l4 5.5L12 21 2.5 9z"/><path d="M2.5 9h19M9 3.5 12 21l3-17.5"/>',
  bag: '<path d="M5 8h14l-1 12.5H6z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M14.5 9.2A3.2 3.2 0 0 0 12 8a4 4 0 0 0 0 8 3.6 3.6 0 0 0 3-1.5V12h-2.5"/>',
  play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>',
  door: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h8M14 3l5 1.5v15L14 21zM11 12h.01"/>'
};
export function icon(name, size) {
  const s = h('span', { class: 'ic', style: { display: 'inline-grid', placeItems: 'center' } });
  s.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="${size || 18}" height="${size || 18}" style="flex:none">${P[name] || P.sparkle}</svg>`;
  return s.firstChild;
}
export function iconBtn(name, title, onClick, cls = '') {
  return h('button', { class: `icon-btn ${cls}`, title, 'aria-label': title, type: 'button', onClick }, icon(name));
}

// ---------- toasts ----------
export function toast(msg, type = 'info', { title, onClick, timeout = 4200 } = {}) {
  const t = h('div', { class: `toast ${type}`, role: 'status' },
    h('div', { class: 'grow' }, title ? h('b', null, title) : null, title ? h('small', null, msg) : msg));
  t.addEventListener('click', () => { onClick?.(); t.remove(); });
  document.getElementById('toasts').appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, timeout);
}

// ---------- modais ----------
export function modal({ title, body, foot, size = '', onClose, closable = true }) {
  const root = document.getElementById('modals');
  const close = () => { back.remove(); document.removeEventListener('keydown', esc); onClose?.(); };
  const esc = e => { if (e.key === 'Escape' && closable && root.lastChild === back) close(); };
  const m = h('div', { class: `modal ${size}`, role: 'dialog', 'aria-modal': 'true' },
    title !== null ? h('div', { class: 'modal-head' }, h('h3', null, title || ''), closable ? iconBtn('x', 'Fechar', () => close()) : null) : null,
    h('div', { class: 'modal-body' }, body),
    foot ? h('div', { class: 'modal-foot' }, foot) : null);
  const back = h('div', { class: 'modal-back', onMousedown: e => { if (e.target === back && closable) close(); } }, m);
  root.appendChild(back);
  document.addEventListener('keydown', esc);
  setTimeout(() => m.querySelector('input:not([type=hidden]):not([type=checkbox]), textarea')?.focus(), 50);
  return { close, el: m };
}
export function confirmDialog(text, { title = 'Confirmar', confirmText = 'Confirmar', danger = false } = {}) {
  return new Promise(res => {
    let done = false;
    const m = modal({
      title, body: h('p', { class: 'muted', style: { margin: 0 } }, text),
      foot: [h('button', { class: 'btn ghost', onClick: () => { done = true; m.close(); res(false); } }, 'Cancelar'),
        h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onClick: () => { done = true; m.close(); res(true); } }, confirmText)],
      onClose: () => { if (!done) res(false); }
    });
  });
}
export function promptDialog(label, { title = '', value = '', placeholder = '', multiline = false, confirmText = 'Salvar', type = 'text' } = {}) {
  return new Promise(res => {
    let done = false;
    const input = multiline ? h('textarea', { class: 'textarea', value, placeholder }) : h('input', { class: 'input', value, placeholder, type });
    const submit = () => { done = true; m.close(); res(input.value); };
    if (!multiline) input.addEventListener('keydown', e => e.key === 'Enter' && submit());
    const m = modal({
      title, body: h('label', { class: 'field' }, h('span', null, label), input),
      foot: [h('button', { class: 'btn ghost', onClick: () => { done = true; m.close(); res(null); } }, 'Cancelar'), h('button', { class: 'btn primary', onClick: submit }, confirmText)],
      onClose: () => { if (!done) res(null); }
    });
  });
}

// ---------- menu de contexto ----------
let openMenu = null;
export function menu(anchorOrEvent, items, { emojis } = {}) {
  closeMenu();
  const m = h('div', { class: 'menu', role: 'menu' });
  if (emojis) m.appendChild(h('div', { class: 'menu-emoji' }, emojis.list.map(e => h('button', { onClick: () => { closeMenu(); emojis.pick(e); } }, e))));
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { m.appendChild(h('hr')); continue; }
    m.appendChild(h('button', { class: it.danger ? 'danger' : '', role: 'menuitem', onClick: () => { closeMenu(); it.onClick(); } }, it.icon ? icon(it.icon) : null, it.label));
  }
  document.body.appendChild(m);
  let x, y;
  if (anchorOrEvent instanceof Event && anchorOrEvent.clientX) { x = anchorOrEvent.clientX; y = anchorOrEvent.clientY; }
  else { const r = (anchorOrEvent.currentTarget || anchorOrEvent.target || anchorOrEvent).getBoundingClientRect(); x = r.left; y = r.bottom + 6; }
  const mr = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(x, innerWidth - mr.width - 8)) + 'px';
  m.style.top = (y + mr.height > innerHeight - 8 ? Math.max(8, y - mr.height - 12) : y) + 'px';
  openMenu = m;
  setTimeout(() => document.addEventListener('mousedown', outside), 0);
  return m;
}
function outside(e) { if (openMenu && !openMenu.contains(e.target)) closeMenu(); }
export function closeMenu() { openMenu?.remove(); openMenu = null; document.removeEventListener('mousedown', outside); }

// ---------- formatação ----------
export const fmtTime = d => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
export function fmtDay(d) {
  const x = new Date(d); const now = new Date();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (x.toDateString() === now.toDateString()) return 'Hoje';
  if (x.toDateString() === y.toDateString()) return 'Ontem';
  return x.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: x.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}
export function fmtShort(d) {
  const x = new Date(d); const now = new Date();
  if (x.toDateString() === now.toDateString()) return fmtTime(x);
  if (now - x < 6 * 86400000) return x.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
  return x.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
export function fmtRelative(d) {
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  if (s < 604800) return `há ${Math.floor(s / 86400)} d`;
  return new Date(d).toLocaleDateString('pt-BR');
}
export const fmtDate = d => new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
export function fmtSize(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(2)} GB`;
}
export const fmtDur = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export const PRESENCE_LABEL = { online: 'Online', away: 'Ausente', busy: 'Ocupado', invisible: 'Invisível', offline: 'Offline' };
export const ROLE_LABEL = { owner: 'Dono', admin: 'Administrador', moderator: 'Moderador', support: 'Suporte', user: 'Usuário', member: 'Membro' };

// ---------- avatar ----------
const COLORS = ['#9d4dff', '#ff4dd8', '#4d7cff', '#3ddc97', '#f5a142', '#ff4d6d', '#2ec5d3', '#c18bff'];
export function avatar(u, size = 40, { presence, square, story } = {}) {
  const name = u?.displayName || u?.name || '?';
  const color = u?.color || COLORS[(u?.id || name.length) % COLORS.length];
  const el = h('div', { class: `avatar ${square ? 'square' : ''}`, style: { width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.38) + 'px' } });
  if (u?.avatar || u?.logo) el.appendChild(h('img', { src: u.avatar || u.logo, alt: '', loading: 'lazy' }));
  else el.appendChild(h('span', { class: 'initials', style: { background: `linear-gradient(135deg, ${color}, #2b0b5c)` } }, initials(name)));
  if (u?.frame && !square) el.appendChild(frameEl(u.frame));
  if (presence) el.appendChild(h('span', { class: `presence ${presence}`, title: PRESENCE_LABEL[presence] || '' }));
  void story;
  return el;
}
// moldura de avatar (item da loja)
export function frameEl(cfg) {
  const kind = cfg.kind || 'ring';
  if (kind === 'image') return h('span', { class: 'frame image' }, h('img', { src: cfg.imageUrl, alt: '' }));
  const c = (cfg.colors && cfg.colors.length ? cfg.colors : ['#f5c542']);
  const bg = kind === 'spin' ? `conic-gradient(${[...c, c[0]].join(',')})` : c.length > 1 ? `linear-gradient(135deg, ${c.join(',')})` : c[0];
  return h('span', { class: `frame ${kind}`, style: { background: bg, '--glow': c[c.length - 1] } });
}
// ===================== SELOS E TAGS (UI ou PNG, configuráveis pelo dono) =====================
const DEFAULT_BADGES = {
  verified: { mode: 'ui', text: 'VERIFICADO', colors: ['#9d4dff', '#f5c542'], textColor: '#ffffff', icon: 'check' },
  owner: { mode: 'ui', text: 'DONO', colors: ['#ffe08a', '#f5c542'], textColor: '#2a1600' },
  admin: { mode: 'ui', text: 'ADMIN', colors: ['#c18bff', '#9d4dff'], textColor: '#ffffff' },
  moderator: { mode: 'ui', text: 'MOD', colors: ['#4dd0ff', '#4d7cff'], textColor: '#ffffff' },
  support: { mode: 'ui', text: 'SUPORTE', colors: ['#3ddc97', '#1fa971'], textColor: '#04140c' }
};
const grad = c => (c && c.length > 1 ? `linear-gradient(135deg, ${c.join(',')})` : (c && c[0]) || '#9d4dff');
export function badgeEl(key, style) {
  const st = style || state.config?.badgeStyles?.[key] || DEFAULT_BADGES[key];
  if (!st || st.mode === 'off') return null;
  const title = { verified: 'Verificado', owner: 'Dono da plataforma', admin: 'Administrador', moderator: 'Moderador', support: 'Suporte' }[key] || st.text;
  if (st.mode === 'png' && st.imageUrl) return h('img', { class: 'badge-png', src: st.imageUrl, alt: title, title });
  const el = h('span', { class: 'ui-badge', title, style: { background: grad(st.colors), color: st.textColor || '#fff' } });
  if (st.icon === 'check') el.appendChild(icon('check', 11));
  el.appendChild(document.createTextNode(st.text || ''));
  return el;
}
export function serverTagEl(tag) {
  if (!tag || !tag.text) return null;
  const cid = tag.communityId;
  const el = h(cid ? 'button' : 'span', { class: 'server-tag' + (cid ? ' clickable' : ''), type: cid ? 'button' : undefined, title: tag.community ? `Tag de ${tag.community} — clique para ver o servidor` : 'Tag de servidor', style: { background: grad(tag.colors), color: tag.textColor || '#fff' },
    onClick: cid ? e => { e.stopPropagation(); e.preventDefault(); emit('open-server-tag', cid); } : undefined });
  if (tag.mode === 'png' && tag.imageUrl) el.appendChild(h('img', { src: tag.imageUrl, alt: '' }));
  else el.appendChild(document.createTextNode('#'));
  el.appendChild(document.createTextNode(tag.text));
  return el;
}
export const verifiedMark = () => badgeEl('verified');
export const initials = n => (n || '?').trim().split(/\s+/).slice(0, 2).map(w => [...w][0] || '').join('').toUpperCase();
export function roleMark(x) {
  if (!x) return null;
  if (typeof x === 'string') return roleMarkOnly(x);
  const parts = [serverTagEl(x.tag), x.verified ? badgeEl('verified') : null, roleMarkOnly(x.role)].filter(Boolean);
  return parts.length ? h('span', { class: 'name-tags' }, parts) : null;
}
function roleMarkOnly(role) {
  return ['owner', 'admin', 'moderator', 'support'].includes(role) ? badgeEl(role) : null;
}

// ---------- texto rico seguro (links, menções, *negrito*, _itálico_, `código`) ----------
export function richText(text, { onMention } = {}) {
  const frag = document.createDocumentFragment();
  const re = /(https?:\/\/[^\s<>"']+)|(@[a-zA-Z0-9_.]{3,24})|(`[^`\n]+`)|(\*[^*\n]+\*)|(_[^_\n]+_)/g;
  let last = 0; let m;
  while ((m = re.exec(text))) {
    if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
    const [full] = m;
    if (m[1]) {
      let url = full.replace(/[.,;:!?)]+$/, '');
      const rest = full.slice(url.length);
      frag.appendChild(h('a', { href: url, target: '_blank', rel: 'noopener noreferrer nofollow' }, url));
      if (rest) frag.appendChild(document.createTextNode(rest));
    } else if (m[2]) frag.appendChild(h('span', { class: 'mention', onClick: () => onMention?.(full.slice(1)) }, full));
    else if (m[3]) frag.appendChild(h('code', null, full.slice(1, -1)));
    else if (m[4]) frag.appendChild(h('b', null, full.slice(1, -1)));
    else if (m[5]) frag.appendChild(h('i', null, full.slice(1, -1)));
    last = m.index + full.length;
  }
  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
  return frag;
}

// ---------- sons (gerados, sem arquivos externos) ----------
let actx;
export function sound(kind) {
  if (!state.settings?.sounds) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const notes = { message: [880, 1320], notify: [660, 990], ring: [523, 659, 784], end: [440, 330], send: [1200] }[kind] || [800];
    notes.forEach((f, i) => {
      const o = actx.createOscillator(); const g = actx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, actx.currentTime + i * 0.09);
      g.gain.exponentialRampToValueAtTime(0.12, actx.currentTime + i * 0.09 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + i * 0.09 + 0.18);
      o.connect(g).connect(actx.destination);
      o.start(actx.currentTime + i * 0.09); o.stop(actx.currentTime + i * 0.09 + 0.2);
    });
  } catch { /* sem áudio */ }
}

// ---------- notificações do navegador ----------
export function desktopNotify(title, body, onClick) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || document.hasFocus()) return;
  const n = new Notification(title, { body, icon: '/img/logo-192.png', silent: true });
  n.onclick = () => { window.focus(); onClick?.(); n.close(); };
}

// ---------- seletor de arquivo ----------
export function pickFiles({ accept = '', multiple = false } = {}) {
  return new Promise(res => {
    const i = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    i.addEventListener('change', () => { res([...i.files]); i.remove(); });
    document.body.appendChild(i); i.click();
  });
}

export function lightbox(url, kind = 'image', name = '') {
  const media = kind === 'video' ? h('video', { src: url, controls: true, autoplay: true }) : h('img', { src: url, alt: name });
  const lb = h('div', { class: 'lightbox', onClick: e => { if (e.target === lb) lb.remove(); } }, media,
    h('div', { class: 'lb-tools' },
      h('a', { class: 'icon-btn', href: url + '?download=1', title: 'Baixar' }, icon('download')),
      iconBtn('x', 'Fechar', () => lb.remove())));
  const esc = e => { if (e.key === 'Escape') { lb.remove(); document.removeEventListener('keydown', esc); } };
  document.addEventListener('keydown', esc);
  document.body.appendChild(lb);
}

export const copy = async text => { try { await navigator.clipboard.writeText(text); toast('Copiado!', 'ok'); } catch { toast('Não foi possível copiar.', 'error'); } };

export function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', null, label), input, hint ? h('small', { class: 'hint' }, hint) : null);
}
export function switchEl(checked, onChange) {
  const i = h('input', { type: 'checkbox', checked });
  i.addEventListener('change', () => onChange(i.checked));
  return h('label', { class: 'switch' }, i, h('span'));
}
export function tabs(list, active, onPick) {
  const el = h('div', { class: 'tabs', role: 'tablist' });
  const render = cur => {
    clear(el);
    for (const [k, label] of list) el.appendChild(h('button', { class: k === cur ? 'on' : '', role: 'tab', onClick: () => { render(k); onPick(k); } }, label));
  };
  render(active);
  return el;
}

export const EMOJI = {
  'Recentes': [],
  'Carinhas': '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😮‍💨 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 🤯 🤠 🥳 🥸 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 ☠️ 💩 🤡 👹 👺 👻 👽 👾 🤖'.split(' '),
  'Gestos': '👋 🤚 🖐️ ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💅 🤳 💪 🦾 🧠 👀 👁️ 👅 👄 🫶 🫡'.split(' '),
  'Corações': '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ♥️ 💯 💢 💥 💫 💦 💨 🕳️ 💬 💭 💤'.split(' '),
  'Diversão': '🔥 ✨ ⭐ 🌟 ⚡ 🎉 🎊 🎁 🏆 🥇 🎮 🕹️ 🎲 🎯 🎧 🎤 🎸 🎹 🥁 🎬 📸 🍕 🍔 🍟 🌮 🍿 🍩 🍪 🎂 🍫 🍺 🥤 ☕ 🧋 ⚽ 🏀 🏈 🎾 🏐 🥊 🚀 🛸 🌙 ☀️ 🌈 ❄️ 🌊 🍀 🌹 🌸 🐶 🐱 🦊 🐼 🐸 🦄 🐉 🐙'.split(' '),
  'Símbolos': '✅ ❌ ⚠️ ❗ ❓ 💲 💎 👑 🔔 🔕 📌 📎 🔗 🔒 🔓 🛡️ ⚙️ 🧩 📢 📣 💡 📅 ⏰ ⌛ 🆗 🆕 🆒 🔝 ♻️ ➕ ➖ ✖️ ➗ ♾️'.split(' ')
};
export function recentEmojis() {
  try { return JSON.parse(localStorage.getItem('ngg_recent_emoji') || '[]'); } catch { return []; }
}
export function pushRecentEmoji(e) {
  try {
    const list = [e, ...recentEmojis().filter(x => x !== e)].slice(0, 32);
    localStorage.setItem('ngg_recent_emoji', JSON.stringify(list));
  } catch { /* */ }
}

export function applyAppearance() {
  const s = state.settings || {};
  const root = document.documentElement;
  root.dataset.theme = s.theme || 'dark';
  root.dataset.bubble = s.bubbleStyle || 'rounded';
  root.dataset.motion = s.reduceMotion ? 'reduced' : '';
  root.dataset.contrast = s.highContrast ? 'high' : '';
  root.style.setProperty('--scale', s.fontScale || 1);
  const a = s.accent || '#9d4dff';
  root.style.setProperty('--accent', a);
  const n = parseInt(a.slice(1), 16);
  root.style.setProperty('--accent-rgb', `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`);
}

// ===================== EFEITOS DE PERFIL (partículas em canvas) =====================
export function playEffect(host, cfg, { duration = 3800 } = {}) {
  if (!cfg || state.settings?.reduceMotion) return;
  if (cfg.kind === 'gif') {
    if (!cfg.imageUrl) return;
    const img = h('img', { class: `fx-gif ${cfg.placement || 'full'}`, src: cfg.imageUrl + (cfg.imageUrl.includes('?') ? '&' : '?') + 't=' + Date.now(), alt: '' });
    host.appendChild(img);
    setTimeout(() => { img.classList.add('out'); setTimeout(() => img.remove(), 500); }, (cfg.duration || 4) * 1000);
    return;
  }
  const cv = h('canvas', { class: 'fx-canvas' });
  host.appendChild(cv);
  const r = host.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = r.width * dpr; cv.height = r.height * dpr;
  const W = r.width, H = r.height, ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
  const colors = cfg.colors?.length ? cfg.colors : ['#f5c542', '#9d4dff', '#ffffff'];
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const P = []; const kind = cfg.kind; const t0 = performance.now();
  const spawn = () => {
    if (kind === 'confetti') P.push({ x: rnd(0, W), y: -10, vx: rnd(-1, 1), vy: rnd(2, 4.5), r: rnd(0, 6), vr: rnd(-.2, .2), w: rnd(6, 11), h: rnd(3, 6), c: pick(colors) });
    else if (kind === 'snow') P.push({ x: rnd(0, W), y: -6, vx: 0, vy: rnd(.7, 1.8), s: rnd(2, 4.5), ph: rnd(0, 6), c: pick(colors) });
    else if (kind === 'sparkles') P.push({ x: rnd(0, W), y: H + 5, vx: rnd(-.3, .3), vy: -rnd(1, 2.6), s: rnd(3, 8), ph: rnd(0, 6), c: pick(colors), life: 1 });
    else if (kind === 'emoji') { const up = cfg.direction === 'up'; P.push({ x: rnd(0, W), y: up ? H + 20 : -20, vx: rnd(-.4, .4), vy: (up ? -1 : 1) * rnd(1.6, 3.2), e: pick(cfg.emoji || ['✨']), s: rnd(18, 34), r: rnd(-.3, .3) }); }
  };
  const burst = () => { const x = rnd(W * .15, W * .85), y = rnd(H * .1, H * .5), c = pick(colors); for (let i = 0; i < 46; i++) { const a = Math.PI * 2 * i / 46, sp = rnd(1.5, 4.2); P.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, c, life: 1, fw: true }); } };
  let lastBurst = 0;
  const star = (x, y, s) => { ctx.beginPath(); for (let i = 0; i < 8; i++) { const rr = i % 2 ? s * .35 : s; const a = i * Math.PI / 4; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } ctx.closePath(); ctx.fill(); };
  const frame = now => {
    const t = now - t0; ctx.clearRect(0, 0, W, H);
    const spawning = t < duration - 1200;
    if (spawning) {
      if (kind === 'fireworks') { if (t - lastBurst > 420) { burst(); lastBurst = t; } }
      else for (let i = 0; i < (kind === 'confetti' ? 4 : kind === 'emoji' ? 1 : 2); i++) if (Math.random() < .8) spawn();
    }
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      p.x += p.vx; p.y += p.vy;
      if (p.fw) { p.vy += .05; p.vx *= .985; p.life -= .012; }
      if (p.life !== undefined && kind === 'sparkles') p.life -= .006;
      const fade = Math.max(0, Math.min(1, (duration - t) / 900));
      ctx.globalAlpha = Math.max(0, (p.life ?? 1)) * fade;
      ctx.fillStyle = p.c || '#fff';
      if (kind === 'confetti') { p.r += p.vr; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore(); }
      else if (kind === 'snow') { p.ph += .03; p.x += Math.sin(p.ph) * .5; ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, 7); ctx.fill(); }
      else if (kind === 'sparkles') { p.ph += .15; ctx.globalAlpha *= .55 + .45 * Math.sin(p.ph); star(p.x, p.y, p.s); }
      else if (kind === 'emoji') { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.font = `${p.s}px serif`; ctx.fillText(p.e, -p.s / 2, p.s / 3); ctx.restore(); }
      else if (p.fw) { ctx.beginPath(); ctx.arc(p.x, p.y, 2.2, 0, 7); ctx.fill(); }
      if (p.y > H + 40 || p.y < -60 || (p.life !== undefined && p.life <= 0)) P.splice(i, 1);
    }
    ctx.globalAlpha = 1;
    if (t < duration && cv.isConnected) requestAnimationFrame(frame); else cv.remove();
  };
  requestAnimationFrame(frame);
}
export const RARITY = { comum: ['Comum', '#a99bc8'], raro: ['Raro', '#4dd0ff'], epico: ['Épico', '#c18bff'], lendario: ['Lendário', '#f5c542'] };
export const fmtGG = n => `${Number(n || 0).toLocaleString('pt-BR')} GG`;

// Conquistas/insígnias com ícone de linha (sem emoji)
const ACHIEVEMENT_ICON = { pioneer: 'compass', first_message: 'chat', social: 'users', founder: 'crown', storyteller: 'sparkle', caller: 'phone', staff: 'shield', verified: 'check', supporter: 'gem' };
export function achievementEl(b, attrs = {}) {
  return h('span', { class: `badge ach ${b.special ? 'special' : ''}`, title: b.description || '', ...attrs }, icon(ACHIEVEMENT_ICON[b.code] || 'star', 14), b.name);
}
