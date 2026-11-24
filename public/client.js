const socket = io();
const localVideo = document.getElementById('localVideo');
const videosDiv = document.getElementById('videos');
const joinBtn = document.getElementById('joinBtn');
const roomInput = document.getElementById('roomInput');

let localStream;
const peers = {};
const rtcConfig = {
  iceServers: [{ urls: 'stun:://google.com' }]
};

joinBtn.onclick = async () => {
  const roomId = roomInput.value.trim();
  if (!roomId) return alert('Digite o nome da sala.');

  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = localStream;

  document.getElementById('controls').style.display = 'none';
  socket.emit('join-room', roomId);
};

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
    await peer.addIceCandidate(new RTCIceCandidate(signal.candidate));
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

  localStream.getTracks().forEach(track => peer.addTrack(track, localStream));

  peer.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit('signal', { to: userId, signal: { candidate: e.candidate } });
    }
  };

  peer.ontrack = (e) => {
    if (document.getElementById(`video-${userId}`)) return;
    const video = document.createElement('video');
    video.id = `video-${userId}`;
    video.srcObject = e.streams[0];
    video.autoplay = true;
    video.playsinline = true;
    videosDiv.appendChild(video);
  };

  return peer;
}
