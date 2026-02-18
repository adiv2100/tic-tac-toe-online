const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
app.use(express.static("public"));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

console.log(`[BOOT] 🚀 X-עיגול שרת איקס עולה על Railway`);

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
    chat: room.chat || []
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
      console.log(`[CLEANUP] 🧹 שחקן ${leaver?.id} (${leaver?.name}) מתנתק מחדר ${code}`);
      
      room.players.delete(ws);

      if (room.players.size === 0) {
        rooms.delete(code);
        console.log(`[CLEANUP] 🗑️ חדר ${code} נמחק (אין שחקנים)`);
        continue;
      }
      
      if (room.players.size === 1) {
        const onlyWs = [...room.players.keys()][0];
        const onlyPlayer = room.players.get(onlyWs);
        if (onlyPlayer) {
          const oldSymbol = onlyPlayer.symbol;
          onlyPlayer.symbol = "X";
          console.log(`[CLEANUP] 🔄 שחקן ${onlyPlayer.id} סימלו שונה מ-${oldSymbol} ל-X`);
        }
      }

      room.board = makeEmptyBoard();
      room.turn = "X";
      room.winner = null;
      
      addChatMessage(code, null, `שחקן התנתק (${leaver?.name || ""})`, "system");
      console.log(`[CLEANUP] 📋 לוח אופס בחדר ${code}`);

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
  console.log(`[CONNECT] ✅ לקוח חדש התחבר (סה"כ מחוברים: ${wss.clients.size})`);
  
  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
      console.log(`[MESSAGE] 📨 הודעה: ${msg.type} מ-${ws._playerId || 'unknown'}`);
    } catch {
      console.log(`[ERROR] ❌ הודעה לא חוקית`);
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
      ws._playerId = id;
      room.players.set(ws, { id, name, symbol: "X" });

      console.log(`[CREATE] 🎮 שחקן ${id} (${name}) יצר חדר ${roomCode}`);

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
        console.log(`[JOIN] ⚠️ ניסיון הצטרפות בלי קוד חדר`);
        ws.send(JSON.stringify({ type: "error", message: "חסר קוד חדר" }));
        return;
      }

      let room = rooms.get(roomCode);
      if (!room) {
        console.log(`[JOIN] ❌ חדר ${roomCode} לא קיים`);
        ws.send(JSON.stringify({ type: "error", message: "חדר לא קיים" }));
        return;
      }

      if (room.players.size >= 2) {
        console.log(`[JOIN] ❌ חדר ${roomCode} מלא (${room.players.size}/2)`);
        ws.send(JSON.stringify({ type: "error", message: "החדר מלא (2 שחקנים)" }));
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

      console.log(`[JOIN] ✅ שחקן ${id} (${name}) הצטרף לחדר ${roomCode} בתור ${symbol}`);

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
      if (!room) {
        console.log(`[MOVE] ⚠️ חדר ${roomCode} לא קיים`);
        return;
      }

      const player = room.players.get(ws);
      if (!player) {
        console.log(`[MOVE] ⚠️ שחקן לא מזוהה בחדר ${roomCode}`);
        return;
      }

      console.log(`[MOVE] 🎯 שחקן ${player.id} (${player.symbol}) מנסה להזיז ל-${index} בחדר ${roomCode}`);

      if (room.players.size < 2) {
        console.log(`[MOVE] ⏳ ממתין לשחקן נוסף בחדר ${roomCode}`);
        ws.send(JSON.stringify({ type: "error", message: "ממתינים לשחקן נוסף..." }));
        return;
      }

      if (room.winner) {
        console.log(`[MOVE] 🏁 המשחק כבר נגמר, מנצח: ${room.winner}`);
        return;
      }
      if (!Number.isInteger(index) || index < 0 || index > 8) {
        console.log(`[MOVE] ❌ אינדקס לא חוקי: ${index}`);
        return;
      }
      if (room.board[index]) {
        console.log(`[MOVE] ❌ משבצת ${index} כבר תפוסה ע"י ${room.board[index]}`);
        return;
      }
      if (player.symbol !== room.turn) {
        console.log(`[MOVE] ❌ לא תורו של ${player.symbol}, תור עכשיו: ${room.turn}`);
        return;
      }

      room.board[index] = player.symbol;
      console.log(`[MOVE] ✅ ${player.symbol} סימן ב-${index}`);

      const w = checkWinner(room.board);
      if (w) {
        room.winner = w;
        console.log(`[MOVE] 🏆 ${w === "DRAW" ? "תיקו" : w + " ניצח!"}`);
        
        if (w !== "DRAW") {
          addChatMessage(roomCode, null, `${player.name} (${w}) ניצח! 🏆`, "system");
        } else {
          addChatMessage(roomCode, null, `תיקו! 🤝`, "system");
        }
      } else {
        room.turn = room.turn === "X" ? "O" : "X";
        console.log(`[MOVE] 👉 תור עכשיו: ${room.turn}`);
      }

      broadcast(roomCode, roomState(roomCode));
      return;
    }

    // RESET
    if (msg.type === "reset") {
        const roomCode = String(msg.roomCode || "").trim().toUpperCase();
        const room = rooms.get(roomCode);
        if (!room) {
          console.log(`[RESET] ⚠️ חדר ${roomCode} לא קיים`);
          return;
        }
        if (!room.players.has(ws)) {
          console.log(`[RESET] ⚠️ שחקן לא בחדר ${roomCode}`);
          return;
        }

        const player = room.players.get(ws);
        console.log(`[RESET] 🔄 שחקן ${player.id} מאפס משחק בחדר ${roomCode}`);
        
        room.board = makeEmptyBoard();
        room.winner = null;

        if (room.players.size === 2) {
            for (const p of room.players.values()) {
              const oldSymbol = p.symbol;
              p.symbol = (p.symbol === "X") ? "O" : "X";
              console.log(`[RESET] 🔄 שחקן ${p.id} סימלו משתנה מ-${oldSymbol} ל-${p.symbol}`);
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
      if (!room) {
        console.log(`[CHAT] ⚠️ חדר ${roomCode} לא קיים`);
        return;
      }
      
      const player = room.players.get(ws);
      if (!player) {
        console.log(`[CHAT] ⚠️ שחקן לא בחדר ${roomCode}`);
        return;
      }
      
      const text = String(msg.text || "").trim();
      if (!text) {
        console.log(`[CHAT] ⚠️ הודעה ריקה מ-${player.id}`);
        return;
      }
      
      console.log(`[CHAT] 💬 [${roomCode}] ${player.name}: ${text}`);
      addChatMessage(roomCode, player, text, "user");
      return;
    }
    
    // GET CHAT HISTORY
    if (msg.type === "get_chat") {
      const roomCode = String(msg.roomCode || "").trim().toUpperCase();
      const room = rooms.get(roomCode);
      if (!room) {
        console.log(`[CHAT] ⚠️ בקשת היסטוריה לחדר לא קיים ${roomCode}`);
        return;
      }
      if (!room.players.has(ws)) {
        console.log(`[CHAT] ⚠️ שחקן לא בחדר ${roomCode} מבקש היסטוריה`);
        return;
      }
      
      console.log(`[CHAT] 📜 שולח היסטוריית צ'אט (${room.chat?.length || 0} הודעות) לחדר ${roomCode}`);
      ws.send(JSON.stringify({
        type: "chat_history",
        messages: room.chat || []
      }));
    }
  });

  ws.on("close", () => {
    console.log(`[DISCONNECT] ❌ לקוח ${ws._playerId || 'unknown'} התנתק`);
    cleanupSocket(ws);
  });
  
  ws.on("error", (err) => {
    console.log(`[ERROR] ❌ שגיאה ב-WebSocket: ${err.message}`);
    cleanupSocket(ws);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[BOOT] ✅ X-עיגול שרת איקס רץ על יציאה ${PORT}`);
  console.log(`[BOOT] 🚀 האפליקציה מוכנה!`);
});