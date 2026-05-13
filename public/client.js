// @ts-nocheck
// ========== תצורת שרת ==========
const USE_LOCAL_SERVER = false;
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
  const prefixes = ["אורח", "Guest", "שחקן", "Player", "מתמודד", "גיבור"];
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

// ========== ניהול Modal שם ==========
let pendingAction = null; // 'create' or 'join' or 'joinTable'
let pendingTableId = null;
let pendingRoomCode = null;

function showNameModal(action, tableId = null, roomCode = null) {
  pendingAction = action;
  pendingTableId = tableId;
  pendingRoomCode = roomCode;
  
  const modal = document.getElementById("nameModal");
  const input = document.getElementById("playerNameInput");
  const confirmBtn = document.getElementById("nameModalConfirm");
  const randomBtn = document.getElementById("nameModalRandom");
  
  // נקה את השדה
  input.value = "";
  
  // שמור את השם הקיים אם יש
  const savedName = loadName();
  if (savedName) {
    input.value = savedName;
  }
  
  // פוקוס על השדה
  setTimeout(() => input.focus(), 100);
  
  // אירועים חד-פעמיים
  const handleConfirm = () => {
    let playerName = input.value.trim();
    if (!playerName) {
      playerName = generateRandomGuestName();
    }
    saveName(playerName);
    
    // עדכון שדה השם ב-DOM
    if (elName) elName.value = playerName;
    
    // ביצוע הפעולה השמורה
    if (pendingAction === 'create') {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "create_lobby_table",
          name: playerName,
          tableName: pendingTableId || undefined
        }));
      }
    } else if (pendingAction === 'join') {
      if (ws && ws.readyState === WebSocket.OPEN && pendingRoomCode) {
        ws.send(JSON.stringify({ type: "join", roomCode: pendingRoomCode, name: playerName }));
      }
    } else if (pendingAction === 'joinTable') {
      if (ws && ws.readyState === WebSocket.OPEN && pendingTableId) {
        ws.send(JSON.stringify({ type: "join_lobby_table", tableId: pendingTableId, name: playerName }));
      }
    }
    
    modal.style.display = "none";
    cleanupModalListeners();
  };
  
  const handleRandom = () => {
    const randomName = generateRandomGuestName();
    input.value = randomName;
    handleConfirm();
  };
  
  const handleEnter = (e) => {
    if (e.key === "Enter") {
      handleConfirm();
    }
  };
  
  const cleanupModalListeners = () => {
    confirmBtn.removeEventListener("click", handleConfirm);
    randomBtn.removeEventListener("click", handleRandom);
    input.removeEventListener("keypress", handleEnter);
  };
  
  confirmBtn.addEventListener("click", handleConfirm);
  randomBtn.addEventListener("click", handleRandom);
  input.addEventListener("keypress", handleEnter);
  
  modal.style.display = "flex";
}

