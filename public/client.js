// @ts-nocheck
// ========== תצורת שרת ==========
const USE_LOCAL_SERVER = false;  // 👈 תשנה ל- false כשרוצה לעלות ל-Railway
const LOCAL_WS_URL = "ws://localhost:3000";

function getWebSocketUrl() {
  if (USE_LOCAL_SERVER) {
    return LOCAL_WS_URL;
  }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}`;
}

// ========== פונקציות עזר לשמות ==========
function generateRandomGuestName() {
  const prefixes = ["אורח", "Guest", "שחקן", "Player"];
  const randomPrefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const randomNum = Math.floor(Math.random() * 1000);
  return `${randomPrefix}${randomNum}`;
}

function getValidPlayerName(inputName) {
  const name = String(inputName || "").trim();
  if (name.length > 0) {
    return name.slice(0, 20);
  }
  return generateRandomGuestName();
}

// ========== DOM Elements ==========
const elBoard = document.getElementById("board");
const elStatus = document.getElementById("status");
const elName = document.getElementById("name");
const elRoom = document.getElementById("room");
const btnCreate = document.getElementById("btnCreate");
const btnJoin = document.getElementById("btnJoin");
const btnCopyLink = document.getElementById("btnCopyLink");
const btnReset = document.getElementById("btnReset");
const elChatMessages = document.getElementById("chatMessages");
const elChatInput = document.getElementById("chatInput");
const btnSendChat = document.getElementById("btnSendChat");

const lobbyView = document.getElementById("lobbyView");
const createTableBtn = document.getElementById("createTableBtn");
const createTableModal = document.getElementById("createTableModal");
const modalTableName = document.getElementById("modalTableName");
const modalCreateConfirm = document.getElementById("modalCreateConfirm");
const modalCancel = document.getElementById("modalCancel");
const backToGameBtn = document.getElementById("backToGameBtn");
const backToLobbyBtn = document.getElementById("backToLobbyBtn");
const lobbySection = document.getElementById("lobbySection");
const gameSection = document.getElementById("gameSection");

// ========== State ==========
let ws = null;
let myId = null;
let mySymbol = null;
let roomCode = null;
let currentLobbyTableId = null;
let lobbyTables = [];

let state = {
  board: Array(9).fill(""),
  turn: "X",
  winner: null,
  players: [],
  chat: []
};

// ========== UI Helpers ==========
function setStatus(text) {
  if (elStatus) elStatus.textContent = text;
}

function saveName(name) {
  try { localStorage.setItem("xo_name", name); } catch { }
}
function loadName() {
  try { return localStorage.getItem("xo_name") || ""; } catch { return ""; }
}

function showGameView() {
  if (lobbySection) lobbySection.style.display = "none";
  if (gameSection) gameSection.style.display = "block";
  if (backToLobbyBtn) backToLobbyBtn.style.display = "inline-block";
  if (backToGameBtn) backToGameBtn.style.display = "none";
}

function showLobbyView() {
  if (lobbySection) lobbySection.style.display = "block";
  if (gameSection) gameSection.style.display = "none";
  if (backToLobbyBtn) backToLobbyBtn.style.display = "none";
  if (backToGameBtn && currentLobbyTableId) backToGameBtn.style.display = "inline-block";
}

function buildShareLink(roomCode, tableId) {
  const url = new URL(location.href);
  if (tableId) url.searchParams.set("table", tableId);
  else if (roomCode) url.searchParams.set("room", roomCode);
  return url.toString();
}

function updateUrl(tableId) {
  const url = new URL(location.href);
  if (tableId) {
    url.searchParams.set("table", tableId);
    url.searchParams.delete("room");
  } else if (roomCode) {
    url.searchParams.set("room", roomCode);
    url.searchParams.delete("table");
  }
  history.replaceState(null, "", url.toString());
}

// ========== Lobby Rendering ==========
function renderLobby() {
  if (!lobbyView) return;

  if (lobbyTables.length === 0) {
    lobbyView.innerHTML = '<div class="empty-lobby">✨ אין שולחנות פעילים. צור שולחן חדש!</div>';
    return;
  }

  lobbyView.innerHTML = lobbyTables.map(table => `
    <div class="lobby-table" data-table-id="${table.id}">
      <div class="table-name">🎲 ${escapeHtml(table.name)}</div>
      <div class="table-info">
        <span>👥 ${table.playersCount}/${table.maxPlayers}</span>
        <span class="status-badge ${table.status === 'waiting' ? 'status-waiting' : 'status-playing'}">
          ${table.status === 'waiting' ? '🟢 ממתין' : '🔴 במשחק'}
        </span>
        <span>👑 ${escapeHtml(table.hostName)}</span>
      </div>
      <button class="join-table-btn" data-id="${table.id}" ${table.playersCount >= table.maxPlayers ? 'disabled' : ''}>
        ${table.playersCount >= table.maxPlayers ? 'מלא' : '➕ הצטרף'}
      </button>
    </div>
  `).join("");

  document.querySelectorAll(".join-table-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const tableId = btn.getAttribute("data-id");
      const rawName = elName.value.trim();
      const playerName = getValidPlayerName(rawName);
      
      if (!rawName) {
        elName.value = playerName;
        saveName(playerName);
      }
      
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "join_lobby_table", tableId, name: playerName }));
      }
    });
  });
}

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/[&<>]/g, function(m) {
    if (m === "&") return "&amp;";
    if (m === "<") return "&lt;";
    if (m === ">") return "&gt;";
    return m;
  });
}

// ========== Chat Functions ==========
function renderChat() {
  if (!elChatMessages) return;
  elChatMessages.innerHTML = "";
  const messages = state.chat || [];

  if (messages.length === 0) {
    const emptyDiv = document.createElement("div");
    emptyDiv.className = "chat-message system";
    emptyDiv.textContent = "💬 אין הודעות. התחל לדבר!";
    elChatMessages.appendChild(emptyDiv);
    return;
  }

  messages.forEach(msg => {
    const div = document.createElement("div");
    div.className = `chat-message ${msg.type || "user"}`;
    const time = new Date(msg.timestamp).toLocaleTimeString("he-IL", {
      hour: "2-digit",
      minute: "2-digit"
    });

    if (msg.type === "system") {
      div.textContent = msg.text;
    } else {
      const headerSpan = document.createElement("span");
      headerSpan.className = "sender";
      headerSpan.textContent = `${msg.sender?.name || "שחקן"} • ${time}`;
      const textDiv = document.createElement("div");
      textDiv.className = "text";
      textDiv.textContent = msg.text;
      div.appendChild(headerSpan);
      div.appendChild(textDiv);
    }
    elChatMessages.appendChild(div);
  });
  elChatMessages.scrollTop = elChatMessages.scrollHeight;
}

function sendChatMessage() {
  const text = elChatInput?.value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN || !roomCode) return;
  ws.send(JSON.stringify({ type: "chat", roomCode, text }));
  elChatInput.value = "";
  elChatInput.focus();
}

function requestChatHistory() {
  if (!ws || ws.readyState !== WebSocket.OPEN || !roomCode) return;
  ws.send(JSON.stringify({ type: "get_chat", roomCode }));
}

// ========== Game Rendering ==========
function renderGame() {
  if (!elBoard) return;
  elBoard.innerHTML = "";
  const waiting = state.players.length < 2;

  for (let i = 0; i < 9; i++) {
    const div = document.createElement("div");
    div.className = "cell";
    div.textContent = state.board[i] || "";
    const myTurn = (mySymbol && state.turn === mySymbol);
    const disabled = waiting || state.winner || state.board[i] || !myTurn;
    if (disabled) div.classList.add("disabled");

    div.addEventListener("click", () => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (disabled) return;
      ws.send(JSON.stringify({ type: "move", roomCode, index: i }));
    });
    elBoard.appendChild(div);
  }

  const playersText = state.players
    .map(p => `${p.name} (${p.symbol})${p.id === myId ? " - אתה" : ""}`)
    .join(" | ");

  let headline = playersText || "לא מחובר";
  if (waiting && roomCode) headline += " — ממתינים לשחקן נוסף…";

  let gameLine = "";
  if (state.winner === "DRAW") gameLine = "תיקו 🤝";
  else if (state.winner === "X" || state.winner === "O") gameLine = `ניצחון: ${state.winner} 🏆`;
  else gameLine = `תור: ${state.turn} ${state.turn === mySymbol ? "(שלך)" : ""}`;

  let linkLine = "";
  if (roomCode) linkLine = `חדר: ${roomCode}`;

  setStatus([headline, gameLine, linkLine].filter(Boolean).join("\n"));

  const connected = ws && ws.readyState === WebSocket.OPEN;
  if (btnReset) btnReset.disabled = !connected || !roomCode;
  if (btnCopyLink) btnCopyLink.disabled = !roomCode;
  if (btnSendChat) btnSendChat.disabled = !connected || !roomCode;
  if (elChatInput) elChatInput.disabled = !connected || !roomCode;

  renderChat();
}

// ========== WebSocket Connection ==========
function connect(callback) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    if (callback) callback();
    return;
  }
  if (ws) {
    try { ws.close(); } catch (e) { }
    ws = null;
  }

  const wsUrl = getWebSocketUrl();
  console.log(`[CONNECT] 🌐 מתחבר לשרת: ${wsUrl}`);
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    setStatus("מחובר לשרת");
    ws.send(JSON.stringify({ type: "subscribe_lobby" }));

    if (callback) {
      callback();
      return;
    }

    const params = new URLSearchParams(location.search);
    const linkTable = params.get("table");
    const linkRoom = params.get("room");

    if (linkTable) {
      const rawName = loadName() || "";
      let playerName = getValidPlayerName(rawName);
      if (!rawName) {
        playerName = generateRandomGuestName();
        saveName(playerName);
        if (elName) elName.value = playerName;
      } else {
        if (elName) elName.value = rawName;
      }
      ws.send(JSON.stringify({ type: "join_lobby_table", tableId: linkTable, name: playerName }));
    } else if (linkRoom) {
      if (elRoom) elRoom.value = linkRoom;
      const rawName = loadName() || "";
      let playerName = getValidPlayerName(rawName);
      if (!rawName) {
        playerName = generateRandomGuestName();
        saveName(playerName);
        if (elName) elName.value = playerName;
      } else {
        if (elName) elName.value = rawName;
      }
      ws.send(JSON.stringify({ type: "join", roomCode: linkRoom, name: playerName }));
    } else {
      setStatus("מחובר לשרת. צור שולחן או הצטרף ללובי");
      showLobbyView();
      // טעינת שם שמור לשדה
      const savedName = loadName();
      if (savedName && elName) elName.value = savedName;
    }
  };

  ws.onclose = () => {
    setStatus("❌ נותק מהשרת. רענן/נסה שוב.");
  };

  ws.onerror = (e) => {
    console.error("WebSocket error:", e);
    setStatus("שגיאת תקשורת עם השרת");
  };

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);

    if (msg.type === "error") {
      setStatus("⚠️ שגיאה: " + msg.message);
      return;
    }

    if (msg.type === "lobby_update") {
      lobbyTables = msg.tables;
      renderLobby();
      return;
    }

    if (msg.type === "joined") {
      myId = msg.id;
      mySymbol = msg.symbol;
      roomCode = msg.roomCode;
      currentLobbyTableId = msg.lobbyTableId;
      if (elRoom) elRoom.value = roomCode;
      updateUrl(msg.lobbyTableId);
      state.chat = [];
      showGameView();
      setTimeout(() => requestChatHistory(), 200);
      renderGame();
      return;
    }

    if (msg.type === "state") {
      state = msg;
      if (!state.chat) state.chat = [];
      const me = state.players.find(p => p.id === myId);
      if (me) mySymbol = me.symbol;
      renderGame();
      return;
    }

    if (msg.type === "chat") {
      if (!state.chat) state.chat = [];
      const exists = state.chat.some(m => m.id === msg.message.id);
      if (!exists) {
        state.chat.push(msg.message);
        if (state.chat.length > 50) state.chat = state.chat.slice(-50);
      }
      renderChat();
      return;
    }

    if (msg.type === "chat_history") {
      state.chat = msg.messages || [];
      renderChat();
      return;
    }

    if (msg.type === "left_table") {
      currentLobbyTableId = null;
      roomCode = null;
      state = { board: Array(9).fill(""), turn: "X", winner: null, players: [], chat: [] };
      showLobbyView();
      renderGame();
      renderLobby();
      return;
    }
  };
}

// ========== Event Listeners ==========
if (btnCreate) {
  btnCreate.addEventListener("click", () => {
    const rawName = elName.value.trim();
    const playerName = getValidPlayerName(rawName);
    
    if (!rawName) {
      elName.value = playerName;
      saveName(playerName);
    }
    
    if (createTableModal) createTableModal.style.display = "flex";
  });
}

if (createTableBtn) {
  createTableBtn.addEventListener("click", () => {
    const rawName = elName.value.trim();
    const playerName = getValidPlayerName(rawName);
    
    if (!rawName) {
      elName.value = playerName;
      saveName(playerName);
    }
    
    if (createTableModal) createTableModal.style.display = "flex";
  });
}

if (modalCreateConfirm) {
  modalCreateConfirm.addEventListener("click", () => {
    const tableName = modalTableName?.value.trim() || "";
    const rawPlayerName = elName.value.trim();
    const playerName = getValidPlayerName(rawPlayerName);
    
    if (!rawPlayerName) {
      elName.value = playerName;
      saveName(playerName);
    }
    
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "create_lobby_table",
        name: playerName,
        tableName: tableName || undefined
      }));
    }
    if (createTableModal) createTableModal.style.display = "none";
    if (modalTableName) modalTableName.value = "";
  });
}

if (modalCancel) {
  modalCancel.addEventListener("click", () => {
    if (createTableModal) createTableModal.style.display = "none";
  });
}

if (btnJoin) {
  btnJoin.addEventListener("click", () => {
    const rawName = elName.value.trim();
    const playerName = getValidPlayerName(rawName);
    const code = elRoom.value.trim().toUpperCase();
    
    if (!rawName) {
      elName.value = playerName;
      saveName(playerName);
    }
    
    if (!code) {
      setStatus("נא להזין קוד חדר");
      return;
    }
    
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "join", roomCode: code, name: playerName }));
    }
  });
}

if (btnCopyLink) {
  btnCopyLink.addEventListener("click", async () => {
    if (!roomCode && !currentLobbyTableId) return;
    const link = buildShareLink(roomCode, currentLobbyTableId);
    try {
      await navigator.clipboard.writeText(link);
      setStatus(`✅ לינק הועתק\n${link}`);
    } catch {
      prompt("העתק את הלינק:", link);
    }
  });
}

if (btnReset) {
  btnReset.addEventListener("click", () => {
    if (!ws || ws.readyState !== WebSocket.OPEN || !roomCode) return;
    ws.send(JSON.stringify({ type: "reset", roomCode }));
  });
}

if (btnSendChat) {
  btnSendChat.addEventListener("click", sendChatMessage);
}
if (elChatInput) {
  elChatInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendChatMessage();
    }
  });
}

if (backToLobbyBtn) {
  backToLobbyBtn.addEventListener("click", () => {
    if (ws && ws.readyState === WebSocket.OPEN && roomCode) {
      ws.send(JSON.stringify({ type: "leave_table" }));
    } else {
      showLobbyView();
    }
  });
}

if (backToGameBtn) {
  backToGameBtn.addEventListener("click", () => {
    if (roomCode) {
      showGameView();
    } else {
      setStatus("לא נמצא משחק פעיל");
    }
  });
}

// ========== התחלה ==========
if (elName) {
  const savedName = loadName();
  if (savedName) elName.value = savedName;
}

connect();