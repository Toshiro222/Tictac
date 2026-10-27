/* ==========================================================================
   client.js — lobby, online (socket.io) + offline Vs Computer → 3D board and glass HUD
   - socket.io is loaded lazily in the background, so the page and Vs Computer
     never depend on the server being up.
   - Both modes feed the same render() so the 3D board / HUD work identically.
   ========================================================================== */
const $ = (id) => document.getElementById(id);
const SERVER_URL = typeof SERVER !== "undefined" && SERVER ? SERVER : "";

let socket = null;       // set once socket.io has loaded
let socketLoading = null;
let mode = "lobby";      // "lobby" | "online" | "solo"
let mySymbol = null;     // "X" or "O"
let state = null;        // { board, turn, names, scores, over, winner, line, playerCount }
let solo = null;         // offline game data

const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

/* ---------- Lobby ---------- */
const getName = () => $("nameInput").value.trim();

// Name is REQUIRED for every mode (online and Vs Computer).
// If blank: shake the input, show an error, and focus it.
function requireName() {
  const name = getName();
  if (name) { $("error").textContent = ""; return name; }
  const input = $("nameInput");
  input.classList.remove("invalid");
  void input.offsetWidth;                 // restart the animation
  input.classList.add("invalid");
  input.focus();
  $("error").textContent = "Please enter your name to start playing.";
  return null;
}
$("nameInput").addEventListener("input", () => {
  $("nameInput").classList.remove("invalid");
  if (getName()) $("error").textContent = "";
});

// Decorative opening position on the lobby board
Board3D.sync(["X", "O", null, null, "X", null, "X", null, "O"]);

function enterGame() {
  $("lobby").hidden = true;
  $("hud").hidden = false;
  Board3D.reset();                 // clear the demo pieces
  Board3D.setPlayer(mySymbol);     // which ghost token to preview
  Board3D.setMode("game");         // board glides to the centre
}

/* ---------- Socket.io (loaded in the background) ---------- */
function loadSocket() {
  if (socket) return Promise.resolve(socket);
  if (socketLoading) return socketLoading;
  socketLoading = new Promise((resolve, reject) => {
    const connect = () => {
      try {
        socket = SERVER_URL ? io(SERVER_URL) : io();
        bindSocket(socket);
        resolve(socket);
      } catch (e) { reject(e); }
    };
    if (typeof io !== "undefined") return connect();
    const s = document.createElement("script");
    s.src = SERVER_URL + "/socket.io/socket.io.js";
    s.onload = connect;
    s.onerror = () => { s.remove(); reject(new Error("socket.io failed to load")); };
    document.head.appendChild(s);
  }).finally(() => { socketLoading = null; });
  return socketLoading;
}

async function withServer(fn) {
  $("error").textContent = "Connecting to server…";
  try {
    const s = await loadSocket();
    $("error").textContent = "";
    fn(s);
  } catch (e) {
    $("error").textContent = "Can't reach the server. If it's on Render it may be waking up — try again in a few seconds.";
  }
}

function bindSocket(s) {
  s.on("errorMsg", (msg) => ($("error").textContent = msg));

  s.on("joined", ({ code, symbol }) => {
    mode = "online";
    mySymbol = symbol;
    $("roomLabel").textContent = "Room";
    $("roomCode").hidden = false;
    $("roomCode").textContent = code;
    document.querySelector(".chat").hidden = false;
    enterGame();
  });

  s.on("state", (st) => { if (mode !== "online") return; state = st; render(); });

  s.on("opponentLeft", () => {
    Board3D.setInteractive(false);
    $("status").dataset.mine = "0";
    $("status").textContent = "Your opponent left";
    $("rematchBtn").hidden = true;
  });

  s.on("chat", ({ name, text }) => {
    const p = document.createElement("p"), b = document.createElement("b");
    b.textContent = name + " ";
    p.append(b, document.createTextNode(text));   // textContent keeps it safe from HTML injection
    $("messages").appendChild(p);
    $("messages").scrollTop = $("messages").scrollHeight;
  });
}

$("createBtn").onclick = () => {
  const name = requireName();
  if (!name) return;
  withServer((s) => s.emit("createRoom", name));
};
$("joinBtn").onclick = () => {
  const name = requireName();
  if (!name) return;
  const code = $("codeInput").value.trim();
  if (!code) return ($("error").textContent = "Please enter the room code.");
  withServer((s) => s.emit("joinRoom", { code, name }));
};

/* ---------- Rendering (shared by online + solo) ---------- */
let prevBoard = Array(9).fill(null);   // used to detect newly placed pieces (click sound)

