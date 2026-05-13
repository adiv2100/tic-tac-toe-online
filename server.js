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
    hostName: t.players[0]?.name || "?",
    roomCode: t.roomCode,
    players: t.players.map(p => ({ name: p.name, symbol: p.symbol, connected: p.connected !== false }))
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

  const players = getAllRoomPlayers(room).map(p => ({
    id: p.id,
    name: p.name,
    symbol: p.symbol,
    connected: p.connected !== false
  }));

  return {
    type: "state",
    roomCode,
    players,
    board: [...room.board],
    turn: room.turn,
    winner: room.winner,
    chat: room.chat || [],
    lobbyTableId: room.lobbyTableId
  };
}

function makePlayerId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
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


function getAllRoomPlayers(room) {
  const active = [...room.players.values()].map(p => ({ ...p, connected: true }));
  const disconnected = Array.isArray(room.disconnectedPlayers)
    ? room.disconnectedPlayers.map(p => ({ ...p, connected: false }))
    : [];
  return [...active, ...disconnected];
}

function getRoomPlayerCount(room) {
  return getAllRoomPlayers(room).length;
}

function updateLobbyPlayerConnection(room, playerId, ws, connected) {
  if (!room || !room.lobbyTableId) return;
  const table = lobbyTables.get(room.lobbyTableId);
  if (!table) return;
  const player = table.players.find(p => p.id === playerId);
  if (player) {
    player.ws = ws || null;
    player.connected = connected;
  }
  table.playersCount = table.players.length;
  table.status = table.players.length >= table.maxPlayers ? "playing" : "waiting";
}

function removePlayerEverywhere(ws) {
  for (const [tableId, table] of lobbyTables.entries()) {
    const idx = table.players.findIndex(p => p.ws === ws);
    if (idx !== -1) {
      table.players.splice(idx, 1);
      if (table.players.length === 0) lobbyTables.delete(tableId);
      else table.status = table.players.length >= table.maxPlayers ? "playing" : "waiting";
    }
  }

  for (const [code, room] of rooms.entries()) {
    if (room.players.has(ws)) {
      const leaver = room.players.get(ws);
      room.players.delete(ws);
      if (Array.isArray(room.disconnectedPlayers)) {
        room.disconnectedPlayers = room.disconnectedPlayers.filter(p => p.id !== leaver.id);
      }
      if (getRoomPlayerCount(room) === 0) rooms.delete(code);
      else addChatMessage(code, null, `${leaver?.name || "שחקן"} יצא מהשולחן`, "system");
    }
  }
  broadcastLobby();
}

function cleanupSocket(ws) {
  console.log(`[CLEANUP] 🧹 מסמן ניתוק זמני...`);

  for (const [code, room] of rooms.entries()) {
    if (!room.players.has(ws)) continue;

    const leaver = room.players.get(ws);
    room.players.delete(ws);
    if (!room.disconnectedPlayers) room.disconnectedPlayers = [];

    const existing = room.disconnectedPlayers.find(p => p.id === leaver.id);
    if (existing) {
      existing.name = leaver.name;
      existing.symbol = leaver.symbol;
      existing.disconnectedAt = Date.now();
    } else {
      room.disconnectedPlayers.push({
        id: leaver.id,
        name: leaver.name,
        symbol: leaver.symbol,
        disconnectedAt: Date.now()
      });
    }

    updateLobbyPlayerConnection(room, leaver.id, null, false);
    addChatMessage(code, null, `${leaver?.name || "שחקן"} התנתק זמנית - ניתן לרענן ולחזור למשחק`, "system");
    broadcast(code, roomState(code));
    broadcastLobby();

    setTimeout(() => {
      const currentRoom = rooms.get(code);
      if (!currentRoom || !currentRoom.disconnectedPlayers) return;
      const before = currentRoom.disconnectedPlayers.length;
      currentRoom.disconnectedPlayers = currentRoom.disconnectedPlayers.filter(p => p.id !== leaver.id);
      if (currentRoom.disconnectedPlayers.length !== before) {
        if (currentRoom.lobbyTableId) {
          const table = lobbyTables.get(currentRoom.lobbyTableId);
          if (table) {
            table.players = table.players.filter(p => p.id !== leaver.id);
            if (table.players.length === 0) lobbyTables.delete(table.id);
            else table.status = table.players.length >= table.maxPlayers ? "playing" : "waiting";
          }
        }
        if (getRoomPlayerCount(currentRoom) === 0) rooms.delete(code);
        else broadcast(code, roomState(code));
        broadcastLobby();
        console.log(`[CLEANUP] ⏱️ שחקן ${leaver?.name || "?"} לא חזר בזמן ונוקה מחדר ${code}`);
      }
    }, 5 * 60 * 1000);
  }
}

