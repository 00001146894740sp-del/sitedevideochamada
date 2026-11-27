// Chamadas de voz/vídeo com WebRTC (malha P2P) e sinalização via Socket.IO
import { state, GET, h, clear, icon, iconBtn, toast, avatar, fmtDate, fmtDur, sound } from './core.js';
import { layout } from './app.js';
import * as chat from './chat.js';

let call = null;      // chamada ativa
let incoming = null;  // { payload, el, ringTimer }
let iceServers = null;

async function ice() {
  if (!iceServers) iceServers = (await GET('/calls/ice', { silent: true }).catch(() => ({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }))).iceServers;
  return iceServers;
}
const emitAck = (ev, data) => new Promise(res => state.socket.emit(ev, data, res));

export function bindSocket(s) {
  s.on('call:incoming', p => onIncoming(p));
  s.on('call:participant-joined', p => { if (call?.id === p.callId) { call.names.set(p.user.id, p.user); ensureTile(p.user.id); toast(`${p.user.displayName} entrou na chamada`, 'ok'); } });
  s.on('call:participant-left', p => { if (call?.id === p.callId) removePeer(p.userId); });
  s.on('call:declined', p => { if (call?.id === p.callId) toast(`${p.name} recusou a chamada`, 'error'); });
  s.on('call:signal', p => onSignal(p));
  s.on('call:media', p => { if (call?.id === p.callId) { const peer = call.peers.get(p.userId); if (peer) { peer.media = p; drawTile(p.userId); } } });
  s.on('call:ended', p => {
    if (incoming?.payload.callId === p.callId) closeIncoming();
    if (call?.id === p.callId) { cleanup(); toast(p.status === 'missed' ? 'Ninguém atendeu.' : 'Chamada encerrada.', p.status === 'missed' ? 'error' : 'info'); sound('end'); }
  });
  s.on('call:answered-elsewhere', p => { if (incoming?.payload.callId === p.callId && p.socketId !== s.id) closeIncoming(); });
}

export function onReconnect() {
  state.socket.emit('call:active', {}, list => {
    for (const c of list || []) if (!c.joined && !incoming && !call) toast('Há uma chamada em andamento.', 'gold', { title: 'Chamada', onClick: () => state.socket.emit('call:join', { callId: c.callId }, () => {}) });
  });
}

// ===================== INICIAR / RECEBER =====================
export async function startCall(conversationId, media = 'audio') {
  if (call) return toast('Você já está em uma chamada.', 'error');
  const local = await getMedia(media);
  if (!local) return;
  const r = await emitAck('call:start', { conversationId, media });
  if (r.error) { local.getTracks().forEach(t => t.stop()); return toast(r.error, 'error'); }
  const conv = state.convs.find(c => c.id === conversationId);
  setupCall({ id: r.callId, convId: conversationId, media, local, title: conv?.name || 'Chamada', ringing: true });
}

function onIncoming(p) {
  if (call) { if (!p.autoAccept) state.socket.emit('call:decline', { callId: p.callId }); return; }
  if (p.autoAccept) return accept(p);
  closeIncoming();
  const el = h('div', { class: 'call-incoming', role: 'alertdialog' },
    avatar(p.from, 52),
    h('div', { class: 'grow' }, h('b', null, p.convType === 'group' ? p.convName : p.from.displayName), h('div', { class: 'muted' }, `${p.convType === 'group' ? `${p.from.displayName} · ` : ''}${p.media === 'video' ? 'Chamada de vídeo' : 'Chamada de voz'} recebida…`)),
    h('button', { class: 'call-btn decline', title: 'Recusar', onClick: () => { state.socket.emit('call:decline', { callId: p.callId }); closeIncoming(); } }, icon('hangup')),
    h('button', { class: 'call-btn accept', title: 'Atender', onClick: () => accept(p) }, icon(p.media === 'video' ? 'video' : 'phone')));
  document.getElementById('call-root').appendChild(el);
  sound('ring');
  incoming = { payload: p, el, ringTimer: setInterval(() => sound('ring'), 2200) };
  if ('Notification' in window && Notification.permission === 'granted' && !document.hasFocus()) {
    const n = new Notification('NEW GG — chamada recebida', { body: `${p.from.displayName} está ligando`, icon: '/img/logo-192.png', requireInteraction: true });
    n.onclick = () => { window.focus(); n.close(); };
  }
}
function closeIncoming() {
  if (!incoming) return;
  clearInterval(incoming.ringTimer); incoming.el.remove(); incoming = null;
}

