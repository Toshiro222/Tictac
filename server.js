const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } }); // allow Live Server (port 5500) to connect

app.use(express.static("public"));

const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
  [0, 4, 8], [2, 4, 6],            // diagonals
];

// rooms[code] = { board, turn, players: { X: socketId, O: socketId }, names, scores, over }
const rooms = {};

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (rooms[code]);
  return code;
}

function checkWinner(board) {
  for (const line of WIN_LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line };
    }
  }
  return null;
}

function publicState(room) {
  return {
    board: room.board,
    turn: room.turn,
    names: room.names,
    scores: room.scores,
    over: room.over,
    winner: room.winner || null,
    line: room.line || null,
    playerCount: Object.keys(room.players).length,
  };
}

function resetRound(room) {
  room.board = Array(9).fill(null);
  room.turn = "X";
  room.over = false;
  room.winner = null;
  room.line = null;
}

io.on("connection", (socket) => {
  socket.on("createRoom", (name) => {
    if (typeof name !== "string" || !name.trim()) {
      return socket.emit("errorMsg", "Please enter your name first.");
    }
    name = name.trim();
    const code = makeCode();
    rooms[code] = {
      board: Array(9).fill(null),
      turn: "X",
      players: { X: socket.id },
      names: { X: (name || "Player 1").slice(0, 16), O: null },
      scores: { X: 0, O: 0, draws: 0 },
      over: false,
    };
    socket.join(code);
    socket.data.code = code;
    socket.data.symbol = "X";
    socket.emit("joined", { code, symbol: "X" });
    io.to(code).emit("state", publicState(rooms[code]));
  });

  socket.on("joinRoom", ({ code, name }) => {
    if (typeof name !== "string" || !name.trim()) {
      return socket.emit("errorMsg", "Please enter your name first.");
    }
    name = name.trim();
    code = (code || "").toUpperCase().trim();
    const room = rooms[code];
    if (!room) return socket.emit("errorMsg", "Room not found.");
    if (room.players.O) return socket.emit("errorMsg", "Room is full.");

    room.players.O = socket.id;
    room.names.O = (name || "Player 2").slice(0, 16);
    socket.join(code);
    socket.data.code = code;
    socket.data.symbol = "O";
    socket.emit("joined", { code, symbol: "O" });
    io.to(code).emit("state", publicState(room));
  });

  socket.on("makeMove", (index) => {
    const room = rooms[socket.data.code];
    if (!room || room.over) return;
    if (!room.players.X || !room.players.O) return;   // need both players
    if (room.turn !== socket.data.symbol) return;     // not your turn
    if (!Number.isInteger(index) || index < 0 || index > 8) return;
    if (room.board[index]) return;                    // square taken

    room.board[index] = socket.data.symbol;

    const result = checkWinner(room.board);
    if (result) {
      room.over = true;
      room.winner = result.winner;
      room.line = result.line;
      room.scores[result.winner]++;
    } else if (room.board.every(Boolean)) {
      room.over = true;
      room.winner = "draw";
      room.scores.draws++;
    } else {
      room.turn = room.turn === "X" ? "O" : "X";
    }
    io.to(socket.data.code).emit("state", publicState(room));
  });

  socket.on("rematch", () => {
    const room = rooms[socket.data.code];
    if (!room || !room.over) return;
    resetRound(room);
    io.to(socket.data.code).emit("state", publicState(room));
  });

  socket.on("chat", (text) => {
    const code = socket.data.code;
    const room = rooms[code];
    if (!room || typeof text !== "string") return;
    const name = room.names[socket.data.symbol];
    io.to(code).emit("chat", { name, text: text.slice(0, 200) });
  });

  socket.on("disconnect", () => {
    const code = socket.data.code;
    const room = rooms[code];
    if (!room) return;
    delete room.players[socket.data.symbol];
    if (Object.keys(room.players).length === 0) {
      delete rooms[code];
    } else {
      io.to(code).emit("opponentLeft");
      delete rooms[code]; // simple approach: end the room
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));