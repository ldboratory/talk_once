const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// rooms: Map<roomCode, Map<socketId, nickname>>
const rooms = new Map();

io.on('connection', (socket) => {
  let currentRoom = null;
  let currentNickname = null;

  socket.on('join', ({ roomCode, nickname }) => {
    roomCode = String(roomCode).trim();
    nickname = String(nickname).trim();

    if (!roomCode || roomCode.length < 2) {
      socket.emit('join-error', '참여 코드는 2자 이상이어야 합니다.');
      return;
    }
    if (!nickname) {
      socket.emit('join-error', '닉네임을 입력해주세요.');
      return;
    }

    currentRoom = roomCode;
    currentNickname = nickname;

    if (!rooms.has(roomCode)) rooms.set(roomCode, new Map());
    rooms.get(roomCode).set(socket.id, nickname);

    socket.join(roomCode);
    socket.to(roomCode).emit('system', `${nickname}님이 입장했습니다.`);
    socket.emit('joined', { roomCode, nickname });
    io.to(roomCode).emit('participants', rooms.get(roomCode).size);
  });

  socket.on('message', (text) => {
    if (!currentRoom || !currentNickname) return;
    text = String(text).trim();
    if (!text || text.length > 500) return;

    io.to(currentRoom).emit('message', {
      nickname: currentNickname,
      text,
      time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
    });
  });

  socket.on('disconnect', () => {
    if (!currentRoom || !rooms.has(currentRoom)) return;
    const room = rooms.get(currentRoom);
    room.delete(socket.id);

    if (room.size === 0) {
      rooms.delete(currentRoom);
    } else {
      socket.to(currentRoom).emit('system', `${currentNickname}님이 퇴장했습니다.`);
      io.to(currentRoom).emit('participants', room.size);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
