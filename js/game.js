// ─── State ───────────────────────────────────────────────────────────────────
let currentWord = "CARE";
let activePlayer = "p1"; // "p1", "p2", or "maya"
let gameMode = "maya";   // "maya", "friend", or "online"
let timer = 15;
let maxTimer = 15;
let timerInterval = null;
let turnCount = 0;
let usedWords = new Set();

let player1Name = "Player 1";
let player2Name = "Player 2";
// ─── Persistent player identity (survives reconnects/socket.id changes) ──────
function getOrCreatePlayerId() {
  let id = localStorage.getItem('wordMorphPlayerId');
  if (!id) {
    id = 'p_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
    localStorage.setItem('wordMorphPlayerId', id);
  }
  return id;
}
const myPlayerId = getOrCreatePlayerId();
// ─── Online State ─────────────────────────────────────────────────────────────
let socket = null;
let currentRoomId = null;
let mySocketId = null;      // This client's socket id
let myTurn = false;         // Is it currently my turn?

// ─────────────────────────────────────────────────────────────────────────────

const MAYA_TAUNTS = {
  slow:      ["*Yawn*... Still searching? 😴", "Tick-tock! My processors are getting bored. 😴"],
  smartMove: ["Oh, fancy! Didn't expect that one.", "Hmm, acceptable… but watch this. 🔥"],
  invalid:   ["Nice try, but that's not a real word! ❌", "Is that ancient Latin? Try again! 😂"],
  oneLetter: ["You must change EXACTLY one letter!", "Rule check: change 1 letter only! 🚫"],
  repeated:  ["That word's been played! No recycling! ♻️", "We've been there! Find something fresh. 🔄"],
  win:       ["Game over! I out-smarted you again. 💅", "Too easy! Better luck next time."],
  lose:      ["Wait… what?! How did you find that word?! 🤯", "Okay fine, you got lucky this round."],
  noMoves:   ["Hmm… you've cornered me. Sneaky! 😤", "I see no way out. Well played. 🤯"]
};

function triggerErrorState() {
  const boxes = document.querySelectorAll('.letter-box');
  boxes.forEach(box => box.classList.add('shake'));
  setTimeout(() => {
    boxes.forEach(box => box.classList.remove('shake'));
    updateBoard();
  }, 400);
}

// ─── Screen Navigation ───────────────────────────────────────────────────────
function showDashboard() {
  clearInterval(timerInterval);
  if (socket) { socket.disconnect(); socket = null; }
  document.getElementById('app-container').classList.remove('fullscreen-mode');
  switchScreen('dash-screen');
}

function showFriendsSetup() { switchScreen('friends-setup-screen'); }
function showOnlineSetup()  { switchScreen('online-setup-screen'); }

function switchScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
}

