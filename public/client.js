const elBoard = document.getElementById("board");
const elStatus = document.getElementById("status");
const elName = document.getElementById("name");
const elRoom = document.getElementById("room");

const btnCreate = document.getElementById("btnCreate");
const btnJoin = document.getElementById("btnJoin");
const btnCopyLink = document.getElementById("btnCopyLink");
const btnReset = document.getElementById("btnReset");

// אלמנטי צ'אט
const elChatMessages = document.getElementById("chatMessages");
const elChatInput = document.getElementById("chatInput");
const btnSendChat = document.getElementById("btnSendChat");

let ws = null;
let myId = null;
let mySymbol = null;
let roomCode = null;

let state = {
  board: Array(9).fill(""),
  turn: "X",
  winner: null,
  players: [],
  chat: [] // חשוב! לאתחל את הצ'אט
};

// פונקציות צ'אט
function renderChat() {
  if (!elChatMessages) return;
  
  elChatMessages.innerHTML = "";
  
  // וידוא שיש מערך צ'אט
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
  
  // גלילה אוטומטית לתחתית
  elChatMessages.scrollTop = elChatMessages.scrollHeight;
}

function sendChatMessage() {
  if (!elChatInput) return;
  
  const text = elChatInput.value.trim();
  if (!text) return;
  
  if (!ws || ws.readyState !== WebSocket.OPEN || !roomCode) {
    setStatus("לא מחובר לחדר");
    return;
  }
  
  ws.send(JSON.stringify({
    type: "chat",
    roomCode,
    text
  }));
  
  elChatInput.value = "";
  elChatInput.focus();
}

function requestChatHistory() {
  if (!ws || ws.readyState !== WebSocket.OPEN || !roomCode) return;
  
  ws.send(JSON.stringify({
    type: "get_chat",
    roomCode
  }));
}

function setStatus(text) {
  if (elStatus) elStatus.textContent = text;
}

function saveName(name) {
  try { localStorage.setItem("xo_name", name); } catch {}
}
function loadName() {
  try { return localStorage.getItem("xo_name") || ""; } catch { return ""; }
}

function buildShareLink(code) {
  const url = new URL(location.href);
  url.searchParams.set("room", code);
  return url.toString();
}

function updateUrlRoom(code) {
  const url = new URL(location.href);
  url.searchParams.set("room", code);
  history.replaceState(null, "", url.toString());
}

function isJoinViaLink() {
  const params = new URLSearchParams(location.search);
  const linkRoom = (params.get("room") || "").trim();
  return !!linkRoom;
}

function applyJoinViaLinkUI() {
  if (isJoinViaLink() && elRoom) {
    elRoom.style.display = "none";
  }
}

function render() {
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
  
  // עדכון צ'אט
  renderChat();
  
  // הפעלת כפתור שליחת צ'אט
  if (btnSendChat) {
    btnSendChat.disabled = !connected || !roomCode;
  }
  if (elChatInput) {
    elChatInput.disabled = !connected || !roomCode;
  }
}

function joinRoom(code, name) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    setStatus("לא מחובר לשרת…");
    return;
  }
  const cleanCode = String(code || "").trim().toUpperCase();
  if (!cleanCode) {
    setStatus("חסר קוד חדר");
    return;
  }
  const cleanName = String(name || "שחקן").trim().slice(0, 20) || "שחקן";
  saveName(cleanName);

  ws.send(JSON.stringify({ type: "join", roomCode: cleanCode, name: cleanName }));
}

function createRoom(name) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    setStatus("לא מחובר לשרת…");
    return;
  }
  const cleanName = String(name || "שחקן").trim().slice(0, 20) || "שחקן";
  saveName(cleanName);
  ws.send(JSON.stringify({ type: "create_room", name: cleanName }));
}

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.onopen = () => {
    const params = new URLSearchParams(location.search);
    const linkRoom = (params.get("room") || "").trim().toUpperCase();

    if (linkRoom) {
      if (elRoom) elRoom.value = linkRoom;

      let name = (loadName() || "").trim();

      if (!name) {
        name = prompt("מה השם שלך?");
        if (!name) {
          setStatus("לא התחברת — לא הוזן שם");
          return;
        }
        name = name.trim().slice(0, 20);
        saveName(name);
      }

      setStatus(`מתחבר לחדר ${linkRoom}…`);
      joinRoom(linkRoom, name);
    } else {
      setStatus("מחובר לשרת. צור משחק או התחבר לחדר…");
    }
  };

  ws.onclose = () => setStatus("נותק. רענן/נסה שוב.");
  ws.onerror = () => setStatus("שגיאת תקשורת.");

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);

    if (msg.type === "error") {
      setStatus("שגיאה: " + msg.message);
      return;
    }

    if (msg.type === "joined") {
      myId = msg.id;
      mySymbol = msg.symbol;
      roomCode = msg.roomCode;

      if (elRoom) elRoom.value = roomCode;

      updateUrlRoom(roomCode);
      
      // איפוס הצ'אט לפני בקשת היסטוריה
      state.chat = [];
      
      // בקש היסטוריית צ'אט
      setTimeout(() => requestChatHistory(), 200);
      
      render();
      return;
    }

    if (msg.type === "state") {
        state = msg;
        
        // וידוא שיש מערך צ'אט
        if (!state.chat) state.chat = [];

        const me = state.players.find(p => p.id === myId);
        if (me) mySymbol = me.symbol;

        render();
        return;
    }
    
    if (msg.type === "chat") {
        if (!state.chat) state.chat = [];
        
        // מוסיף רק אם זו הודעה חדשה (מניעת כפילויות)
        const exists = state.chat.some(m => m.id === msg.message.id);
        if (!exists) {
            state.chat.push(msg.message);
            
            // שמירה על 50 הודעות אחרונות
            if (state.chat.length > 50) {
                state.chat = state.chat.slice(-50);
            }
        }
        
        renderChat();
        return;
    }
    
    if (msg.type === "chat_history") {
        state.chat = msg.messages || [];
        renderChat();
        return;
    }
  };
}

// אירועים
if (btnCreate) {
  btnCreate.addEventListener("click", () => {
    const name = elName.value.trim();

    if (!name) {
      setStatus("נא להזין שם לפני יצירת משחק");
      elName.focus();
      return;
    }

    createRoom(name);
  });
}

if (btnJoin) {
  btnJoin.addEventListener("click", () => {
    const name = elName.value.trim() || "שחקן";
    const code = elRoom.value.trim().toUpperCase();
    joinRoom(code, name);
  });
}

if (btnCopyLink) {
  btnCopyLink.addEventListener("click", async () => {
    if (!roomCode) return;
    const link = buildShareLink(roomCode);

    try {
      await navigator.clipboard.writeText(link);
      setStatus(`לינק הועתק ✅\n${link}`);
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

// אירועי צ'אט
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

// טען שם אחרון
if (elName) {
  elName.value = loadName();
}

// אם יש room בלינק, נשים אותו בשדה
const params = new URLSearchParams(location.search);
const linkRoom = (params.get("room") || "").trim().toUpperCase();
if (linkRoom && elRoom) elRoom.value = linkRoom;

applyJoinViaLinkUI();

connect();
render();