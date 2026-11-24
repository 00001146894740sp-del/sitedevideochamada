const socket = io();
const videosDiv = document.getElementById('videos');
const joinBtn = document.getElementById('joinBtn');
const roomInput = document.getElementById('roomInput');
const passInput = document.getElementById('passInput');
const roomListDiv = document.getElementById('roomList');

let localStream;
const peers = {};

const rtcConfig = {
  iceServers: [
    { urls: 'stun:://google.com' },
    { urls: 'stun:://google.com' },
    { urls: 'stun:://google.com' }
  ]
};

// Atualiza lista de salinhas na tela inicial
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
    return alert('Permita o acesso à câmera e microfone no navegador.');
  }

  socket.emit('join-room', { roomId, password }, (res) => {
    if (res.error) return alert(res.error);

    document.getElementById('lobby').style.display = 'none';
    document.getElementById('callControls').style.display = 'block';
    document.getElementById('roomTitle').innerText = `Sala: ${roomId} `;

    addVideoElement('local', localStream, true);
  });
}

function addVideoElement(id, stream, isMuted = false) {
  let video = document.getElementById(`video-${id}`);
  if (!video) {
    video = document.createElement('video');
    video.id = `video-${id}`;
    video.autoplay = true;
    video.playsInline = true;
    video.muted = isMuted;
    videosDiv.appendChild(video);
  }
  video.srcObject = stream;
}

socket.on('user-connected', async (userId) => {
  const peer = createPeer(userId);
  peers[userId] = peer;

  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  socket.emit('signal', { to: userId, signal: { sdp: peer.localDescription } });
});

socket.on('signal', async ({ from, signal }) => {
  let peer = peers[from];
  if (!peer) {
    peer = createPeer(from);
    peers[from] = peer;
  }

  if (signal.sdp) {
    await peer.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    if (signal.sdp.type === 'offer') {
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      socket.emit('signal', { to: from, signal: { sdp: peer.localDescription } });
    }
  } else if (signal.candidate) {
    try {
      await peer.addIceCandidate(new RTCIceCandidate(signal.candidate));
    } catch (e) {}
  }
});

socket.on('user-disconnected', (userId) => {
  if (peers[userId]) {
    peers[userId].close();
    delete peers[userId];
  }
  const remoteVid = document.getElementById(`video-${userId}`);
  if (remoteVid) remoteVid.remove();
});

function createPeer(userId) {
  const peer = new RTCPeerConnection(rtcConfig);

  localStream.getTracks().forEach((track) => peer.addTrack(track, localStream));

  peer.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit('signal', { to: userId, signal: { candidate: e.candidate } });
    }
  };

  peer.ontrack = (e) => {
    if (e.streams && e.streams[0]) {
      addVideoElement(userId, e.streams[0], false);
    }
  };

  return peer;
}
