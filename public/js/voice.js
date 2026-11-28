// Canais de voz das comunidades (estilo Discord): entra e sai livremente, malha WebRTC entre os participantes
import { state, emit, GET, h, clear, icon, iconBtn, toast, avatar, roleMark, sound } from './core.js';
import { layout } from './app.js';

let vc = null;                    // conexão de voz ativa
const states = new Map();         // channelId -> participantes (vindos do servidor)
let iceServers = null;
const ack = (ev, d) => new Promise(r => state.socket.emit(ev, d, r));
const audioRoot = () => document.getElementById('voice-audio') || document.body.appendChild(h('div', { id: 'voice-audio', style: { display: 'none' } }));

export const current = () => vc;
export const participants = id => states.get(id) || [];

export function bindSocket(s) {
  s.on('voice:state', st => { states.set(st.channelId, st.participants); emit('voice:state', st); if (vc?.channelId === st.channelId) drawStage(); });
  s.on('voice:peer-left', ({ channelId, userId }) => { if (vc?.channelId === channelId) dropPeer(userId); });
  s.on('voice:peer-joined', ({ channelId, user }) => { if (vc?.channelId === channelId) { vc.users.set(user.id, user); sound('notify'); } });
  s.on('voice:signal', onSignal);
  s.on('voice:kicked', ({ channelId }) => { if (vc?.channelId === channelId) { cleanup(); toast('Você entrou na voz por outro dispositivo.'); } });
}
export async function refreshStates(channelIds) {
  if (!channelIds.length || !state.socket) return;
  const list = await ack('voice:list', { channelIds });
  for (const st of list || []) states.set(st.channelId, st.participants);
  emit('voice:state', {});
}

