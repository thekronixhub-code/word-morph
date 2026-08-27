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

  socket.on('join_room', ({ roomId, playerName }) => {
    console.log(`JOIN ATTEMPT: room="${roomId}" name="${playerName}" socket=${socket.id}`);
    socket.join(roomId);
    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: [],
        currentWord: "CARE",
        usedWords: ["CARE"],
        turnIndex: 0  // index into players[] whose turn it is
      };
    }
    const room = rooms[roomId];
    // Prevent duplicate joins (e.g. on reconnect)
    const alreadyIn = room.players.find(p => p.id === socket.id);
    if (!alreadyIn && room.players.length < 2) {
      room.players.push({ id: socket.id, name: playerName });
    }
    console.log(`ROOM STATE: room="${roomId}" now has ${room.players.length} player(s):`, room.players.map(p => `${p.name}(${p.id})`));

    // Tell everyone in the room the current room state
    io.to(roomId).emit('room_update', {
      players: room.players,
      currentWord: room.currentWord,
      usedWords: room.usedWords
    });
    // Start the game once both players are in
    if (room.players.length === 2) {
      console.log(`GAME START: room="${roomId}" starter=${room.players[0].name}`);
      io.to(roomId).emit('game_start', {
        starter: room.players[0].name,          // P1 always goes first
        starterSocketId: room.players[0].id,
        word: room.currentWord,
        players: room.players
      });
    }
  });

  // A player submits a valid move
  socket.on('make_move', ({ roomId, word }) => {
    console.log(`MOVE: room="${roomId}" word="${word}" from socket=${socket.id}`);
    const room = rooms[roomId];
    if (!room) {
      console.log(`MOVE REJECTED: no room found for "${roomId}"`);
      return;
    }
    // Validate it's actually this socket's turn
    const currentPlayer = room.players[room.turnIndex];
    if (!currentPlayer || currentPlayer.id !== socket.id) {
      console.log(`MOVE REJECTED: not this socket's turn (expected ${currentPlayer && currentPlayer.id})`);
      return;
    }
    room.currentWord = word;
    room.usedWords.push(word);
    room.turnIndex = room.turnIndex === 0 ? 1 : 0; // flip turn
    const nextPlayer = room.players[room.turnIndex];
    io.to(roomId).emit('move_made', {
      word: room.currentWord,
      usedWords: room.usedWords,
      nextTurnPlayerName: nextPlayer.name,
      nextTurnSocketId: nextPlayer.id
    });
  });

  socket.on('disconnect', () => {
    console.log(`SOCKET DISCONNECTED: ${socket.id}`);
    // Notify rooms this player was in
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        const leavingName = room.players[idx].name;
        console.log(`PLAYER LEFT: "${leavingName}" from room="${roomId}" — deleting room`);
        io.to(roomId).emit('player_left', { name: leavingName });
        delete rooms[roomId]; // Clean up room on disconnect
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
