const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
app.use(express.static("public"));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

console.log(`[BOOT] 🚀 X-עיגול שרת עם לובי עולה`);

const rooms = new Map();
const lobbyTables = new Map();
let nextTableId = 1;

function makeEmptyBoard() {
  return Array(9).fill("");
}

function checkWinner(b) {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
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

function broadcastLobby() {
  const lobbyData = Array.from(lobbyTables.values()).map(t => ({
    id: t.id,
    name: t.name,
    playersCount: t.players.length,
    maxPlayers: t.maxPlayers,
    status: t.status,
    hostName: t.players[0]?.name || "?"
  }));

  const payload = JSON.stringify({ type: "lobby_update", tables: lobbyData });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN && client.subscribedToLobby) {
      client.send(payload);
    }
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
    chat: room.chat || [],
    lobbyTableId: room.lobbyTableId
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
  if (room.chat.length > 50) room.chat = room.chat.slice(-50);

  broadcast(roomCode, { type: "chat", message });
  broadcast(roomCode, roomState(roomCode));
  return message;
}

function cleanupSocket(ws) {
  for (const [tableId, table] of lobbyTables.entries()) {
    const idx = table.players.findIndex(p => p.ws === ws);
    if (idx !== -1) {
      table.players.splice(idx, 1);
      if (table.players.length === 0) {
        lobbyTables.delete(tableId);
        for (const [code, room] of rooms.entries()) {
          if (room.lobbyTableId === tableId) {
            rooms.delete(code);
            break;
          }
        }
      } else {
        table.status = table.players.length >= table.maxPlayers ? "playing" : "waiting";
      }
      broadcastLobby();
      break;
    }
  }

  for (const [code, room] of rooms.entries()) {
    if (room.players.has(ws)) {
      const leaver = room.players.get(ws);
      console.log(`[离开] 👋 ${leaver?.name} עזב את החדר ${code}`);

      room.players.delete(ws);

      if (room.players.size === 0) {
        rooms.delete(code);
        continue;
      }

      if (room.players.size === 1) {
        const onlyWs = [...room.players.keys()][0];
        const onlyPlayer = room.players.get(onlyWs);
        if (onlyPlayer) {
          onlyPlayer.symbol = "X";
        }
      }

      room.board = makeEmptyBoard();
      room.turn = "X";
      room.winner = null;
      addChatMessage(code, null, `שחקן התנתק (${leaver?.name || ""})`, "system");
      broadcast(code, roomState(code));
    }
  }
}

