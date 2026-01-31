const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
app.use(express.static("public"));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const rooms = new Map();

function makeEmptyBoard() {
  return Array(9).fill("");
}

function checkWinner(b) {
  const lines = [
    [0, 1, 2],[3, 4, 5],[6, 7, 8],
    [0, 3, 6],[1, 4, 7],[2, 5, 8],
    [0, 4, 8],[2, 4, 6]
  ];
  for (const [a, c, d] of lines) {
    if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a];
  }
  if (b.every(cell => cell)) return "DRAW";
  return null;
}

function broadcast(roomCode, payload) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const msg = JSON.stringify(payload);
  for (const ws of room.players.keys()) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

function roomState(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return null;

  const players = [...room.players.values()].map(p => ({
    id: p.id,
    name: p.name,
    symbol: p.symbol
  }));

  return {
    type: "state",
    roomCode,
    players,
    board: room.board,
    turn: room.turn,
    winner: room.winner
  };
}

function makePlayerId() {
  return Math.random().toString(36).slice(2, 10);
}

function generateRoomCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function cleanupSocket(ws) {
  for (const [code, room] of rooms.entries()) {
    if (room.players.has(ws)) {
      const leaver = room.players.get(ws);
      room.players.delete(ws);

      if (room.players.size === 0) {
        rooms.delete(code);
        continue;
      }
      // אם נשאר שחקן אחד - תמיד ננרמל אותו ל-X כדי למנוע O+O
      if (room.players.size === 1) {
        const onlyWs = [...room.players.keys()][0];
        const onlyPlayer = room.players.get(onlyWs);
        if (onlyPlayer) onlyPlayer.symbol = "X";
      }

      room.board = makeEmptyBoard();
      room.turn = "X";
      room.winner = null;

      broadcast(code, { type: "info", message: `שחקן התנתק (${leaver?.name || ""}). המשחק אופס.` });
      broadcast(code, roomState(code));
    }
  }
}

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // CREATE ROOM
    if (msg.type === "create_room") {
      const name = String(msg.name || "שחקן").trim().slice(0, 20) || "שחקן";

      let roomCode = generateRoomCode();
      let guard = 0;
      while (rooms.has(roomCode) && guard < 50) {
        roomCode = generateRoomCode();
        guard++;
      }

      const room = {
        players: new Map(),
        board: makeEmptyBoard(),
        turn: "X",
        winner: null
      };
      rooms.set(roomCode, room);

      const id = makePlayerId();
      room.players.set(ws, { id, name, symbol: "X" });

      ws.send(JSON.stringify({ type: "joined", id, roomCode, symbol: "X" }));
      broadcast(roomCode, { type: "info", message: `${name} הצטרף (X)` });
      broadcast(roomCode, roomState(roomCode));
      return;
    }

    // JOIN
    if (msg.type === "join") {
      const roomCode = String(msg.roomCode || "").trim().toUpperCase();
      const name = String(msg.name || "שחקן").trim().slice(0, 20) || "שחקן";

      if (!roomCode) {
        ws.send(JSON.stringify({ type: "error", message: "חסר קוד חדר" }));
        return;
      }

      let room = rooms.get(roomCode);
      if (!room) {
        ws.send(JSON.stringify({ type: "error", message: "חדר לא קיים" }));
        return;
      }


      if (room.players.size >= 2) {
        ws.send(JSON.stringify({ type: "error", message: "החדר מלא (2 שחקנים)" }));
        return;
      }

      const id = makePlayerId();
      let symbol = "X";
      if (room.players.size === 1) {
        const existing = [...room.players.values()][0];
        symbol = (existing.symbol === "X") ? "O" : "X";
      }
      room.players.set(ws, { id, name, symbol });

      ws.send(JSON.stringify({ type: "joined", id, roomCode, symbol }));
      broadcast(roomCode, { type: "info", message: `${name} הצטרף (${symbol})` });
      broadcast(roomCode, roomState(roomCode));
      return;
    }

    // MOVE
    if (msg.type === "move") {
      const roomCode = String(msg.roomCode || "").trim().toUpperCase();
      const index = Number(msg.index);

      const room = rooms.get(roomCode);
      if (!room) return;

      const player = room.players.get(ws);
      if (!player) return;

      if (room.players.size < 2) {
        ws.send(JSON.stringify({ type: "error", message: "ממתינים לשחקן נוסף..." }));
        return;
      }

      if (room.winner) return;
      if (!Number.isInteger(index) || index < 0 || index > 8) return;
      if (room.board[index]) return;
      if (player.symbol !== room.turn) return;

      room.board[index] = player.symbol;

      const w = checkWinner(room.board);
      if (w) room.winner = w;
      else room.turn = room.turn === "X" ? "O" : "X";

      broadcast(roomCode, roomState(roomCode));
      return;
    }

    // RESET
    if (msg.type === "reset") {
        const roomCode = String(msg.roomCode || "").trim().toUpperCase();
        const room = rooms.get(roomCode);
        if (!room) return;
        if (!room.players.has(ws)) return;

        // מאפס לוח
        room.board = makeEmptyBoard();
        room.winner = null;

        // מחליף תפקידים בין שני השחקנים (X<->O) אם יש שניים
        if (room.players.size === 2) {
            for (const p of room.players.values()) {
            p.symbol = (p.symbol === "X") ? "O" : "X";
            }
        }

        // X תמיד מתחיל, אבל מכיוון שהחלפנו סמלים - בפועל מי שמתחיל מתחלף
        room.turn = "X";

        broadcast(roomCode, { type: "info", message: "המשחק אופס + הוחלפו תפקידים" });
        broadcast(roomCode, roomState(roomCode));
        return;
        }

  });

  ws.on("close", () => cleanupSocket(ws));
  ws.on("error", () => cleanupSocket(ws));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server listening on", PORT));