// ─── Online: Create Room ─────────────────────────────────────────────────────
function createOnlineRoom() {
  const name = document.getElementById('online-name-input').value.trim() || "Host";
  currentRoomId = Math.random().toString(36).substring(2, 8).toUpperCase();
  gameMode = "online"; // set this NOW so Reset/etc. don't fall back to Maya mode

  const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${currentRoomId}`;

  connectToSocket(currentRoomId, name);

  switchScreen('game-screen');
  document.getElementById('app-container').classList.add('fullscreen-mode');

  // Reset the leftover "MAYA" placeholder visuals
  document.getElementById('player-avatar').innerText = "⏳";
  document.getElementById('player-label').innerText = "WAITING";
  document.getElementById('player-speech').innerText = "Sit tight, your opponent is joining...";

  // Show the invite link where it'll actually stay visible (this screen doesn't get swapped away)
  document.getElementById('status-msg').innerHTML =
    `⏳ Share this link with your friend:<br><strong style="word-break:break-all;">${inviteUrl}</strong>`;

  lockBoard(true);
}

// ─── Online: Accept & Join ───────────────────────────────────────────────────
function acceptAndJoinGame() {
  const guestName = document.getElementById('guest-name-input').value.trim() || "Guest";
  gameMode = "online"; // same fix here

  connectToSocket(currentRoomId, guestName);

  switchScreen('game-screen');
  document.getElementById('app-container').classList.add('fullscreen-mode');
  document.getElementById('player-avatar').innerText = "⏳";
  document.getElementById('player-label').innerText = "CONNECTING";
  document.getElementById('status-msg').innerText = "⏳ Connecting to room…";
  lockBoard(true);
}

// ─── Socket.IO Connection & Online Events ────────────────────────────────────

function connectToSocket(roomId, name) {
  const SERVER_URL = window.SOCKET_SERVER_URL || "http://localhost:3000";
  socket = io(SERVER_URL);

  socket.on('connect', () => {
    socket.emit('join_room', { roomId, playerName: name, playerId: myPlayerId });
  });

  socket.on('room_update', (room) => {
    const el = document.getElementById('status-msg');
    if (room.players.length === 1 && el && !el.innerHTML.includes('Share this link')) {
      el.innerText = "Waiting for an opponent to join...";
    }
  });

  socket.on('game_start', ({ starterPlayerId, word, players }) => {
    gameMode = "online";
    switchScreen('game-screen');
    document.getElementById('app-container').classList.add('fullscreen-mode');

    const me = players.find(p => p.playerId === myPlayerId);
    const opp = players.find(p => p.playerId !== myPlayerId);
    player1Name = me ? me.name : "You";
    player2Name = opp ? opp.name : "Opponent";

    myTurn = (starterPlayerId === myPlayerId);
    activePlayer = myTurn ? "p1" : "p2";

    currentWord = word;
    usedWords = new Set([word]);

    document.getElementById('status-msg').innerText = "";
    updateTurnDisplay();
    updateBoard();
    renderHistory();
    resetTimer();
  });

  socket.on('move_made', ({ word, usedWords: newUsed, nextTurnPlayerId }) => {
    currentWord = word;
    usedWords = new Set(newUsed);
    myTurn = (nextTurnPlayerId === myPlayerId);
    activePlayer = myTurn ? "p1" : "p2";

    renderHistory();
    updateBoard();
    updateTurnDisplay();
    document.getElementById('status-msg').innerText = "";
    resetTimer();
  });

  socket.on('player_left', ({ name }) => {
    // Soft notice only — room stays alive during the grace period, don't end the game yet
    document.getElementById('status-msg').innerText = `${name} lost connection... waiting for them to come back.`;
  });

  socket.on('room_closed', ({ reason }) => {
    clearInterval(timerInterval);
    document.getElementById('status-msg').innerText = `Game ended: ${reason}`;
    lockBoard(true);
  });

  socket.on('connect_error', () => {
    document.getElementById('status-msg').innerText = "❌ Can't reach server. Reconnecting...";
  });
}
// ─── Online HUD ──────────────────────────────────────────────────────────────
function updateOnlineTurnDisplay() {
  const avatar  = document.getElementById('player-avatar');
  const label   = document.getElementById('player-label');
  const speech  = document.getElementById('player-speech');
  const indicator = document.getElementById('turn-indicator');

  if (myTurn) {
    avatar.innerText    = "🟢";
    label.innerText     = player1Name.toUpperCase() + " (YOU)";
    speech.innerText    = "Your turn — change one letter!";
    indicator.innerText = "Your Move";
    lockBoard(false);
  } else {
    avatar.innerText    = "⏳";
    label.innerText     = player2Name.toUpperCase();
    speech.innerText    = `Waiting for ${player2Name}…`;
    indicator.innerText = `${player2Name}'s Move`;
    lockBoard(true);
  }
}

function lockBoard(locked) {
  document.querySelectorAll('.letter-box').forEach(b => b.disabled = locked);
}

// ─── Mode Starters ───────────────────────────────────────────────────────────
function startMayaMode() {
  gameMode = "maya";
  player1Name = "You";
  player2Name = "Maya";
  maxTimer = 15;
  document.getElementById('app-container').classList.remove('fullscreen-mode');
  initGame();
}

function startFriendsMode() {
  gameMode = "friend";
  player1Name = document.getElementById('p1-name-input').value.trim() || "Player 1";
  player2Name = document.getElementById('p2-name-input').value.trim() || "Player 2";
  maxTimer = parseInt(document.getElementById('timer-select').value, 10);
  document.getElementById('app-container').classList.add('fullscreen-mode');
  initGame();
}

function restartCurrentGame() {
  if (gameMode === "online") return; // can't locally restart an online game
  initGame();
}