// ===================== ENTRAR / SAIR =====================
export async function join(channel, community) {
  if (vc?.channelId === channel.id) return showStage();
  if (vc) leave(true);
  let local;
  try { local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch { return toast('Permita o acesso ao microfone para entrar na sala de voz.', 'error'); }
  if (!iceServers) iceServers = (await GET('/calls/ice', { silent: true }).catch(() => ({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }))).iceServers;
  const r = await ack('voice:join', { channelId: channel.id });
  if (r.error) { local.getTracks().forEach(t => t.stop()); return toast(r.error, 'error'); }
  vc = { channelId: channel.id, name: channel.name, community, local, peers: new Map(), users: new Map(), muted: false, deaf: false, cam: null, screen: null, pending: new Map(), speaking: new Set() };
  for (const p of participants(channel.id)) vc.users.set(p.id, p);
  watchLevel(state.me.id, local);
  sound('send');
  for (const uid of r.participants) await connect(uid, true);
  emit('voice:changed');
  showStage();
}

export function leave(silent) {
  if (!vc) return;
  state.socket.emit('voice:leave', { channelId: vc.channelId });
  cleanup();
  if (!silent) sound('end');
}

function cleanup() {
  if (!vc) return;
  for (const [, p] of vc.peers) { p.pc.close(); p.audio?.remove(); }
  vc.local.getTracks().forEach(t => t.stop());
  vc.cam?.getTracks().forEach(t => t.stop());
  vc.screen?.getTracks().forEach(t => t.stop());
  clearInterval(vc.levelTimer);
  vc.ctx?.close().catch(() => {});
  const was = vc.channelId;
  vc = null;
  emit('voice:changed');
  if (state.view.convId === was && document.querySelector('.voice-stage')) {
    layout.setMain(h('div', { class: 'welcome' }, h('h2', null, 'Você saiu da sala de voz'), h('p', null, 'Escolha um canal ao lado.')));
  }
}

// ===================== WEBRTC =====================
async function newPeer(uid) {
  const pc = new RTCPeerConnection({ iceServers });
  const peer = { pc, stream: new MediaStream() };
  vc.peers.set(uid, peer);
  pc.onicecandidate = e => e.candidate && state.socket.emit('voice:signal', { channelId: vc.channelId, to: uid, data: { candidate: e.candidate } });
  pc.ontrack = e => {
    if (!peer.stream.getTracks().includes(e.track)) peer.stream.addTrack(e.track);
    if (e.track.kind === 'audio' && !peer.audio) {
      peer.audio = h('audio', { autoplay: true }); peer.audio.srcObject = peer.stream; peer.audio.muted = vc.deaf;
      audioRoot().appendChild(peer.audio);
      watchLevel(uid, peer.stream);
    }
    e.track.onunmute = () => drawStage();
    drawStage();
  };
  pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') toast('Falha de conexão com um participante (rede restritiva? configure TURN).', 'error'); };
  return peer;
}
const videoTrack = () => vc.screen?.getVideoTracks()[0] || vc.cam?.getVideoTracks()[0] || null;

async function connect(uid, offer) {
  const peer = await newPeer(uid);
  peer.pc.addTransceiver(vc.local.getAudioTracks()[0], { direction: 'sendrecv', streams: [vc.local] });
  peer.pc.addTransceiver(videoTrack() || 'video', { direction: 'sendrecv', streams: [vc.local] });
  if (offer) {
    await peer.pc.setLocalDescription(await peer.pc.createOffer());
    state.socket.emit('voice:signal', { channelId: vc.channelId, to: uid, data: { sdp: peer.pc.localDescription } });
  }
}

async function onSignal({ channelId, from, data }) {
  if (!vc || vc.channelId !== channelId) return;
  let peer = vc.peers.get(from);
  try {
    if (data.sdp?.type === 'offer') {
      if (!peer) {
        peer = await newPeer(from);
        await peer.pc.setRemoteDescription(data.sdp);
        for (const tr of peer.pc.getTransceivers()) {
          tr.direction = 'sendrecv';
          await tr.sender.replaceTrack(tr.receiver.track.kind === 'audio' ? vc.local.getAudioTracks()[0] : videoTrack());
        }
      } else await peer.pc.setRemoteDescription(data.sdp);
      await peer.pc.setLocalDescription(await peer.pc.createAnswer());
      state.socket.emit('voice:signal', { channelId, to: from, data: { sdp: peer.pc.localDescription } });
      flush(from);
    } else if (data.sdp && peer) { await peer.pc.setRemoteDescription(data.sdp); flush(from); }
    else if (data.candidate) {
      if (!peer || !peer.pc.remoteDescription) { vc.pending.set(from, [...(vc.pending.get(from) || []), data.candidate]); return; }
      await peer.pc.addIceCandidate(data.candidate);
    }
  } catch (e) { console.warn('[voz]', e); }
}
async function flush(uid) {
  const p = vc.peers.get(uid);
  for (const c of vc.pending.get(uid) || []) await p.pc.addIceCandidate(c).catch(() => {});
  vc.pending.delete(uid);
}
function dropPeer(uid) {
  const p = vc.peers.get(uid);
  if (p) { p.pc.close(); p.audio?.remove(); vc.peers.delete(uid); }
  vc.speaking.delete(uid);
  drawStage();
}

// indicador de quem está falando
function watchLevel(uid, stream) {
  try {
    vc.ctx = vc.ctx || new (window.AudioContext || window.webkitAudioContext)();
    const src = vc.ctx.createMediaStreamSource(stream);
    const an = vc.ctx.createAnalyser(); an.fftSize = 512; src.connect(an);
    (vc.analysers = vc.analysers || new Map()).set(uid, an);
    if (!vc.levelTimer) {
      const buf = new Uint8Array(256);
      vc.levelTimer = setInterval(() => {
        if (!vc) return;
        let changed = false;
        for (const [id, a] of vc.analysers) {
          a.getByteFrequencyData(buf);
          const lvl = buf.reduce((x, y) => x + y, 0) / buf.length;
          const talking = lvl > 18 && !(id === state.me.id && vc.muted);
          if (talking !== vc.speaking.has(id)) { talking ? vc.speaking.add(id) : vc.speaking.delete(id); changed = true; }
        }
        if (changed) { document.querySelectorAll('[data-voice-uid]').forEach(el => el.classList.toggle('speaking', vc.speaking.has(Number(el.dataset.voiceUid)))); }
      }, 150);
    }
  } catch { /* sem analisador */ }
}

// ===================== CONTROLES =====================
function sync() { state.socket.emit('voice:update', { channelId: vc.channelId, muted: vc.muted, deaf: vc.deaf, video: !!videoTrack(), screen: !!vc.screen }); emit('voice:changed'); drawStage(); }
export function toggleMute() { if (!vc) return; vc.muted = !vc.muted; if (vc.deaf && !vc.muted) vc.deaf = false; vc.local.getAudioTracks().forEach(t => { t.enabled = !vc.muted; }); applyDeaf(); sync(); }
export function toggleDeaf() { if (!vc) return; vc.deaf = !vc.deaf; if (vc.deaf) vc.muted = true; vc.local.getAudioTracks().forEach(t => { t.enabled = !vc.muted; }); applyDeaf(); sync(); }
function applyDeaf() { for (const [, p] of vc.peers) if (p.audio) p.audio.muted = vc.deaf; }
async function setVideo(track) { for (const [, p] of vc.peers) { const tr = p.pc.getTransceivers().find(t => t.receiver.track.kind === 'video'); if (tr) await tr.sender.replaceTrack(track).catch(() => {}); } }
export async function toggleCam() {
  if (!vc) return;
  if (vc.cam) { vc.cam.getTracks().forEach(t => t.stop()); vc.cam = null; }
  else { try { vc.cam = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } }); } catch { return toast('Não foi possível acessar a câmera.', 'error'); } }
  await setVideo(videoTrack()); sync();
}
export async function toggleScreen() {
  if (!vc) return;
  if (vc.screen) { vc.screen.getTracks().forEach(t => t.stop()); vc.screen = null; }
  else {
    try { vc.screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }); } catch { return; }
    vc.screen.getVideoTracks()[0].onended = () => { if (vc?.screen) toggleScreen(); };
  }
  await setVideo(videoTrack()); sync();
}

