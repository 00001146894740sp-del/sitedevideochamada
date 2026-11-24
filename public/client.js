const socket = io();

const lobby = document.getElementById('lobby');
const callRoom = document.getElementById('callRoom');
const roomInput = document.getElementById('roomInput');
const joinBtn = document.getElementById('joinBtn');
const createBtn = document.getElementById('createBtn');
const displayRoomCode = document.getElementById('displayRoomCode');
const copyCodeBtn = document.getElementById('copyCodeBtn');

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const toggleMicBtn = document.getElementById('toggleMicBtn');
const toggleCamBtn = document.getElementById('toggleCamBtn');
const leaveBtn = document.getElementById('leaveBtn');

let localStream;
let peerConnection;
let currentRoom;

const rtcConfig = {
  iceServers: [{ urls: 'stun:://google.com' }]
};

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

async function startCall(roomId) {
  currentRoom = roomId.trim().toUpperCase();
  if (!currentRoom) return alert('Digite um código de sala válido.');

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });
    localVideo.srcObject = localStream;

    lobby.classList.add('hidden');
    callRoom.classList.remove('hidden');
    displayRoomCode.textContent = currentRoom;

    socket.emit('join-room', currentRoom);
  } catch (err) {
    alert('Não foi possível acessar câmera ou microfone. Verifique as permissões.');
  }
}

function createPeerConnection() {
  peerConnection = new RTCPeerConnection(rtcConfig);

  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });

  peerConnection.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', {
        roomId: currentRoom,
        candidate: event.candidate
      });
    }
  };
}

// Eventos de sinalização
socket.on('user-joined', async () => {
  createPeerConnection();
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  socket.emit('offer', { roomId: currentRoom, offer });
});

socket.on('offer', async (offer) => {
  createPeerConnection();
  await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  socket.emit('answer', { roomId: currentRoom, answer });
});

socket.on('answer', async (answer) => {
  await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on('ice-candidate', async (candidate) => {
  if (peerConnection) {
    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  }
});

socket.on('user-left', () => {
  remoteVideo.srcObject = null;
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
});

socket.on('room-full', () => {
  alert('Esta sala já está cheia (limite de 2 pessoas).');
  window.location.reload();
});

// Botões de controle
createBtn.addEventListener('click', () => startCall(generateRoomCode()));
joinBtn.addEventListener('click', () => startCall(roomInput.value));

copyCodeBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(currentRoom);
  copyCodeBtn.textContent = 'Copiado!';
  setTimeout(() => (copyCodeBtn.textContent = 'Copiar Código'), 2000);
});

toggleMicBtn.addEventListener('click', () => {
  const audioTrack = localStream.getAudioTracks()[0];
  if (!audioTrack) return;
  audioTrack.enabled = !audioTrack.enabled;
  toggleMicBtn.textContent = audioTrack.enabled ? 'Microfone: Ligado' : 'Microfone: Mutado';
  toggleMicBtn.className = `btn control ${audioTrack.enabled ? 'active' : 'muted'}`;
});

toggleCamBtn.addEventListener('click', () => {
  const videoTrack = localStream.getVideoTracks()[0];
  if (!videoTrack) return;
  videoTrack.enabled = !videoTrack.enabled;
  toggleCamBtn.textContent = videoTrack.enabled ? 'Câmera: Ligada' : 'Câmera: Desligada';
  toggleCamBtn.className = `btn control ${videoTrack.enabled ? 'active' : 'muted'}`;
});

leaveBtn.addEventListener('click', () => {
  window.location.reload();
});