async function accept(p) {
  closeIncoming();
  const local = await getMedia(p.media);
  if (!local) { state.socket.emit('call:decline', { callId: p.callId }); return; }
  const r = await emitAck('call:accept', { callId: p.callId });
  if (r.error) { local.getTracks().forEach(t => t.stop()); return toast(r.error, 'error'); }
  const conv = state.convs.find(c => c.id === r.conversationId);
  setupCall({ id: r.callId, convId: r.conversationId, media: r.media, local, title: conv?.name || p.convName || p.from.displayName });
  call.names.set(p.from.id, p.from);
  // quem entra envia a oferta para cada participante já presente
  for (const uid of r.participants) await connectTo(uid, true);
}

async function getMedia(media) {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: media === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false });
  } catch {
    toast(media === 'video' ? 'Permita o acesso à câmera e ao microfone.' : 'Permita o acesso ao microfone.', 'error');
    return null;
  }
}

// ===================== SESSÃO DE CHAMADA =====================
function setupCall({ id, convId, media, local, title, ringing }) {
  call = { id, convId, media, local, title, peers: new Map(), names: new Map(), muted: false, camOff: media !== 'video', sharing: null, mini: false, started: null, ringing };
  const conv = state.convs.find(c => c.id === convId);
  const det = chat.current()?.detail;
  for (const m of det?.id === convId ? det.members || [] : []) call.names.set(m.id, m);
  if (conv?.other) call.names.set(conv.other.id, conv.other);
  render();
  call.timer = setInterval(() => { if (call?.timeEl) call.timeEl.textContent = call.started ? fmtDur((Date.now() - call.started) / 1000) : 'Chamando…'; }, 1000);
}

async function newPeer(uid) {
  const pc = new RTCPeerConnection({ iceServers: await ice() });
  const peer = { pc, stream: new MediaStream(), media: { audio: true, video: call.media === 'video' } };
  call.peers.set(uid, peer);
  pc.onicecandidate = e => e.candidate && state.socket.emit('call:signal', { callId: call.id, to: uid, data: { candidate: e.candidate } });
  pc.ontrack = e => { if (!peer.stream.getTracks().includes(e.track)) peer.stream.addTrack(e.track); drawTile(uid); };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected' && call && !call.started) { call.started = Date.now(); call.ringing = false; }
    if (pc.connectionState === 'failed') toast('Falha de conexão com um participante. Uma rede restritiva pode exigir servidor TURN.', 'error');
  };
  ensureTile(uid);
  return peer;
}

async function connectTo(uid, offer) {
  const peer = await newPeer(uid);
  const { pc } = peer;
  const audio = call.local.getAudioTracks()[0];
  const video = call.sharing?.getVideoTracks()[0] || call.local.getVideoTracks()[0] || null;
  pc.addTransceiver(audio || 'audio', { direction: 'sendrecv', streams: [call.local] });
  pc.addTransceiver(video || 'video', { direction: 'sendrecv', streams: [call.local] });
  if (offer) {
    await pc.setLocalDescription(await pc.createOffer());
    state.socket.emit('call:signal', { callId: call.id, to: uid, data: { sdp: pc.localDescription } });
  }
  return peer;
}

async function onSignal({ callId, from, data }) {
  if (!call || call.id !== callId) return;
  let peer = call.peers.get(from);
  try {
    if (data.sdp) {
      if (data.sdp.type === 'offer') {
        if (!peer) {
          peer = await newPeer(from);
          await peer.pc.setRemoteDescription(data.sdp);
          // associa as faixas locais aos transceptores criados pela oferta
          const trs = peer.pc.getTransceivers();
          const a = trs.find(t => t.receiver.track.kind === 'audio'); const v = trs.find(t => t.receiver.track.kind === 'video');
          if (a) { a.direction = 'sendrecv'; await a.sender.replaceTrack(call.local.getAudioTracks()[0] || null); a.sender.setStreams?.(call.local); }
          if (v) { v.direction = 'sendrecv'; await v.sender.replaceTrack(call.sharing?.getVideoTracks()[0] || call.local.getVideoTracks()[0] || null); v.sender.setStreams?.(call.local); }
        } else await peer.pc.setRemoteDescription(data.sdp);
        await peer.pc.setLocalDescription(await peer.pc.createAnswer());
        state.socket.emit('call:signal', { callId, to: from, data: { sdp: peer.pc.localDescription } });
        flushCandidates(peer);
      } else if (peer) { await peer.pc.setRemoteDescription(data.sdp); flushCandidates(peer); }
      if (!call.started) { call.started = Date.now(); call.ringing = false; }
      broadcastMedia();
    } else if (data.candidate) {
      if (!peer || !peer.pc.remoteDescription) { (call.pending ||= new Map()).set(from, [...(call.pending.get(from) || []), data.candidate]); return; }
      await peer.pc.addIceCandidate(data.candidate);
    }
  } catch (e) { console.warn('[call] sinal', e); }
}
async function flushCandidates(peer) {
  for (const [uid, list] of call.pending || []) {
    if (call.peers.get(uid) !== peer) continue;
    for (const c of list) await peer.pc.addIceCandidate(c).catch(() => {});
    call.pending.delete(uid);
  }
}

