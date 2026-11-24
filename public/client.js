const socket = io();
const videosDiv = document.getElementById('videos');
const joinBtn = document.getElementById('joinBtn');
const roomInput = document.getElementById('roomInput');
const passInput = document.getElementById('passInput');
const roomListDiv = document.getElementById('roomList');

let localStream;
const peers = {};
const candidateQueues = {};

const rtcConfig = {
  iceServers: [
    { urls: 'stun:://google.com' },
    { urls: 'stun:://google.com' }
  ]
};

socket.on('rooms-list', (rooms) => {
  if (!rooms.length) {
    roomListDiv.innerHTML = 'Nenhuma sala ativa no momento.';
    return;
  }

  roomListDiv.innerHTML = '';
  rooms.forEach((room) => {
    const div = document.createElement('div');
    div.className = 'room-item';
    div.innerHTML = `
      <span>${room.hasPassword ? '🔒' : '🔓'} <b>${room.name}</b> (${room.count} online)</span>
      <button onclick="quickJoin('${room.name}', ${room.hasPassword})">Entrar</button>
    `;
    roomListDiv.appendChild(div);
  });
});

window.quickJoin = (name, hasPassword) => {
  roomInput.value = name;
  if (hasPassword) {
    const pwd = prompt(`A sala "${name}" tem senha. Digite a senha:`);
    if (pwd === null) return;
    passInput.value = pwd;
  } else {
    passInput.value = '';
  }
  joinRoom();
};

joinBtn.onclick = joinRoom;

async function joinRoom() {
  const roomId = roomInput.value.trim();
  const password = passInput.value;

  if (!roomId) return alert('Digite o nome da sala.');

  try {
    if (!localStream) {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    }
  } catch (err) {
    return alert('Erro ao abrir câmera/microfone: ' + err.message);
  }

  socket.emit('join-room', { roomId, password }, (res) => {
    if (res.error) return alert(res.error);

    document.getElementById('lobby').style.display = 'none';
    document.getElementById('callControls').style.display = 'block';
    document.getElementById('roomTitle').innerText = `Sala: ${roomId} `;

    addVideoElement('local', localStream, true, 'Você');
  });
}

function addVideoElement(id, stream, isMuted = false, labelText = '') {
  let wrapper = document.getElementById(`wrap-${id}`);
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.id = `wrap-${id}`;
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.alignItems = 'center';

    const video = document.createElement('video');
    video.id = `video-${id}`;
    video.autoplay = true;
    video.playsInline = true;
    video.muted = isMuted;

    const status = document.createElement('small');
    status.id = `status-${id}`;
    status.style.marginTop = '5px';
    status.style.color = '#aaa';
    status.innerText = labelText;

    wrapper.appendChild(video);
    wrapper.appendChild(status);
    videosDiv.appendChild(wrapper);
  }

  const videoEl = document.getElementById(`video-${id}`);
  if (stream && videoEl.srcObject !== stream) {
    videoEl.srcObject = stream;
    videoEl.play().catch(() => {});
  }
}

function updateStatus(id, text) {
  const el = document.getElementById(`status-${id}`);
  if (el) el.innerText = text;
}

socket.on('user-connected', async (userId) => {
  addVideoElement(userId, null, false, 'Chamando...');
  const peer = createPeer(userId);
  peers[userId] = peer;

  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  socket.emit('signal', { to: userId, signal: { sdp: peer.localDescription } });
});

socket.on('signal', async ({ from, signal }) => {
  let peer = peers[from];
  if (!peer) {
    addVideoElement(from, null, false, 'Recebendo conexão...');
    peer = createPeer(from);
    peers[from] = peer;
  }

  if (signal.sdp) {
    await peer.setRemoteDescription(new RTCSessionDescription(signal.sdp));

    if (candidateQueues[from]) {
      for (const cand of candidateQueues[from]) {
        await peer.addIceCandidate(new RTCIceCandidate(cand));
      }
      delete candidateQueues[from];
    }

    if (signal.sdp.type === 'offer') {
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      socket.emit('signal', { to: from, signal: { sdp: peer.localDescription } });
    }
  } else if (signal.candidate) {
    if (peer.remoteDescription && peer.remoteDescription.type) {
      await peer.addIceCandidate(new RTCIceCandidate(signal.candidate));
    } else {
      if (!candidateQueues[from]) candidateQueues[from] = [];
      candidateQueues[from].push(signal.candidate);
    }
  }
});

socket.on('user-disconnected', (userId) => {
  if (peers[userId]) {
    peers[userId].close();
    delete peers[userId];
  }
  const wrap = document.getElementById(`wrap-${userId}`);
  if (wrap) wrap.remove();
});

function createPeer(userId) {
  const peer = new RTCPeerConnection(rtcConfig);

  localStream.getTracks().forEach((track) => peer.addTrack(track, localStream));

  peer.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit('signal', { to: userId, signal: { candidate: e.candidate } });
    }
  };

  peer.onconnectionstatechange = () => {
    updateStatus(userId, `Status: ${peer.connectionState}`);
  };

  // AQUI ESTAVA O BUG: agora pega e.streams[0] corretamente
  peer.ontrack = (e) => {
    const remoteStream = (e.streams && e.streams[0]) ? e.streams[0] : new MediaStream([e.track]);
    addVideoElement(userId, remoteStream, false, 'Conectado');
  };

  return peer;
}