function hideNameModal() {
  const modal = document.getElementById("nameModal");
  if (modal) modal.style.display = "none";
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

const lobbyOpenView = document.getElementById("lobbyOpenView");
const lobbyFullView = document.getElementById("lobbyFullView");
const openTablesCount = document.getElementById("openTablesCount");
const fullTablesCount = document.getElementById("fullTablesCount");
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
let reconnectTimer = null;
let manualLeave = false;

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

function saveSession() {
  try {
    if (roomCode && myId) {
      localStorage.setItem("xo_roomCode", roomCode);
      localStorage.setItem("xo_playerId", myId);
      if (mySymbol) localStorage.setItem("xo_symbol", mySymbol);
      if (currentLobbyTableId) localStorage.setItem("xo_lobbyTableId", currentLobbyTableId);
    }
  } catch { }
}

function loadSession() {
  try {
    return {
      roomCode: localStorage.getItem("xo_roomCode") || "",
      playerId: localStorage.getItem("xo_playerId") || "",
      symbol: localStorage.getItem("xo_symbol") || "",
      lobbyTableId: localStorage.getItem("xo_lobbyTableId") || ""
    };
  } catch {
    return { roomCode: "", playerId: "", symbol: "", lobbyTableId: "" };
  }
}

function clearSession() {
  try {
    localStorage.removeItem("xo_roomCode");
    localStorage.removeItem("xo_playerId");
    localStorage.removeItem("xo_symbol");
    localStorage.removeItem("xo_lobbyTableId");
  } catch { }
}


function showGameView() {
  if (lobbySection) lobbySection.style.display = "none";
  if (gameSection) gameSection.style.display = "block";
  if (backToLobbyBtn) backToLobbyBtn.style.display = "inline-flex";
  if (backToGameBtn) backToGameBtn.style.display = "none";
}

function showLobbyView() {
  if (lobbySection) lobbySection.style.display = "block";
  if (gameSection) gameSection.style.display = "none";
  if (backToLobbyBtn) backToLobbyBtn.style.display = "none";
  if (backToGameBtn && currentLobbyTableId) backToGameBtn.style.display = "inline-flex";
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
  const openView = lobbyOpenView;
  const fullView = lobbyFullView;
  if (!openView) return;

  const openTables = lobbyTables.filter(table => Number(table.playersCount || 0) < Number(table.maxPlayers || 2));
  const fullTables = lobbyTables.filter(table => Number(table.playersCount || 0) >= Number(table.maxPlayers || 2));

  if (openTablesCount) openTablesCount.textContent = String(openTables.length);
  if (fullTablesCount) fullTablesCount.textContent = String(fullTables.length);

  function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/[&<>]/g, function(m) {
      if (m === "&") return "&amp;";
      if (m === "<") return "&lt;";
      if (m === ">") return "&gt;";
      return m;
    });
  }

  function tableCard(table, isFull) {
    const players = Array.isArray(table.players) && table.players.length
      ? table.players.map(p => `${escapeHtml(p.name || "שחקן")} (${escapeHtml(p.symbol || "")})`).join(" • ")
      : escapeHtml(table.hostName || "?");

    return `
      <div class="lobby-table ${isFull ? 'full-table' : ''}" data-table-id="${escapeHtml(table.id)}">
        <div class="table-name">🎲 ${escapeHtml(table.name || "שולחן")}</div>
        <div class="table-info">
          <span>👥 ${table.playersCount}/${table.maxPlayers}</span>
          <span class="status-badge ${isFull ? 'status-playing' : 'status-waiting'}">
            ${isFull ? '🔴 מלא' : '🟢 פתוח'}
          </span>
          ${table.roomCode ? `<span class="table-room-code">🔑 ${escapeHtml(table.roomCode)}</span>` : ''}
        </div>
        <div class="table-players">👑 ${players}</div>
        <button class="join-table-btn" data-id="${escapeHtml(table.id)}" ${isFull ? 'disabled' : ''}>
          ${isFull ? '❌ מלא' : '➕ הצטרף'}
        </button>
      </div>
    `;
  }

  openView.innerHTML = openTables.length
    ? openTables.map(table => tableCard(table, false)).join("")
    : '<div class="empty-lobby">✨ אין שולחנות פתוחים<br>צור שולחן חדש!</div>';

  if (fullView) {
    fullView.innerHTML = fullTables.length
      ? fullTables.map(table => tableCard(table, true)).join("")
      : '<div class="empty-lobby">🎮 אין שולחנות במשחק</div>';
  }

  document.querySelectorAll(".join-table-btn:not(:disabled)").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const tableId = btn.getAttribute("data-id");
      // הצגת Modal לבקשת שם לפני ההצטרפות
      showNameModal('joinTable', tableId);
    });
  });
}