function removePeer(uid) {
  const p = call?.peers.get(uid);
  if (!p) return;
  p.pc.close(); call.peers.delete(uid);
  call.tiles?.get(uid)?.remove(); call.tiles?.delete(uid);
  const n = call.names.get(uid);
  if (n) toast(`${n.displayName} saiu da chamada`);
}

function broadcastMedia() {
  if (!call) return;
  state.socket.emit('call:media', { callId: call.id, audio: !call.muted, video: !call.camOff || !!call.sharing, screen: !!call.sharing });
}

function hangup() {
  if (!call) return;
  state.socket.emit('call:leave', { callId: call.id });
  cleanup();
  sound('end');
}
export const hangupAll = () => { if (call) state.socket.emit('call:leave', { callId: call.id }); };

function cleanup() {
  if (!call) return;
  clearInterval(call.timer);
  for (const [, p] of call.peers) p.pc.close();
  call.local?.getTracks().forEach(t => t.stop());
  call.sharing?.getTracks().forEach(t => t.stop());
  call.el?.remove();
  call = null;
  if (state.view.section === 'calls') renderCallsSide();
}

// ===================== CONTROLES =====================
function toggleMute() {
  call.muted = !call.muted;
  call.local.getAudioTracks().forEach(t => { t.enabled = !call.muted; });
  broadcastMedia(); render();
}
async function toggleCam() {
  if (call.camOff) {
    let track = call.local.getVideoTracks()[0];
    if (!track) {
      try { const s = await navigator.mediaDevices.getUserMedia({ video: true }); track = s.getVideoTracks()[0]; call.local.addTrack(track); } catch { return toast('Não foi possível acessar a câmera.', 'error'); }
    }
    track.enabled = true; call.camOff = false;
    if (!call.sharing) await setVideoTrack(track);
  } else {
    call.local.getVideoTracks().forEach(t => { t.enabled = false; });
    call.camOff = true;
  }
  broadcastMedia(); render();
}
async function toggleScreen() {
  if (call.sharing) {
    call.sharing.getTracks().forEach(t => t.stop()); call.sharing = null;
    await setVideoTrack(call.local.getVideoTracks()[0] || null);
  } else {
    try {
      call.sharing = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const t = call.sharing.getVideoTracks()[0];
      t.onended = () => { if (call?.sharing) toggleScreen(); };
      await setVideoTrack(t);
    } catch { return; }
  }
  broadcastMedia(); render();
}
async function setVideoTrack(track) {
  for (const [, p] of call.peers) {
    const tr = p.pc.getTransceivers().find(t => t.receiver.track.kind === 'video');
    if (tr) await tr.sender.replaceTrack(track).catch(() => {});
  }
}

// ===================== INTERFACE =====================
function ensureTile(uid) {
  if (!call?.grid) return;
  if (!call.tiles.has(uid)) { const t = h('div', { class: 'call-tile' }); call.tiles.set(uid, t); call.grid.appendChild(t); }
  drawTile(uid);
}
function drawTile(uid) {
  const tile = call?.tiles?.get(uid);
  if (!tile) return;
  const p = call.peers.get(uid);
  const u = call.names.get(uid) || { id: uid, displayName: 'Participante' };
  clear(tile);
  const hasVideo = p && p.stream.getVideoTracks().some(t => t.readyState === 'live') && p.media?.video !== false;
  if (hasVideo) { const v = h('video', { autoplay: true, playsinline: true }); v.srcObject = p.stream; tile.appendChild(v); }
  else { tile.appendChild(avatar(u, 84)); }
  // áudio sempre em elemento próprio (mesmo sem vídeo)
  if (p) { const a = h('audio', { autoplay: true }); a.srcObject = p.stream; tile.appendChild(a); }
  tile.appendChild(h('div', { class: 'tag' }, p?.media?.audio === false ? icon('micoff') : null, u.displayName, p?.media?.screen ? ' · 🖥️' : ''));
}

