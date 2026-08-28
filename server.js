const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
app.use(express.static(path.join(__dirname, '/')));
const rooms = {};

io.on('connection', (socket) => {
  console.log(`SOCKET CONNECTED: ${socket.id}`);

  socket.on('join_room', ({ roomId, playerName, playerId, startWord }) => {
    socket.join(roomId);

    if (!rooms[roomId]) {
    const validStart = (typeof startWord === 'string' && /^[A-Z]{4}$/.test(startWord))
      ? startWord
      : "CARE";
      rooms[roomId] = {
        players: [],
        currentWord: validStart,
        usedWords: [validStart],
        turnIndex: 0,
        scores: {},
        deleteTimeout: null
      };
    }
    const room = rooms[roomId];

    // Someone reconnected — cancel any pending room deletion
    if (room.deleteTimeout) {
      clearTimeout(room.deleteTimeout);
      room.deleteTimeout = null;
    }

    // Match by persistent playerId, NOT socket.id (socket.id changes on every reconnect)
    let player = room.players.find(p => p.playerId === playerId);

    if (player) {
      console.log(`RECONNECT: "${playerName}" (${playerId}) new socket=${socket.id}`);
      player.socketId = socket.id;
      player.connected = true;
    } else if (room.players.length < 2) {
      player = { playerId, socketId: socket.id, name: playerName, connected: true };
      room.players.push(player);
      console.log(`NEW JOIN: "${playerName}" (${playerId}) socket=${socket.id}`);
    }

    if (room.scores[playerId] === undefined) room.scores[playerId] = 0;

    io.to(roomId).emit('room_update', {
      players: room.players.map(p => ({ playerId: p.playerId, name: p.name })),
      currentWord: room.currentWord,
      usedWords: room.usedWords
    });

        if (room.players.length === 2) {
      io.to(roomId).emit('game_start', {
        starterPlayerId: room.players[0].playerId,
        word: room.currentWord,
        players: room.players.map(p => ({ playerId: p.playerId, name: p.name })),
        scores: room.players.map(p => ({
          playerId: p.playerId, name: p.name, score: room.scores[p.playerId] || 0
        }))
      });
    }
  });

  socket.on('make_move', ({ roomId, word }) => {
    const room = rooms[roomId];
    if (!room) return;
    const currentPlayer = room.players[room.turnIndex];
    if (!currentPlayer || currentPlayer.socketId !== socket.id) {
      console.log(`MOVE REJECTED: not this socket's turn`);
      return;
    }

    room.currentWord = word;
    room.usedWords.push(word);
    room.turnIndex = room.turnIndex === 0 ? 1 : 0;
    const nextPlayer = room.players[room.turnIndex];

    io.to(roomId).emit('move_made', {
      word: room.currentWord,
      usedWords: room.usedWords,
      nextTurnPlayerId: nextPlayer.playerId
    });
  });

    socket.on('time_up', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    const currentPlayer = room.players[room.turnIndex];
    if (!currentPlayer || currentPlayer.socketId !== socket.id) return;

    const winnerIndex = room.turnIndex === 0 ? 1 : 0;
    const winner = room.players[winnerIndex];

    room.scores[winner.playerId] = (room.scores[winner.playerId] || 0) + 1;

    console.log(`ROUND OVER: room="${roomId}" — ${currentPlayer.name} too slow, ${winner.name} wins round`);

    io.to(roomId).emit('round_over', {
      winnerPlayerId: winner.playerId,
      winnerName: winner.name,
      loserName: currentPlayer.name,
      scores: room.players.map(p => ({
        playerId: p.playerId, name: p.name, score: room.scores[p.playerId] || 0
      }))
    });
  });

  socket.on('retry_round', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.players.length < 2) return;

    room.currentWord = "CARE";
    room.usedWords = ["CARE"];
    room.turnIndex = room.turnIndex === 0 ? 1 : 0;

    io.to(roomId).emit('game_start', {
      starterPlayerId: room.players[room.turnIndex].playerId,
      word: room.currentWord,
      players: room.players.map(p => ({ playerId: p.playerId, name: p.name })),
      scores: room.players.map(p => ({
        playerId: p.playerId, name: p.name, score: room.scores[p.playerId] || 0
      }))
    });
  });

  socket.on('disconnect', () => {
    console.log(`SOCKET DISCONNECTED: ${socket.id}`);
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const player = room.players.find(p => p.socketId === socket.id);
      if (player) {
        player.connected = false;
        io.to(roomId).emit('player_left', { name: player.name }); // soft notice, room stays alive

        room.deleteTimeout = setTimeout(() => {
          const stillGone = room.players.find(p => p.playerId === player.playerId && !p.connected);
          if (stillGone) {
            io.to(roomId).emit('room_closed', { reason: `${player.name} did not reconnect` });
            delete rooms[roomId];
            console.log(`Room "${roomId}" deleted — "${player.name}" never reconnected`);
          }
        }, 30000); // 30s grace period is plenty now that reconnects actually work
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
