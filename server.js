const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Guarda as salas: { nomeDaSala: { password: '123', users: Set() } }
const rooms = {};

function broadcastRooms() {
  const roomList = Object.entries(rooms).map(([name, data]) => ({
    name,
    hasPassword: Boolean(data.password),
    count: data.users.size
  }));
  io.emit('rooms-list', roomList);
}

io.on('connection', (socket) => {
  broadcastRooms();

  socket.on('join-room', ({ roomId, password }, callback) => {
    const cleanRoom = roomId.trim();
    if (!cleanRoom) return callback({ error: 'Digite o nome da sala.' });

    // Se a sala já existe, valida a senha
    if (rooms[cleanRoom]) {
      if (rooms[cleanRoom].password && rooms[cleanRoom].password !== password) {
        return callback({ error: 'Senha incorreta!' });
      }
    } else {
      // Cria nova sala com a senha informada (ou vazia se pública)
      rooms[cleanRoom] = {
        password: password || '',
        users: new Set()
      };
    }

    rooms[cleanRoom].users.add(socket.id);
    socket.join(cleanRoom);
    socket.currentRoom = cleanRoom;

    callback({ success: true });
    socket.to(cleanRoom).emit('user-connected', socket.id);
    broadcastRooms();
  });

  socket.on('signal', (data) => {
    io.to(data.to).emit('signal', {
      from: socket.id,
      signal: data.signal
    });
  });

  socket.on('disconnect', () => {
    const roomId = socket.currentRoom;
    if (roomId && rooms[roomId]) {
      rooms[roomId].users.delete(socket.id);
      socket.to(roomId).emit('user-disconnected', socket.id);

      // Apaga a sala se ficar vazia
      if (rooms[roomId].users.size === 0) {
        delete rooms[roomId];
      }
      broadcastRooms();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
