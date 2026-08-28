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

  socket.on('join_room', ({ roomId, playerName }) => {
    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: [],
        currentWord: "CARE",
        usedWords: ["CARE"],
        turnIndex: 0  // index into players[] whose turn it is
      };
    }

      socket.on('time_up', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    const currentPlayer = room.players[room.turnIndex];
    // Only accept a timeout claim from the player whose turn it actually is
    if (!currentPlayer || currentPlayer.socketId !== socket.id) return;

    const winner = room.players[room.turnIndex === 0 ? 1 : 0];
    console.log(`TIME UP: room="${roomId}" — ${currentPlayer.name} ran out of time, ${winner.name} wins`);

    io.to(roomId).emit('game_over', {
      winnerName: winner.name,
      loserName: currentPlayer.name
    });

    if (room.deleteTimeout) clearTimeout(room.deleteTimeout);
    delete rooms[roomId]; // match's over, clean up
  });

    const room = rooms[roomId];

    // Prevent duplicate joins (e.g. on reconnect)
    const alreadyIn = room.players.find(p => p.id === socket.id);
    if (!alreadyIn && room.players.length < 2) {
      room.players.push({ id: socket.id, name: playerName });
    }

    // Tell everyone in the room the current room state
    io.to(roomId).emit('room_update', {
      players: room.players,
      currentWord: room.currentWord,
      usedWords: room.usedWords
    });

    // Start the game once both players are in
    if (room.players.length === 2) {
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
    const room = rooms[roomId];
    if (!room) return;

    // Validate it's actually this socket's turn
    const currentPlayer = room.players[room.turnIndex];
    if (!currentPlayer || currentPlayer.id !== socket.id) return;

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
    // Notify rooms this player was in
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        const leavingName = room.players[idx].name;
        io.to(roomId).emit('player_left', { name: leavingName });
        delete rooms[roomId]; // Clean up room on disconnect
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