// ========== Chat ==========
function renderChat() {
  if (!elChatMessages) return;
  elChatMessages.innerHTML = "";
  const messages = state.chat || [];

  if (messages.length === 0) {
    const emptyDiv = document.createElement("div");
    emptyDiv.className = "chat-message system";
    emptyDiv.textContent = "💬 אין הודעות";
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
}

// ========== Game Rendering ==========
function renderGame() {
  if (!elBoard) return;
  elBoard.innerHTML = "";
  const waiting = state.players.filter(p => p.connected !== false).length < 2;

  for (let i = 0; i < 9; i++) {
    const div = document.createElement("div");
    div.className = "cell";
    div.textContent = state.board[i] || "";
if (state.board[i] === "X" || state.board[i] === "O") {
  div.setAttribute("data-value", state.board[i]);
    }
    
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
    .map(p => `${p.name} (${p.symbol})${p.connected === false ? " 🔌 מנותק" : ""}${p.id === myId ? " 👈 אתה" : ""}`)
    .join(" | ");

  let statusText = playersText || "לא מחובר";
  if (waiting && roomCode) statusText += " — ⏳ ממתין ליריב...";
  
  if (state.winner === "DRAW") statusText += "\n🤝 תיקו!";
  else if (state.winner) statusText += `\n🏆 ${state.winner} ניצח!`;
  else statusText += `\n🎯 תור: ${state.turn} ${state.turn === mySymbol ? "(שלך!)" : ""}`;
  
  if (roomCode) statusText += `\n🔑 חדר: ${roomCode}`;

  setStatus(statusText);

  const connected = ws && ws.readyState === WebSocket.OPEN;
  if (btnReset) btnReset.disabled = !connected || !roomCode;
  if (btnCopyLink) btnCopyLink.disabled = !roomCode;
  if (btnSendChat) btnSendChat.disabled = !connected || !roomCode;
  if (elChatInput) elChatInput.disabled = !connected || !roomCode;

  renderChat();
}

// ========== WebSocket ==========
function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  if (ws) {
    try { ws.close(); } catch (e) { }
    ws = null;
  }

  const wsUrl = getWebSocketUrl();
  console.log(`[CONNECT] מתחבר ל: ${wsUrl}`);
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log("[CONNECT] מחובר!");
    setStatus("✅ מחובר לשרת");
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    ws.send(JSON.stringify({ type: "subscribe_lobby" }));

    const savedName = loadName();
    if (savedName && elName) elName.value = savedName;

    const saved = loadSession();
    const params = new URLSearchParams(location.search);
    const linkTable = params.get("table");
    const linkRoom = params.get("room");

    // אם יש משחק שמור בדפדפן - קודם מנסים לשחזר אותו אוטומטית
    if (saved.roomCode && saved.playerId) {
      myId = saved.playerId;
      mySymbol = saved.symbol || mySymbol;
      roomCode = saved.roomCode;
      currentLobbyTableId = saved.lobbyTableId || currentLobbyTableId;
      ws.send(JSON.stringify({
        type: "rejoin",
        roomCode: saved.roomCode,
        playerId: saved.playerId,
        name: savedName || "אורח"
      }));
      return;
    }

    // בדיקת קישור ישיר
    if (linkTable) {
      showNameModal('joinTable', linkTable);
    } else if (linkRoom) {
      showNameModal('join', null, linkRoom);
    } else {
      showLobbyView();
    }
  };

  ws.onclose = () => {
    console.log("[CLOSE] נותק");
    if (manualLeave) return;
    setStatus("🔄 נותק מהשרת - מנסה להתחבר מחדש...");
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, 1200);
    }
  };

  ws.onerror = (e) => {
    console.error("[ERROR]", e);
    setStatus("❌ שגיאת תקשורת");
  };

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);

    if (msg.type === "rejoin_failed") {
      console.log("[REJOIN_FAILED]", msg.message);
      clearSession();
      myId = null;
      mySymbol = null;
      roomCode = null;
      currentLobbyTableId = null;
      showLobbyView();
      setStatus("⚠️ לא נמצא משחק לשחזור - חזרת ללובי");
      return;
    }

    if (msg.type === "error") {
      setStatus("⚠️ " + msg.message);
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
      saveSession();
      
      console.log(`[JOINED] חדר ${roomCode}, סמל ${mySymbol}${msg.restored ? " (שוחזר)" : ""}`);
      
      if (elRoom) elRoom.value = roomCode;
      updateUrl(msg.lobbyTableId);
      showGameView();
      
      setTimeout(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "get_state", roomCode }));
          ws.send(JSON.stringify({ type: "get_chat", roomCode }));
        }
      }, 200);
      return;
    }

    if (msg.type === "state") {
      console.log("[STATE] התקבל מצב:", msg.players.length, "שחקנים");
      state = msg;
      if (!state.chat) state.chat = [];
      
      const me = state.players.find(p => p.id === myId);
      if (me) mySymbol = me.symbol;
      
      renderGame();
      return;
    }

    if (msg.type === "chat") {
      if (!state.chat) state.chat = [];
      if (!state.chat.some(m => m.id === msg.message.id)) {
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
      clearSession();
      roomCode = null;
      currentLobbyTableId = null;
      state = { board: Array(9).fill(""), turn: "X", winner: null, players: [], chat: [] };
      showLobbyView();
      renderGame();
      return;
    }
  };
}

// ========== Event Listeners ==========
if (btnCreate) {
  btnCreate.addEventListener("click", () => {
    showNameModal('create');
  });
}

if (createTableBtn) {
  createTableBtn.addEventListener("click", () => {
    showNameModal('create');
  });
}

if (modalCreateConfirm) {
  modalCreateConfirm.addEventListener("click", () => {
    const tableName = modalTableName?.value.trim() || "";
    // כאן נשתמש ב-modal שם במקום לשלוח ישירות
    showNameModal('create', tableName);
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
    const code = elRoom.value.trim().toUpperCase();
    if (!code) {
      setStatus("⚠️ נא להזין קוד חדר");
      return;
    }
    showNameModal('join', null, code);
  });
}

if (btnCopyLink) {
  btnCopyLink.addEventListener("click", async () => {
    if (!roomCode) return;
    const url = new URL(location.href);
    url.searchParams.set("room", roomCode);
    try {
      await navigator.clipboard.writeText(url.toString());
      setStatus("✅ הלינק הועתק!");
    } catch {
      prompt("העתק את הלינק:", url.toString());
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
    if (e.key === "Enter") sendChatMessage();
  });
}

if (backToLobbyBtn) {
  backToLobbyBtn.addEventListener("click", () => {
    if (ws && ws.readyState === WebSocket.OPEN && roomCode) {
      clearSession();
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
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "get_state", roomCode }));
      }
    }
  });
}

window.addEventListener("click", (e) => {
  if (createTableModal && e.target === createTableModal) {
    createTableModal.style.display = "none";
  }
});

// ========== התחלה ==========
connect();