wss.on("connection", (ws) => {
  ws.subscribedToLobby = false;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "subscribe_lobby") {
      ws.subscribedToLobby = true;
      broadcastLobby();
      ws.send(JSON.stringify({ type: "lobby_ready" }));
      return;
    }

    if (msg.type === "create_lobby_table") {
      const name = String(msg.name || "אורח").trim().slice(0, 20) || "אורח";
      const tableName = String(msg.tableName || `שולחן ${nextTableId}`).trim().slice(0, 30);

      let finalRoomCode = generateRoomCode();
      while (rooms.has(finalRoomCode)) {
        finalRoomCode = generateRoomCode();
}

      const id = makePlayerId();
      ws._playerId = id;

      const room = {
        players: new Map(),
        board: makeEmptyBoard(),
        turn: "X",
        winner: null,
        chat: [],
        lobbyTableId: String(nextTableId)
      };
      rooms.set(finalRoomCode, room);
      room.players.set(ws, { id, name, symbol: "X" });

      const table = {
        id: String(nextTableId++),
        name: tableName,
        maxPlayers: 2,
        players: [{ ws, name, id, symbol: "X" }],
        status: "waiting",
        roomCode: finalRoomCode,
        createdAt: Date.now()
      };
      lobbyTables.set(table.id, table);

      ws.lobbyTableId = table.id;
      ws.roomCode = finalRoomCode;

      console.log(`[创建] 🎮 ${name} יצר שולחן "${tableName}" (${table.id})`);

      ws.send(JSON.stringify({
        type: "joined",
        id,
        roomCode: finalRoomCode,
        symbol: "X",
        lobbyTableId: table.id
      }));

      addChatMessage(finalRoomCode, null, `${name} יצר את השולחן "${tableName}"`, "system");
      addChatMessage(finalRoomCode, null, "ברוכים הבאים! אפשר לדבר בצ'אט", "system");
      broadcast(finalRoomCode, roomState(finalRoomCode));
      broadcastLobby();
      return;
    }

    if (msg.type === "join_lobby_table") {
      const tableId = String(msg.tableId);
      const name = String(msg.name || "אורח").trim().slice(0, 20) || "אורח";

      const table = lobbyTables.get(tableId);
      if (!table) {
        ws.send(JSON.stringify({ type: "error", message: "שולחן לא קיים" }));
        return;
      }
      if (table.players.length >= table.maxPlayers) {
        ws.send(JSON.stringify({ type: "error", message: "השולחן מלא" }));
        return;
      }

      const roomCode = table.roomCode;
      const room = rooms.get(roomCode);
      if (!room) {
        ws.send(JSON.stringify({ type: "error", message: "שגיאה פנימית" }));
        return;
      }

      const id = makePlayerId();
      ws._playerId = id;
      let symbol = "X";
      if (room.players.size === 1) {
        const existing = [...room.players.values()][0];
        symbol = (existing.symbol === "X") ? "O" : "X";
      }
      room.players.set(ws, { id, name, symbol });

      table.players.push({ ws, name, id, symbol });
      if (table.players.length >= table.maxPlayers) {
        table.status = "playing";
      }

      ws.lobbyTableId = tableId;
      ws.roomCode = roomCode;

      console.log(`[加入] ✅ ${name} הצטרף לשולחן ${tableId} (${symbol})`);

      ws.send(JSON.stringify({
        type: "joined",
        id,
        roomCode,
        symbol,
        lobbyTableId: tableId
      }));

      addChatMessage(roomCode, null, `${name} הצטרף (${symbol})`, "system");
      broadcast(roomCode, roomState(roomCode));
      broadcastLobby();
      return;
    }

    if (msg.type === "join") {
      const roomCode = String(msg.roomCode || "").trim().toUpperCase();
      const name = String(msg.name || "אורח").trim().slice(0, 20) || "אורח";

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
        ws.send(JSON.stringify({ type: "error", message: "החדר מלא" }));
        return;
      }

      const id = makePlayerId();
      ws._playerId = id;
      let symbol = "X";
      if (room.players.size === 1) {
        const existing = [...room.players.values()][0];
        symbol = (existing.symbol === "X") ? "O" : "X";
      }
      room.players.set(ws, { id, name, symbol });

      console.log(`[加入] ✅ ${name} הצטרף לחדר ${roomCode} (${symbol})`);

      ws.send(JSON.stringify({ type: "joined", id, roomCode, symbol }));

      addChatMessage(roomCode, null, `${name} הצטרף (${symbol})`, "system");
      broadcast(roomCode, roomState(roomCode));
      return;
    }

    if (msg.type === "move") {
      const roomCode = String(msg.roomCode || "").trim().toUpperCase();
      const index = Number(msg.index);
      const room = rooms.get(roomCode);
      if (!room) return;

      const player = room.players.get(ws);
      if (!player) return;

      if (room.players.size < 2) {
        ws.send(JSON.stringify({ type: "error", message: "ממתין לשחקן נוסף" }));
        return;
      }
      if (room.winner) return;
      if (!Number.isInteger(index) || index < 0 || index > 8) return;
      if (room.board[index]) return;
      if (player.symbol !== room.turn) return;

      room.board[index] = player.symbol;
      console.log(`[移动] 🎯 ${player.name} (${player.symbol}) סימן במקום ${index + 1}`);

      const w = checkWinner(room.board);
      if (w) {
        room.winner = w;
        if (w !== "DRAW") {
          console.log(`[结束] 🏆 ${player.name} (${w}) ניצח!`);
          addChatMessage(roomCode, null, `${player.name} (${w}) ניצח! 🏆`, "system");
        } else {
          console.log(`[结束] 🤝 תיקו!`);
          addChatMessage(roomCode, null, `תיקו! 🤝`, "system");
        }
      } else {
        room.turn = room.turn === "X" ? "O" : "X";
      }

      broadcast(roomCode, roomState(roomCode));
      return;
    }

    if (msg.type === "reset") {
      const roomCode = String(msg.roomCode || "").trim().toUpperCase();
      const room = rooms.get(roomCode);
      if (!room || !room.players.has(ws)) return;

      const player = room.players.get(ws);
      console.log(`[重置] 🔄 ${player.name} איפס את המשחק`);

      room.board = makeEmptyBoard();
      room.winner = null;

      if (room.players.size === 2) {
        for (const p of room.players.values()) {
          p.symbol = (p.symbol === "X") ? "O" : "X";
        }
      }
      room.turn = "X";
      addChatMessage(roomCode, null, `${player?.name} איפס את המשחק`, "system");
      broadcast(roomCode, roomState(roomCode));

      if (room.lobbyTableId) {
        const table = lobbyTables.get(room.lobbyTableId);
        if (table) {
          table.status = "waiting";
          broadcastLobby();
        }
      }
      return;
    }

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

    if (msg.type === "get_chat") {
      const roomCode = String(msg.roomCode || "").trim().toUpperCase();
      const room = rooms.get(roomCode);
      if (!room || !room.players.has(ws)) return;
      ws.send(JSON.stringify({
        type: "chat_history",
        messages: room.chat || []
      }));
      return;
    }

    if (msg.type === "leave_table") {
      cleanupSocket(ws);
      ws.send(JSON.stringify({ type: "left_table" }));
      return;
    }
  });

  ws.on("close", () => {
    cleanupSocket(ws);
  });

  ws.on("error", (err) => {
    console.log(`[错误] ❌ ${err.message}`);
    cleanupSocket(ws);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[BOOT] ✅ שרת רץ על יציאה ${PORT}`);
  console.log(`[BOOT] 🚀 http://localhost:${PORT}`);
});