// ===================== INTERFACE =====================
export function controls(compact) {
  if (!vc) return null;
  const b = (ic, title, fn, off) => iconBtn(ic, title, fn, off ? 'off' : '');
  return [
    b(vc.muted ? 'micoff' : 'mic', vc.muted ? 'Ativar microfone' : 'Silenciar microfone', toggleMute, vc.muted),
    b('headphones', vc.deaf ? 'Ativar áudio' : 'Ensurdecer (não ouvir ninguém)', toggleDeaf, vc.deaf),
    b(vc.cam ? 'video' : 'videooff', vc.cam ? 'Desligar câmera' : 'Ligar câmera', toggleCam, !vc.cam),
    navigator.mediaDevices?.getDisplayMedia ? b('screen', vc.screen ? 'Parar de compartilhar' : 'Compartilhar tela', toggleScreen, false) : null,
    h('button', { class: 'icon-btn', title: 'Sair da sala', style: { color: '#fff', background: 'var(--danger)' }, onClick: () => leave() }, icon('hangup')),
    compact ? null : null
  ];
}

// barra fixa no rodapé da lista de canais enquanto conectado
export function voiceBar() {
  if (!vc) return null;
  return h('div', { class: 'voice-bar' },
    h('div', { class: 'status' }, icon('volume', 15), 'Voz conectada', h('span', { class: 'faint', style: { fontWeight: 600 } }, ` · ${vc.name}`)),
    h('div', { class: 'btns' }, controls(true)),
    h('button', { class: 'btn sm ghost block', onClick: showStage }, 'Abrir sala'));
}

export function showStage() {
  if (!vc) return;
  state.view.convId = vc.channelId;
  emit('voice:changed');
  layout.setInfo(null);
  const stage = h('div', { class: 'voice-stage' });
  vc.stageEl = stage;
  layout.setMain(h('section', { class: 'main chat-bg-aurora', style: { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 } },
    h('header', { class: 'chat-head' }, iconBtn('back', 'Voltar', () => layout.back(), 'back'),
      h('div', { class: 'avatar square', style: { width: '40px', height: '40px', background: 'rgba(61,220,151,.15)', color: 'var(--ok)' } }, icon('volume', 20)),
      h('div', { class: 'grow' }, h('div', { class: 'title' }, vc.name), h('div', { class: 'status' }, vc.community?.name || 'Canal de voz'))),
    stage, h('div', { class: 'voice-controls' }, controls())), { inChat: true });
  drawStage();
}

function drawStage() {
  if (!vc?.stageEl?.isConnected) return;
  const st = clear(vc.stageEl);
  const list = participants(vc.channelId);
  const ids = list.length ? list : [{ ...state.me, muted: vc.muted }];
  for (const p of ids) {
    const me = p.id === state.me.id;
    const tile = h('div', { class: `voice-tile ${vc.speaking.has(p.id) ? 'speaking' : ''}`, dataset: { voiceUid: p.id } });
    let vtrack = null;
    if (me) vtrack = videoTrack();
    else { const peer = vc.peers.get(p.id); vtrack = peer?.stream.getVideoTracks().find(t => t.readyState === 'live' && !t.muted) || null; if (!p.video) vtrack = null; }
    if (vtrack) { const v = h('video', { autoplay: true, playsinline: true, muted: true }); v.srcObject = new MediaStream([vtrack]); if (me && !vc.screen) v.style.transform = 'scaleX(-1)'; tile.appendChild(v); }
    else tile.appendChild(avatar(p, 96));
    tile.appendChild(h('div', { class: 'tag' }, p.muted || p.deaf ? icon(p.deaf ? 'headphones' : 'micoff') : null, p.displayName, roleMark(p), p.screen ? ' · compartilhando tela' : ''));
    st.appendChild(tile);
  }
}