function initGame() {
  switchScreen('game-screen');
  currentWord = "CARE";
  activePlayer = "p1";
  turnCount = 0;
  usedWords = new Set();
  usedWords.add(currentWord);

  document.getElementById('status-msg').innerText = "";
  updateTurnDisplay();
  updateBoard();
  renderHistory();
  resetTimer();
}

// ─── Local Turn & HUD ────────────────────────────────────────────────────────
function updateTurnDisplay() {
  if (gameMode === "online") { updateOnlineTurnDisplay(); return; }

  const avatar    = document.getElementById('player-avatar');
  const label     = document.getElementById('player-label');
  const speech    = document.getElementById('player-speech');
  const indicator = document.getElementById('turn-indicator');

  if (gameMode === "maya") {
    if (activePlayer === "p1") {
      avatar.innerText  = "🧑‍💻";
      label.innerText   = player1Name.toUpperCase();
      speech.innerText  = `"Find a word to beat Maya!"`;
      indicator.innerText = `${player1Name}'s Move`;
    } else {
      avatar.innerText  = "😏";
      label.innerText   = "MAYA";
      speech.innerText  = `"Let's see if you can handle four simple letters."`;
      indicator.innerText = "Maya is thinking...";
    }
  } else {
    if (activePlayer === "p1") {
      avatar.innerText  = "🔵";
      label.innerText   = player1Name.toUpperCase();
      speech.innerText  = `"Your turn, ${player1Name}!"`;
      indicator.innerText = `${player1Name}'s Move`;
    } else {
      avatar.innerText  = "🔴";
      label.innerText   = player2Name.toUpperCase();
      speech.innerText  = `"Your turn, ${player2Name}!"`;
      indicator.innerText = `${player2Name}'s Move`;
    }
  }
}

function updateBoard() {
  const inputs = document.querySelectorAll('.letter-box');
  const isLocked = (gameMode === "maya" && activePlayer === "maya")
                || (gameMode === "online" && !myTurn);
  for (let i = 0; i < 4; i++) {
    inputs[i].value    = currentWord[i];
    inputs[i].disabled = isLocked;
  }
}

function renderHistory() {
  const el = document.getElementById('word-history');
  if (!el) return;
  const words = [...usedWords];
  el.innerHTML = words.map((w, i) => {
    const isLast = i === words.length - 1;
    return `<span class="hist-chip ${isLast ? 'hist-current' : ''}">${w}</span>`;
  }).join('<span class="hist-arrow">→</span>');
}

// ─── Timer ───────────────────────────────────────────────────────────────────
function resetTimer() {
  clearInterval(timerInterval);
  const timerBox = document.getElementById('timer-display');

  if (maxTimer === 0 || gameMode === "online") {
    timerBox.style.display = 'none';
    return;
  }

  timerBox.style.display = 'block';
  timer = maxTimer;
  document.getElementById('timer-val').innerText = timer;

  timerInterval = setInterval(() => {
    timer--;
    document.getElementById('timer-val').innerText = timer;

    if (timer === 7 && gameMode === 'maya' && activePlayer === 'p1') {
      document.getElementById('player-speech').innerText =
        MAYA_TAUNTS.slow[Math.floor(Math.random() * MAYA_TAUNTS.slow.length)];
    }

    if (timer <= 0) {
      clearInterval(timerInterval);
      handleTimeout();
    }
  }, 1000);
}

function handleTimeout() {
  const status = document.getElementById('status-msg');
  if (gameMode === "maya") {
    if (activePlayer === "p1") {
      document.getElementById('player-speech').innerText = MAYA_TAUNTS.win[0];
      status.innerText = "Time's up! Maya wins!";
    } else {
      document.getElementById('player-speech').innerText = MAYA_TAUNTS.lose[0];
      status.innerText = "Maya ran out of time! You win!";
    }
  } else {
    const winner = activePlayer === "p1" ? player2Name : player1Name;
    const loser  = activePlayer === "p1" ? player1Name : player2Name;
    status.innerText = `Time's up for ${loser}! ${winner} Wins! 🎉`;
  }
}