function render() {
  if (!call) return;
  if (!call.el) {
    call.el = h('div', { class: 'call-screen' });
    document.getElementById('call-root').appendChild(call.el);
  }
  const el = clear(call.el);
  el.classList.toggle('mini', call.mini);
  call.timeEl = h('span', { class: 'muted' }, call.started ? fmtDur((Date.now() - call.started) / 1000) : 'Chamando…');
  el.appendChild(h('div', { class: 'call-top' }, icon(call.media === 'video' ? 'video' : 'phone', 20), h('b', { class: 'grow ellipsis' }, call.title), call.timeEl,
    iconBtn(call.mini ? 'maximize' : 'minimize', call.mini ? 'Expandir' : 'Minimizar', () => { call.mini = !call.mini; render(); })));
  call.grid = h('div', { class: 'call-grid' });
  call.tiles = new Map();
  const me = h('div', { class: 'call-tile' });
  const videoTrack = call.sharing?.getVideoTracks()[0] || (!call.camOff && call.local.getVideoTracks()[0]);
  if (videoTrack) { const v = h('video', { autoplay: true, playsinline: true, muted: true, class: call.sharing ? '' : 'mirror' }); v.srcObject = new MediaStream([videoTrack]); me.appendChild(v); }
  else me.appendChild(avatar(state.me, 84));
  me.appendChild(h('div', { class: 'tag' }, call.muted ? icon('micoff') : null, 'Você', call.sharing ? ' · compartilhando tela' : ''));
  call.grid.appendChild(me);
  el.appendChild(call.grid);
  for (const uid of call.peers.keys()) ensureTile(uid);
  el.appendChild(h('div', { class: 'call-controls' },
    h('button', { class: `call-btn neutral ${call.muted ? 'off' : ''}`, title: call.muted ? 'Ativar microfone' : 'Silenciar microfone', onClick: toggleMute }, icon(call.muted ? 'micoff' : 'mic')),
    h('button', { class: `call-btn neutral ${call.camOff ? 'off' : ''}`, title: call.camOff ? 'Ligar câmera' : 'Desligar câmera', onClick: toggleCam }, icon(call.camOff ? 'videooff' : 'video')),
    navigator.mediaDevices?.getDisplayMedia ? h('button', { class: `call-btn neutral ${call.sharing ? 'off' : ''}`, title: 'Compartilhar tela', onClick: toggleScreen }, icon('screen')) : null,
    h('button', { class: 'call-btn decline', title: 'Encerrar', onClick: hangup }, icon('hangup'))));
}

// ===================== HISTÓRICO =====================
export async function renderCallsSide() {
  const list = h('div', { class: 'side-body' }, h('div', { class: 'spinner' }));
  layout.setSide(h('div', { style: { display: 'contents' } }, h('div', { class: 'side-head' }, h('h2', { class: 'side-title' }, h('span', { class: 'spark' }, '✦'), 'Chamadas'), h('p', { class: 'hint', style: { margin: 0 } }, 'Abra uma conversa e toque em 📞 ou 🎥 para ligar.')), list));
  const rows = await GET('/calls', { silent: true }).catch(() => []);
  clear(list);
  if (!rows.length) return list.appendChild(h('div', { class: 'empty' }, h('span', { class: 'spark' }, '✦'), 'Nenhuma chamada ainda.'));
  for (const c of rows) {
    const missed = !c.outgoing && (c.myState === 'missed' || c.status === 'missed');
    const who = c.convType === 'group' ? c.convName : c.others[0]?.displayName || 'Chamada';
    list.appendChild(h('div', { class: 'list-item' },
      avatar(c.convType === 'group' ? { displayName: c.convName } : c.others[0] || {}, 42, { square: c.convType === 'group' }),
      h('div', { class: 'meta', style: { cursor: 'pointer' }, onClick: () => chat.openChat(c.conversationId) },
        h('div', { class: 'name', style: missed ? { color: 'var(--danger)' } : null }, h('span', null, who)),
        h('div', { class: 'sub' }, `${c.outgoing ? '↗' : '↙'} ${c.media === 'video' ? 'Vídeo' : 'Voz'} · ${missed ? 'perdida' : c.status === 'declined' ? 'recusada' : c.duration ? fmtDur(c.duration) : c.status === 'missed' ? 'não atendida' : 'encerrada'} · ${fmtDate(c.startedAt)}`)),
      iconBtn(c.media === 'video' ? 'video' : 'phone', 'Ligar', () => startCall(c.conversationId, c.media))));
  }
}
