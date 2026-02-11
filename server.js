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

function broadcast(roomCode, payload, excludeWs = null) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const msg = JSON.stringify(payload);
  for (const ws of room.players.keys()) {
    if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) ws.send(msg);
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
    winner: room.winner,
    chat: room.chat || [] // חשוב! שומר את הצ'אט ב-state
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
      
      if (room.players.size === 1) {
        const onlyWs = [...room.players.keys()][0];
        const onlyPlayer = room.players.get(onlyWs);
        if (onlyPlayer) onlyPlayer.symbol = "X";
      }

      room.board = makeEmptyBoard();
      room.turn = "X";
      room.winner = null;
      
      addChatMessage(code, null, `שחקן התנתק (${leaver?.name || ""})`, "system");

      broadcast(code, roomState(code));
    }
  }
}

function addChatMessage(roomCode, sender, text, type = "user") {
  const room = rooms.get(roomCode);
  if (!room) return null;
  
  if (!room.chat) room.chat = [];
  
  const message = {
    id: Date.now() + Math.random(),
    sender: sender ? { id: sender.id, name: sender.name } : null,
    text: text.slice(0, 300),
    timestamp: Date.now(),
    type
  };
  
  room.chat.push(message);
  
  if (room.chat.length > 50) {
    room.chat = room.chat.slice(-50);
  }
  
  // שידור הודעת הצ'אט
  broadcast(roomCode, { type: "chat", message });
  
  // חשוב! גם שולחים state מעודכן עם הצ'אט החדש
  broadcast(roomCode, roomState(roomCode));
  
  return message;
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
        winner: null,
        chat: []
      };
      rooms.set(roomCode, room);

      const id = makePlayerId();
      room.players.set(ws, { id, name, symbol: "X" });

      ws.send(JSON.stringify({ type: "joined", id, roomCode, symbol: "X" }));
      
      addChatMessage(roomCode, null, `${name} יצר את החדר`, "system");
      addChatMessage(roomCode, null, "ברוכים הבאים! אפשר לדבר בצ'אט", "system");
      
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
      
      addChatMessage(roomCode, null, `${name} הצטרף (${symbol})`, "system");
      
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
      if (w) {
        room.winner = w;
        if (w !== "DRAW") {
          addChatMessage(roomCode, null, `${player.name} (${w}) ניצח! 🏆`, "system");
        } else {
          addChatMessage(roomCode, null, `תיקו! 🤝`, "system");
        }
      } else {
        room.turn = room.turn === "X" ? "O" : "X";
      }

      broadcast(roomCode, roomState(roomCode));
      return;
    }

    // RESET
    if (msg.type === "reset") {
        const roomCode = String(msg.roomCode || "").trim().toUpperCase();
        const room = rooms.get(roomCode);
        if (!room) return;
        if (!room.players.has(ws)) return;

        const player = room.players.get(ws);
        
        room.board = makeEmptyBoard();
        room.winner = null;

        if (room.players.size === 2) {
            for (const p of room.players.values()) {
            p.symbol = (p.symbol === "X") ? "O" : "X";
            }
        }

        room.turn = "X";
        
        addChatMessage(roomCode, null, `${player?.name} איפס את המשחק - הוחלפו תפקידים`, "system");

        broadcast(roomCode, roomState(roomCode));
        return;
    }
    
    // CHAT MESSAGE
    if (msg.type === "chat") {
      const roomCode = String(msg.roomCode || "").trim().toUpperCase();
      const room = rooms.get(roomCode);
      if (!room) return;
      
      const player = room.players.get(ws);
      if (!player) return;
      
      const text = String(msg.text || "").trim();
      if (!text) return;
      
      addChatMessage(roomCode, player, text, "user");
      return;
    }
    
    // GET CHAT HISTORY
    if (msg.type === "get_chat") {
      const roomCode = String(msg.roomCode || "").trim().toUpperCase();
      const room = rooms.get(roomCode);
      if (!room) return;
      if (!room.players.has(ws)) return;
      
      ws.send(JSON.stringify({
        type: "chat_history",
        messages: room.chat || []
      }));
    }
  });

  ws.on("close", () => cleanupSocket(ws));
  ws.on("error", () => cleanupSocket(ws));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server listening on", PORT));