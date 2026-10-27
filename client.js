/* ==========================================================================
   client.js — socket + game state → 3D board and glass HUD
   Look for "INTEGRATION POINT" to see where game state flows in and out.
   ========================================================================== */
const socket = typeof SERVER !== "undefined" && SERVER ? io(SERVER) : io();
const $ = (id) => document.getElementById(id);

let mySymbol = null;   // "X" or "O" (set when you create/join a room)
let state = null;      // latest server state: { board, turn, names, scores, over, winner, line, playerCount }

/* ---------- Lobby (a name is required) ---------- */
const getName = () => $("nameInput").value.trim();

function updateLobby() {
  const ok = getName().length > 0;
  $("createBtn").disabled = $("joinBtn").disabled = $("codeInput").disabled = !ok;
  $("codeInput").placeholder = ok ? "Room code" : "Enter your name first";
  if (ok) $("error").textContent = "";
}
$("nameInput").addEventListener("input", updateLobby);
updateLobby();

$("createBtn").onclick = () => {
  if (!getName()) return ($("error").textContent = "Please enter your name first.");
  socket.emit("createRoom", getName());
};
$("joinBtn").onclick = () => {
  if (!getName()) return ($("error").textContent = "Please enter your name first.");
  const code = $("codeInput").value.trim();
  if (!code) return ($("error").textContent = "Please enter the room code.");
  socket.emit("joinRoom", { code, name: getName() });
};
socket.on("errorMsg", (msg) => ($("error").textContent = msg));

// Decorative opening position on the lobby board
Board3D.sync(["X", "O", null, null, "X", null, "X", null, "O"]);

/* ---------- Joined a room ---------- */
socket.on("joined", ({ code, symbol }) => {
  mySymbol = symbol;                      // INTEGRATION POINT: current player
  $("roomCode").textContent = code;
  $("lobby").hidden = true;
  $("hud").hidden = false;
  Board3D.reset();                        // clear the demo pieces
  Board3D.setPlayer(symbol);              // which ghost token to preview
  Board3D.setMode("game");                // board glides to the centre
});

/* ---------- 3D click → server ---------- */
// INTEGRATION POINT: user clicked an empty 3D cell
Board3D.onCellClick = (cellIndex) => socket.emit("makeMove", cellIndex);

/* ---------- Server state → 3D + HUD ---------- */
socket.on("state", (s) => { state = s; render(); });

function render() {
  const { board, turn, names, scores, over, winner, line, playerCount } = state;  // INTEGRATION POINT: grid, turn, scores

  Board3D.sync(board, line);                                          // draw tokens + winning line glow
  Board3D.setInteractive(!over && playerCount === 2 && turn === mySymbol);  // only on your turn

  $("nameX").textContent = names.X || "…";   $("pointsX").textContent = scores.X;
  $("nameO").textContent = names.O || "…";   $("pointsO").textContent = scores.O;
  $("pointsD").textContent = scores.draws;

  const myTurn = !over && playerCount === 2 && turn === mySymbol;
  $("status").dataset.mine = myTurn ? "1" : "0";
  if (playerCount < 2) $("status").textContent = "Waiting for a friend to join…";
  else if (over) $("status").textContent = winner === "draw" ? "It’s a draw" : winner === mySymbol ? "You win" : "You lose";
  else $("status").textContent = myTurn ? "Your turn" : `${names[turn]}’s turn`;
  $("rematchBtn").hidden = !over;
}

$("rematchBtn").onclick = () => socket.emit("rematch");
$("homeBtn").onclick = () => location.reload();   // leave the room, back to the lobby
$("roomCode").onclick = () => navigator.clipboard && navigator.clipboard.writeText($("roomCode").textContent);

socket.on("opponentLeft", () => {
  Board3D.setInteractive(false);
  $("status").dataset.mine = "0";
  $("status").textContent = "Your opponent left";
  $("rematchBtn").hidden = true;
});

/* ---------- Chat ---------- */
function sendChat() {
  const text = $("chatInput").value.trim();
  if (!text) return;
  socket.emit("chat", text);
  $("chatInput").value = "";
}
$("chatBtn").onclick = sendChat;
$("chatInput").addEventListener("keydown", (e) => e.key === "Enter" && sendChat());

socket.on("chat", ({ name, text }) => {
  const p = document.createElement("p"), b = document.createElement("b");
  b.textContent = name + " ";
  p.append(b, document.createTextNode(text));   // textContent keeps it safe from HTML injection
  $("messages").appendChild(p);
  $("messages").scrollTop = $("messages").scrollHeight;
});
