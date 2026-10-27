/* ==========================================================================
   client.js — Handles dynamic loading of Socket.IO + Game Logic
   ========================================================================== */

// 1. I-declare ang Render URL
const BACKEND_URL = "https://tictac-4omr.onrender.com";

// 2. Function para i-load ang socket.io nang dynamic
function loadSocketIO(callback) {
  const script = document.createElement("script");
  script.src = BACKEND_URL + "/socket.io/socket.io.js";
  script.onload = () => {
    console.log("Socket.IO loaded successfully!");
    callback();
  };
  script.onerror = () => {
    console.error("Failed to load Socket.IO from Render. Is the server awake?");
    document.getElementById("error").textContent = "Cannot reach game server. Please wait a minute and refresh.";
  };
  document.head.appendChild(script);
}

// 3. I-load ang socket.io, tapos patakbuhin ang laro
loadSocketIO(() => {
  // Dito natin sisimulan ang laro kapag siguradong loaded na ang `io`
  initGame();
});

function initGame() {
  // Kokonekta ito sa Render URL
  const socket = io(BACKEND_URL, { transports: ["websocket", "polling"] });
  const $ = (id) => document.getElementById(id);

  let mySymbol = null;   
  let state = null;      

  /* ---------- Lobby ---------- */
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

  // Decorative opening position
  Board3D.sync(["X", "O", null, null, "X", null, "X", null, "O"]);

  /* ---------- Joined a room ---------- */
  socket.on("joined", ({ code, symbol }) => {
    mySymbol = symbol;                      
    $("roomCode").textContent = code;
    $("lobby").hidden = true;
    $("hud").hidden = false;
    Board3D.reset();                        
    Board3D.setPlayer(symbol);              
    Board3D.setMode("game");                
  });

  /* ---------- 3D click -> server ---------- */
  Board3D.onCellClick = (cellIndex) => socket.emit("makeMove", cellIndex);

  /* ---------- Server state -> 3D + HUD ---------- */
  socket.on("state", (s) => { state = s; render(); });

  function render() {
    const { board, turn, names, scores, over, winner, line, playerCount } = state;

    Board3D.sync(board, line);                                          
    Board3D.setInteractive(!over && playerCount === 2 && turn === mySymbol);  

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
  $("homeBtn").onclick = () => location.reload();   
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
    p.append(b, document.createTextNode(text));   
    $("messages").appendChild(p);
    $("messages").scrollTop = $("messages").scrollHeight;
  });
}
