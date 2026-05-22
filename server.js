const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { randomUUID } = require('crypto');

const app = express();
const server = http.createServer(app);

// 이미지 전송을 위해 maxHttpBufferSize 5MB로 확장
const io = new Server(server, { maxHttpBufferSize: 5 * 1024 * 1024 });

app.use(express.static(path.join(__dirname, 'public')));

const MAX_MSGS = 200;

// rooms: Map<code, { users: Map<socketId, nick>, messages: [], reads: Map<msgId, Set<socketId>> }>
const rooms = new Map();

function getRoom(code) {
  if (!rooms.has(code)) rooms.set(code, { users: new Map(), messages: [], reads: new Map() });
  return rooms.get(code);
}

io.on('connection', (socket) => {
  let curRoom = null, curNick = null;

  socket.on('join', ({ roomCode, nickname }) => {
    roomCode = String(roomCode || '').trim();
    nickname = String(nickname || '').trim();
    if (roomCode.length < 2) return socket.emit('join-error', '참여 코드는 2자 이상이어야 합니다.');
    if (!nickname) return socket.emit('join-error', '닉네임을 입력해주세요.');

    curRoom = roomCode;
    curNick = nickname;
    const room = getRoom(roomCode);
    room.users.set(socket.id, nickname);
    socket.join(roomCode);
    socket.to(roomCode).emit('system', `${nickname}님이 입장했습니다.`);

    const history = room.messages.map(m => ({
      ...m,
      readCount: (room.reads.get(m.id) || new Set()).size,
    }));
    socket.emit('joined', { roomCode, nickname, history });
    io.to(roomCode).emit('participants', room.users.size);
  });

  socket.on('message', (payload) => {
    if (!curRoom || !curNick) return;
    const raw = typeof payload === 'string' ? { text: payload } : (payload || {});
    const text = String(raw.text || '').trim();

    // 이미지 검증
    let imageData = null;
    if (raw.imageData) {
      const img = String(raw.imageData);
      if (!img.startsWith('data:image/')) return; // 유효하지 않은 이미지
      if (img.length > 4 * 1024 * 1024) return;  // 4MB 초과 차단
      imageData = img;
    }

    if (!text && !imageData) return; // 텍스트도 이미지도 없으면 무시

    const room = rooms.get(curRoom);
    if (!room) return;

    const replyTo = raw.replyTo
      ? {
          id: String(raw.replyTo.id || '').slice(0, 40),
          nickname: String(raw.replyTo.nickname || '').slice(0, 16),
          text: String(raw.replyTo.text || '').slice(0, 100),
          isImage: !!raw.replyTo.isImage,
        }
      : null;

    const msg = {
      id: randomUUID(),
      nickname: curNick,
      text,
      imageData,
      time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
      replyTo,
    };

    room.messages.push(msg);
    if (room.messages.length > MAX_MSGS) room.messages.shift();
    room.reads.set(msg.id, new Set([socket.id]));

    io.to(curRoom).emit('message', { ...msg, readCount: 1 });
  });

  socket.on('read', (msgId) => {
    if (!curRoom) return;
    const room = rooms.get(curRoom);
    if (!room) return;
    const readers = room.reads.get(String(msgId));
    if (!readers || readers.has(socket.id)) return;
    readers.add(socket.id);
    io.to(curRoom).emit('read-update', { msgId, readCount: readers.size });
  });

  socket.on('disconnect', () => {
    if (!curRoom || !rooms.has(curRoom)) return;
    const room = rooms.get(curRoom);
    room.users.delete(socket.id);
    if (room.users.size === 0) {
      rooms.delete(curRoom);
    } else {
      socket.to(curRoom).emit('system', `${curNick}님이 퇴장했습니다.`);
      io.to(curRoom).emit('participants', room.users.size);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