function render() {
  const { board, turn, names, scores, over, winner, line, playerCount } = state;

  // "Pop" whenever a new X/O appears (works for your move, the computer's and online opponents')
  const placed = board.some((v, i) => v && !prevBoard[i]);
  if (placed) SFX.click();
  prevBoard = board.slice();

  Board3D.sync(board, line);
  const myTurn = !over && playerCount === 2 && turn === mySymbol;
  Board3D.setInteractive(myTurn);

  $("nameX").textContent = names.X || "…";   $("pointsX").textContent = scores.X;
  $("nameO").textContent = names.O || "…";   $("pointsO").textContent = scores.O;
  $("pointsD").textContent = scores.draws;

  // Scoreboard: highlight whose turn it is, pop the card that just scored
  const live = !over && playerCount === 2;
  $("cardX").classList.toggle("active", live && turn === "X");
  $("cardO").classList.toggle("active", live && turn === "O");
  $("cardX").classList.toggle("you", mySymbol === "X");
  $("cardO").classList.toggle("you", mySymbol === "O");
  bump("pointsX", scores.X); bump("pointsO", scores.O); bump("pointsD", scores.draws);

  $("status").dataset.mine = myTurn ? "1" : "0";
  if (playerCount < 2) $("status").textContent = "Waiting for a friend to join…";
  else if (over) $("status").textContent = winner === "draw" ? "It’s a draw" : winner === mySymbol ? "You win" : "You lose";
  else $("status").textContent = myTurn ? "Your turn" : `${names[turn]}’s turn`;
  $("rematchBtn").hidden = !over;

  updateResult();
}

/* Score number "pop" animation when a value changes */
const lastScore = {};
function bump(id, value) {
  if (lastScore[id] !== undefined && lastScore[id] !== value) {
    const el = $(id);
    el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump");
  }
  lastScore[id] = value;
}

/* ---------- Mute button ---------- */
function syncMuteIcon() {
  $("iconOn").hidden = SFX.muted;
  $("iconOff").hidden = !SFX.muted;
  $("muteBtn").classList.toggle("off", SFX.muted);
}
$("muteBtn").onclick = () => { SFX.toggle(); syncMuteIcon(); };
syncMuteIcon();

/* ---------- Win / Lose / Draw overlay ---------- */
let resultTimer = null, resultShown = false;

function updateResult() {
  if (!state.over) {                       // new round -> hide and reset
    clearTimeout(resultTimer); resultTimer = null; resultShown = false;
    $("result").hidden = true;
    return;
  }
  if (resultShown || resultTimer) return;
  // Short delay so you can see the glowing winning line on the 3D board first
  resultTimer = setTimeout(() => { resultTimer = null; resultShown = true; showResult(); }, 900);
}

function showResult() {
  const { winner } = state;
  const kind = winner === "draw" ? "draw" : winner === mySymbol ? "win" : "lose";
  const TEXT = { win: "YOU WIN!", lose: "YOU LOSE!", draw: "DRAW!" };
  const SUB  = { win: "Victory", lose: "Defeat", draw: "Stalemate" };
  $("result").dataset.kind = kind;
  $("resultTitle").className = "result-title " + kind;
  $("resultTitle").textContent = TEXT[kind];
  $("resultSub").textContent = SUB[kind];
  $("result").hidden = false;
  $("againBtn").focus();
  SFX[kind]();                     // win() / lose() / draw()
}

$("againBtn").onclick = () => { $("result").hidden = true; $("rematchBtn").click(); };
$("viewBtn").onclick = () => { $("result").hidden = true; };   // look at the final board

/* ---------- 3D click ---------- */
Board3D.onCellClick = (i) => {
  if (mode === "solo") { if (solo.st.turn === mySymbol) soloPlay(i); }
  else if (mode === "online" && socket) socket.emit("makeMove", i);
};

/* ---------- Buttons ---------- */
$("rematchBtn").onclick = () => {
  if (mode === "solo") {
    const s = solo.st;
    solo.starter = solo.starter === "X" ? "O" : "X";   // alternate who starts
    s.board = Array(9).fill(null);
    s.turn = solo.starter;
    s.over = false; s.winner = null; s.line = null;
    render();
    if (s.turn !== mySymbol) scheduleComputer();
  } else if (socket) socket.emit("rematch");
};
$("homeBtn").onclick = () => location.reload();   // leave, back to the lobby
$("roomCode").onclick = () => navigator.clipboard && navigator.clipboard.writeText($("roomCode").textContent);