wss.on("connection", (ws) => {
  ws.subscribedToLobby = false;
  ws.playerId = null;
  ws.roomCode = null;
  ws.lobbyTableId = null;

  console.log(`[CONNECTION] 🔌 התחברות חדשה, סה"כ: ${wss.clients.size}`);

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "rejoin") {
      const roomCode = String(msg.roomCode || "").trim().toUpperCase();
      const playerId = String(msg.playerId || "").trim();
      const name = String(msg.name || "אורח").trim().slice(0, 20) || "אורח";
      const room = rooms.get(roomCode);

      if (!room || !playerId) {
        ws.send(JSON.stringify({ type: "rejoin_failed", message: "לא נמצא משחק לשחזור" }));
        return;
      }

      const activeSame = [...room.players.entries()].find(([, p]) => p.id === playerId);
      let player = null;
      if (activeSame) {
        const [oldWs, oldPlayer] = activeSame;
        try { if (oldWs !== ws) oldWs.close(); } catch { }
        room.players.delete(oldWs);
        player = oldPlayer;
      } else if (Array.isArray(room.disconnectedPlayers)) {
        const idx = room.disconnectedPlayers.findIndex(p => p.id === playerId);
        if (idx !== -1) {
          player = room.disconnectedPlayers.splice(idx, 1)[0];
        }
      }

      if (!player) {
        ws.send(JSON.stringify({ type: "rejoin_failed", message: "לא נמצא שחקן לשחזור" }));
        return;
      }

      player.name = player.name || name;
      ws.playerId = player.id;
      ws.roomCode = roomCode;
      ws.lobbyTableId = room.lobbyTableId || null;
      room.players.set(ws, { id: player.id, name: player.name, symbol: player.symbol });
      updateLobbyPlayerConnection(room, player.id, ws, true);

      ws.send(JSON.stringify({
        type: "joined",
        id: player.id,
        roomCode,
        symbol: player.symbol,
        lobbyTableId: room.lobbyTableId || null,
        restored: true
      }));
      addChatMessage(roomCode, null, `${player.name} התחבר מחדש`, "system");
      broadcast(roomCode, roomState(roomCode));
      broadcastLobby();
      return;
    }

    if (msg.type === "get_state") {
      const roomCode = String(msg.roomCode || "").trim().toUpperCase();
      if (roomCode && rooms.has(roomCode)) {
        const state = roomState(roomCode);
        if (state) ws.send(JSON.stringify(state));
      }
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
      ws.playerId = id;

      const room = {
        players: new Map(),
        board: makeEmptyBoard(),
        turn: "X",
        winner: null,
        chat: [],
        disconnectedPlayers: [],
        lobbyTableId: String(nextTableId),
        createdAt: Date.now()
      };
      rooms.set(finalRoomCode, room);
      room.players.set(ws, { id, name, symbol: "X" });

      const table = {
        id: String(nextTableId++),
        name: tableName,
        maxPlayers: 2,
        players: [{ ws, name, id, symbol: "X", connected: true }],
        status: "waiting",
        roomCode: finalRoomCode,
        createdAt: Date.now()
      };
      lobbyTables.set(table.id, table);

      ws.lobbyTableId = table.id;
      ws.roomCode = finalRoomCode;

      console.log(`[创建] 🎮 ${name} יצר שולחן "${tableName}" (${table.id}) קוד: ${finalRoomCode}`);

      ws.send(JSON.stringify({
        type: "joined",
        id,
        roomCode: finalRoomCode,
        symbol: "X",
        lobbyTableId: table.id
      }));

      addChatMessage(finalRoomCode, null, `${name} יצר את השולחן "${tableName}"`, "system");
      addChatMessage(finalRoomCode, null, "ברוכים הבאים! מחכים לשחקן נוסף...", "system");
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
      let room = rooms.get(roomCode);
      
      if (!room) {
        console.log(`[ERROR] חדר ${roomCode} לא קיים לשולחן ${tableId}`);
        ws.send(JSON.stringify({ type: "error", message: "שגיאת מערכת" }));
        return;
      }

      if (getRoomPlayerCount(room) >= 2) {
        ws.send(JSON.stringify({ type: "error", message: "החדר מלא" }));
        return;
      }

      const id = makePlayerId();
      ws.playerId = id;
      
      let symbol = "O";
      if (getRoomPlayerCount(room) === 0) {
        symbol = "X";
      } else {
        const existing = getAllRoomPlayers(room)[0];
        symbol = (existing.symbol === "X") ? "O" : "X";
      }
      
      room.players.set(ws, { id, name, symbol });
      table.players.push({ ws, name, id, symbol, connected: true });
      
      if (table.players.length >= table.maxPlayers) {
        table.status = "playing";
      }

      ws.lobbyTableId = tableId;
      ws.roomCode = roomCode;

      console.log(`[加入] ✅ ${name} הצטרף לשולחן ${tableId} (${symbol}) קוד: ${roomCode}`);
      console.log(`[加入] כעת ${room.players.size} שחקנים בחדר`);

      ws.send(JSON.stringify({
        type: "joined",
        id,
        roomCode,
        symbol,
        lobbyTableId: tableId
      }));

      addChatMessage(roomCode, null, `${name} הצטרף (${symbol})`, "system");
      
      // שליחת המצב המלא לשני השחקנים
      const fullState = roomState(roomCode);
      broadcast(roomCode, fullState);
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

      if (getRoomPlayerCount(room) >= 2) {
        ws.send(JSON.stringify({ type: "error", message: "החדר מלא" }));
        return;
      }

      const id = makePlayerId();
      ws.playerId = id;
      
      let symbol = "O";
      if (getRoomPlayerCount(room) === 0) {
        symbol = "X";
      } else {
        const existing = getAllRoomPlayers(room)[0];
        symbol = (existing.symbol === "X") ? "O" : "X";
      }
      
      room.players.set(ws, { id, name, symbol });
      ws.roomCode = roomCode;

      console.log(`[加入] ✅ ${name} הצטרף לחדר ${roomCode} (${symbol})`);
      console.log(`[加入] כעת ${room.players.size} שחקנים בחדר`);

      ws.send(JSON.stringify({ type: "joined", id, roomCode, symbol }));
      
      addChatMessage(roomCode, null, `${name} הצטרף (${symbol})`, "system");
      
      const fullState = roomState(roomCode);
      broadcast(roomCode, fullState);
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
      room.turn = "X";
      
      // איפוס סמלים
      const playersArray = getAllRoomPlayers(room);
      if (playersArray[0]) playersArray[0].symbol = "X";
      if (playersArray[1]) playersArray[1].symbol = "O";
      
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
      removePlayerEverywhere(ws);
      ws.send(JSON.stringify({ type: "left_table" }));
      return;
    }
  });

  ws.on("close", () => {
    console.log(`[CLOSE] 🔌 חיבור נסגר, סה"כ: ${wss.clients.size}`);
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