// ─── Submit Move ─────────────────────────────────────────────────────────────
function submitMove() {
  // Online guard: only submit on your turn
  if (gameMode === "online" && !myTurn) return;
  // Maya guard
  if (gameMode === "maya" && activePlayer !== "p1") return;

  const inputs = document.querySelectorAll('.letter-box');
  let newWord = "";
  inputs.forEach(input => newWord += input.value.toUpperCase());

  if (newWord.length !== 4 || newWord.includes(' ')) {
    document.getElementById('status-msg').innerText = "Fill in all four letters!";
    triggerErrorState(); return;
  }

  let diffCount = 0;
  for (let i = 0; i < 4; i++) {
    if (newWord[i] !== currentWord[i]) diffCount++;
  }

  if (diffCount !== 1) {
    document.getElementById('status-msg').innerText = "Change exactly ONE letter!";
    if (gameMode === "maya") updateMaya("🤨", MAYA_TAUNTS.oneLetter[0]);
    triggerErrorState(); return;
  }

  if (usedWords.has(newWord)) {
    document.getElementById('status-msg').innerText = "That word's already been used!";
    if (gameMode === "maya") updateMaya("😏", MAYA_TAUNTS.repeated[Math.floor(Math.random() * MAYA_TAUNTS.repeated.length)]);
    triggerErrorState(); return;
  }

  if (!DICTIONARY.has(newWord)) {
    document.getElementById('status-msg').innerText = "Not a valid 4-letter word!";
    if (gameMode === "maya") updateMaya("😜", MAYA_TAUNTS.invalid[Math.floor(Math.random() * MAYA_TAUNTS.invalid.length)]);
    triggerErrorState(); return;
  }

  // ── Valid move ──
  document.getElementById('status-msg').innerText = "";

  if (gameMode === "online") {
    // Send to server — server will broadcast back to both players
    socket.emit('make_move', { roomId: currentRoomId, word: newWord });
    lockBoard(true); // optimistically lock until server confirms
    return;
  }

  // Local modes
  currentWord = newWord;
  usedWords.add(currentWord);
  turnCount++;
  renderHistory();

  if (gameMode === "maya") {
    activePlayer = "maya";
    updateTurnDisplay();
    updateBoard();
    resetTimer();
    setTimeout(playMayaTurn, 1400);
  } else {
    activePlayer = activePlayer === "p1" ? "p2" : "p1";
    updateTurnDisplay();
    updateBoard();
    resetTimer();
  }
}

// ─── Maya AI ──────────────────────────────────────────────────────────────────
function updateMaya(emoji, text) {
  document.getElementById('player-avatar').innerText = emoji;
  document.getElementById('player-speech').innerText = text;
}

function playMayaTurn() {
  let possibleMoves = [];
  DICTIONARY.forEach(word => {
    if (usedWords.has(word)) return;
    let diff = 0;
    for (let i = 0; i < 4; i++) {
      if (word[i] !== currentWord[i]) diff++;
    }
    if (diff === 1) possibleMoves.push(word);
  });

  if (possibleMoves.length === 0) {
    updateMaya("😱", MAYA_TAUNTS.noMoves[0]);
    document.getElementById('status-msg').innerText = "Maya is trapped! You win! 🎉";
    clearInterval(timerInterval);
    return;
  }

  const mayaChoice = possibleMoves[Math.floor(Math.random() * possibleMoves.length)];
  currentWord = mayaChoice;
  usedWords.add(currentWord);
  activePlayer = "p1";

  updateTurnDisplay();
  updateBoard();
  renderHistory();
  document.getElementById('player-speech').innerText = `"I play '${mayaChoice}'. Your turn!"`;
  resetTimer();
}

// ─── DOMContentLoaded ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Detect invite link
  const urlParams = new URLSearchParams(window.location.search);
  const roomIdFromUrl = urlParams.get('room');

  if (roomIdFromUrl) {
    currentRoomId = roomIdFromUrl;
    switchScreen('join-invite-screen');
    const roomText = document.getElementById('invite-room-text');
    if (roomText) roomText.innerText = `You've been invited to Room #${currentRoomId}`;
  }

  // Letter-box keyboard navigation
  document.querySelectorAll('.letter-box').forEach((box, index, boxes) => {
    box.addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/[^a-zA-Z]/g, '');
      if (e.target.value.length === 1 && index < 3) {
        boxes[index + 1].focus();
        boxes[index + 1].select();
      }
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && e.target.value === '' && index > 0) {
        boxes[index - 1].focus();
        boxes[index - 1].select();
      }
      if (e.key === 'Enter') submitMove();
    });
  });
});