function sendChat() {
  const text = $("chatInput").value.trim();
  if (!text || !socket) return;
  socket.emit("chat", text);
  $("chatInput").value = "";
}
$("chatBtn").onclick = sendChat;
$("chatInput").addEventListener("keydown", (e) => e.key === "Enter" && sendChat());

/* ==========================================================================
   Vs Computer (offline)
   ========================================================================== */
const LEVELS = { easy: "Easy", normal: "Normal", hard: "Unbeatable" };

function winnerOf(b) {
  for (const line of WIN_LINES) {
    const [x, y, z] = line;
    if (b[x] && b[x] === b[y] && b[x] === b[z]) return { winner: b[x], line };
  }
  return null;
}

$("soloBtn").onclick = () => {
  const name = requireName();
  if (!name) return;               // can't start without a name
  mode = "solo";
  mySymbol = "X";
  const level = $("levelSelect").value;
  prevBoard = Array(9).fill(null);
  solo = {
    level,
    starter: "X",
    timer: null,
    st: {
      board: Array(9).fill(null),
      turn: "X",
      names: { X: name, O: "Computer" },
      scores: { X: 0, O: 0, draws: 0 },
      over: false, winner: null, line: null,
      playerCount: 2,
    },
  };
  $("roomLabel").textContent = "Vs Computer · " + (LEVELS[level] || "Normal");
  $("roomCode").hidden = true;                       // no room code offline
  document.querySelector(".chat").hidden = true;     // no chat offline
  enterGame();
  state = solo.st;
  render();
};

function soloPlay(i) {
  const s = solo.st;
  if (s.over || s.board[i]) return;
  s.board[i] = s.turn;
  const r = winnerOf(s.board);
  if (r) { s.over = true; s.winner = r.winner; s.line = r.line; s.scores[r.winner]++; }
  else if (s.board.every(Boolean)) { s.over = true; s.winner = "draw"; s.scores.draws++; }
  else s.turn = s.turn === "X" ? "O" : "X";
  render();
  if (!s.over && s.turn !== mySymbol) scheduleComputer();
}

function scheduleComputer() {
  clearTimeout(solo.timer);
  solo.timer = setTimeout(() => {
    const s = solo.st;
    if (mode !== "solo" || s.over || s.turn === mySymbol) return;
    const move = pickMove(s.board.slice(), solo.level, s.turn, mySymbol);
    if (move >= 0) soloPlay(move);
  }, 650);   // small pause so it feels like the computer is "thinking"
}

/* ---------- AI ---------- */
const rand = (a) => a[Math.floor(Math.random() * a.length)];

function minimax(b, player, ai, human, depth) {
  const r = winnerOf(b);
  if (r) return r.winner === ai ? 10 - depth : depth - 10;
  if (b.every(Boolean)) return 0;
  let best = player === ai ? -Infinity : Infinity;
  for (let i = 0; i < 9; i++) {
    if (b[i]) continue;
    b[i] = player;
    const score = minimax(b, player === ai ? human : ai, ai, human, depth + 1);
    b[i] = null;
    best = player === ai ? Math.max(best, score) : Math.min(best, score);
  }
  return best;
}

function pickMove(board, level, ai, human) {
  const empty = [];
  board.forEach((v, i) => { if (!v) empty.push(i); });
  if (!empty.length) return -1;

  // Easy: completely random
  if (level === "easy") return rand(empty);

  const findWin = (sym) => empty.find((i) => {
    board[i] = sym;
    const w = !!winnerOf(board);
    board[i] = null;
    return w;
  });

  // Normal: wins / blocks / takes centre + corners, but slips up 20% of the time
  if (level === "normal") {
    if (Math.random() < 0.2) return rand(empty);
    const w = findWin(ai);    if (w !== undefined) return w;
    const b = findWin(human); if (b !== undefined) return b;
    if (!board[4]) return 4;
    const corners = [0, 2, 6, 8].filter((i) => !board[i]);
    return corners.length ? rand(corners) : rand(empty);
  }

  // Unbeatable: full minimax (best it can do is a draw against perfect play)
  let best = -Infinity, moves = [];
  for (const i of empty) {
    board[i] = ai;
    const score = minimax(board, human, ai, human, 1);
    board[i] = null;
    if (score > best) { best = score; moves = [i]; }
    else if (score === best) moves.push(i);
  }
  return rand(moves);
}

/* ---------- Warm up the server in the background (wakes Render, never blocks the page) ---------- */
loadSocket().catch(() => {});