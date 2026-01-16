const elBoard = document.getElementById("board");
const elStatus = document.getElementById("status");
const elName = document.getElementById("name");
const elRoom = document.getElementById("room");

const btnCreate = document.getElementById("btnCreate");
const btnJoin = document.getElementById("btnJoin");
const btnCopyLink = document.getElementById("btnCopyLink");
const btnReset = document.getElementById("btnReset");

let ws = null;
let myId = null;
let mySymbol = null;
let roomCode = null;

let state = {
  board: Array(9).fill(""),
  turn: "X",
  winner: null,
  players: []
};

function setStatus(text) {
  elStatus.textContent = text;
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
  // אם נכנסו דרך לינק - אפשר להסתיר את שדה הקוד כדי לא לבלבל
  if (isJoinViaLink()) {
    elRoom.style.display = "none";
    // גם כפתור "התחבר" פחות רלוונטי כי כבר מתחבר אוטומטית
    // אבל נשאיר אותו פעיל למקרה של שינוי שם ואז התחברות מחדש
  }
}

function render() {
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
  btnReset.disabled = !connected || !roomCode;
  btnCopyLink.disabled = !roomCode;
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
  // ✅ כניסה אוטומטית מהלינק: ?room=XXXX
  const params = new URLSearchParams(location.search);
  const linkRoom = (params.get("room") || "").trim().toUpperCase();

  if (linkRoom) {
    elRoom.value = linkRoom;

    // ננסה שם שמור
    let name = (loadName() || "").trim();

    // אם אין שם שמור – נבקש מהמשתמש
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

      // מציג קוד בחדר (למי שנכנס רגיל)
      elRoom.value = roomCode;

      // ✅ מעדכן URL כך שהלינק תמיד כולל room
      updateUrlRoom(roomCode);

      render();
      return;
    }

    if (msg.type === "state") {
        state = msg;

        // ✅ עדכן את הסימן שלך לפי ה-state (חשוב במיוחד אחרי reset שמחליף תפקידים)
        const me = state.players.find(p => p.id === myId);
        if (me) mySymbol = me.symbol;

        render();
        return;
        }


    // msg.type === "info" - אפשר להתעלם או להדפיס לקונסול
    // console.log(msg.message);
  };
}

// --- Events ---
btnCreate.addEventListener("click", () => {
  const name = elName.value.trim();

  if (!name) {
    setStatus("נא להזין שם לפני יצירת משחק");
    elName.focus();
    return;
  }

  createRoom(name);
});


btnJoin.addEventListener("click", () => {
  const name = elName.value.trim() || "שחקן";
  const code = elRoom.value.trim().toUpperCase();
  joinRoom(code, name);
});

btnCopyLink.addEventListener("click", async () => {
  if (!roomCode) return;
  const link = buildShareLink(roomCode);

  try {
    await navigator.clipboard.writeText(link);
    setStatus(`לינק הועתק ✅\n${link}`);
  } catch {
    // fallback אם clipboard חסום
    prompt("העתק את הלינק:", link);
  }
});

btnReset.addEventListener("click", () => {
  if (!ws || ws.readyState !== WebSocket.OPEN || !roomCode) return;
  ws.send(JSON.stringify({ type: "reset", roomCode }));
});

// טען שם אחרון
elName.value = loadName();

// אם יש room בלינק, נשים אותו בשדה (גם אם אחר כך מסתירים אותו)
const params = new URLSearchParams(location.search);
const linkRoom = (params.get("room") || "").trim().toUpperCase();
if (linkRoom) elRoom.value = linkRoom;

applyJoinViaLinkUI();

connect();
render();
