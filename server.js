const express = require("express");

const app = express();
app.use(express.json());

// 20x20 moon grid; true means full moon (🌝), false means dark moon (🌚).
const SIZE = 20;
const TOGGLE_LIMIT = 10;
const LOG_LIMIT = 200;
const grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(true));

// Per-agent toggle counts to enforce the 10-toggle cap.
const toggleCounts = {};

// Rolling log of latest toggle events.
const log = [];

const toBool = (value) => (value ? 1 : 0);

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// Returns full grid state and remaining toggles per known agent.
app.get("/state", (req, res) => {
  const remainingByAgent = {};
  Object.keys(toggleCounts).forEach((agent) => {
    remainingByAgent[agent] = Math.max(0, TOGGLE_LIMIT - toggleCounts[agent]);
  });

  res.json({
    ok: true,
    grid: grid.map((row) => row.map(toBool)),
    remainingByAgent,
  });
});

// Toggles a single cell for an agent with per-agent rate limiting.
app.post("/toggle", (req, res) => {
  const { agent, x, y } = req.body || {};

  if (typeof agent !== "string" || !agent.trim()) {
    return res.status(400).json({ ok: false, error: "invalid agent" });
  }

  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    x >= SIZE ||
    y < 0 ||
    y >= SIZE
  ) {
    return res.status(400).json({ ok: false, error: "invalid coordinates" });
  }

  const agentName = agent.trim();
  const currentCount = toggleCounts[agentName] || 0;

  if (currentCount >= TOGGLE_LIMIT) {
    return res.status(429).json({ ok: false, error: "limit reached" });
  }

  grid[y][x] = !grid[y][x];
  const newValue = grid[y][x];

  toggleCounts[agentName] = currentCount + 1;
  const remaining = Math.max(0, TOGGLE_LIMIT - toggleCounts[agentName]);

  log.unshift({
    timestamp: new Date().toISOString(),
    agent: agentName,
    x,
    y,
    newValue,
  });

  if (log.length > LOG_LIMIT) log.length = LOG_LIMIT;

  return res.json({
    ok: true,
    cell: { x, y, value: newValue },
    remaining,
  });
});

// Returns the newest 200 toggle events first.
app.get("/log", (req, res) => {
  res.json({ ok: true, log });
});

app.get("/", (req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>Moon Grid Playground</title>
  <script src="https://unpkg.com/@panzoom/panzoom/dist/panzoom.min.js"></script>
  <style>
    :root {
      color-scheme: light;
      --bg: #f3f5f8;
      --card: rgba(255, 255, 255, 0.86);
      --card-solid: #ffffff;
      --line: #d9e0ea;
      --text: #111827;
      --muted: #64748b;
      --accent-soft: #dbeafe;
      --success: #16a34a;
      --shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
      --radius: 16px;
      --cell-size: 22px;
      --cell-gap: 4px;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: var(--text);
      background: radial-gradient(circle at top right, #e5edf8 0%, var(--bg) 48%, #eef2f7 100%);
      min-height: 100vh;
      padding: 14px;
    }

    .app { max-width: 1200px; margin: 0 auto; display: grid; gap: 12px; }

    .header, .controls, .panel, .sidebar {
      background: var(--card);
      backdrop-filter: blur(8px);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
    }

    .header {
      padding: 14px 16px;
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
    }

    .header h1 { margin: 0; font-size: 1.2rem; letter-spacing: 0.01em; }
    .header p { margin: 3px 0 0; color: var(--muted); font-size: 0.9rem; }

    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border: 1px solid var(--line);
      padding: 6px 10px;
      border-radius: 999px;
      background: var(--card-solid);
      font-size: 0.84rem;
      color: var(--muted);
      font-weight: 600;
    }

    .dot { width: 9px; height: 9px; border-radius: 50%; background: #f59e0b; box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.2); }
    .status.ok .dot { background: var(--success); box-shadow: 0 0 0 2px rgba(22, 163, 74, 0.2); }

    .controls {
      padding: 10px 12px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }

    .controls label { font-size: 0.82rem; color: var(--muted); font-weight: 600; }

    .controls input, .controls select, .controls button {
      height: 36px;
      border-radius: 10px;
      border: 1px solid var(--line);
      background: var(--card-solid);
      color: var(--text);
      padding: 0 10px;
      font-size: 0.9rem;
    }

    .controls button { cursor: pointer; font-weight: 600; transition: transform .15s ease, border-color .15s ease; }
    .controls button:hover { border-color: #b8c5d8; transform: translateY(-1px); }

    .pill {
      margin-left: auto;
      background: var(--accent-soft);
      color: #1e40af;
      border: 1px solid #bfdbfe;
      border-radius: 999px;
      padding: 7px 12px;
      font-size: 0.84rem;
      font-weight: 700;
      white-space: nowrap;
    }

    .layout { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 12px; align-items: start; }

    .panel { padding: 10px; }
    .viewport {
      position: relative;
      overflow: hidden;
      border-radius: 12px;
      border: 1px solid var(--line);
      background: linear-gradient(180deg, #fcfdff, #f8fafc);
      height: min(62vh, 700px);
      touch-action: none;
      cursor: grab;
      display: grid;
      place-items: center;
    }
    .viewport.dragging { cursor: grabbing; }

    #board {
      display: grid;
      grid-template-columns: repeat(20, var(--cell-size));
      gap: var(--cell-gap);
      width: max-content;
      user-select: none;
      transform-origin: top left;
      padding: 8px;
    }

    .cell {
      width: var(--cell-size);
      height: var(--cell-size);
      border-radius: 10px;
      border: 1px solid #edf2f7;
      background: #ffffff;
      display: grid;
      place-items: center;
      font-size: 18px;
      line-height: 1;
      transition: transform .12s ease, background-color .12s ease, border-color .12s ease, opacity .18s ease;
      -webkit-tap-highlight-color: rgba(59,130,246,0.25);
    }
    .cell:hover { background: #eff6ff; border-color: #bfdbfe; }
    .cell:active { transform: scale(0.95); }
    .cell.flash { animation: pulse .25s ease; }
    @keyframes pulse { 0% { transform: scale(0.9); opacity: .6; } 100% { transform: scale(1); opacity: 1; } }

    .sidebar {
      overflow: hidden;
      display: grid;
      grid-template-rows: auto 1fr;
      max-height: min(74vh, 820px);
    }

    .sidebar-head {
      position: sticky;
      top: 0;
      z-index: 2;
      background: var(--card-solid);
      border-bottom: 1px solid var(--line);
      padding: 11px 12px;
      display: grid;
      gap: 8px;
    }

    .sidebar-title { display: flex; justify-content: space-between; align-items: center; font-weight: 700; }
    .feed { overflow: auto; padding: 10px; display: grid; gap: 8px; align-content: start; }

    .event {
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--card-solid);
      padding: 8px;
      display: grid;
      gap: 5px;
      font-size: 0.84rem;
    }

    .meta { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; color: var(--muted); }
    .agent { background: #eef2ff; color: #3730a3; border: 1px solid #c7d2fe; border-radius: 999px; padding: 2px 8px; font-size: 0.74rem; font-weight: 700; }
    .coords { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.8rem; color: #334155; }

    .mobile-log-toggle { display: none; }
    .empty { text-align: center; color: var(--muted); font-size: 0.86rem; padding: 14px 6px; }

    @media (max-width: 980px) {
      .layout { grid-template-columns: 1fr; }
      .sidebar { max-height: none; }
      .pill { margin-left: 0; }
    }

    @media (max-width: 720px) {
      :root { --cell-size: 20px; --cell-gap: 3px; }
      body { padding: 10px; }
      .controls input { min-width: 120px; flex: 1; }
      .controls button { flex: 1; min-width: 120px; }
      .mobile-log-toggle { display: inline-flex; align-items: center; justify-content: center; padding: 6px 10px; border-radius: 10px; border: 1px solid var(--line); background: var(--card-solid); cursor: pointer; font-weight: 600; }
      .sidebar.collapsed .feed { display: none; }
      .sidebar.collapsed { grid-template-rows: auto; }
    }
  </style>
</head>
<body>
  <div class="app">
    <header class="header">
      <div>
        <h1>Moon Grid Playground</h1>
        <p>Shared 20×20 lunar matrix — tap cells to toggle and watch the live activity feed.</p>
      </div>
      <div id="status" class="status"><span class="dot"></span><span>Checking…</span></div>
    </header>

    <section class="controls">
      <label for="agent">Agent</label>
      <input id="agent" value="human" placeholder="Agent name" />
      <button id="resetBtn" type="button">Reset view</button>
      <div id="remaining" class="pill">Remaining: 10</div>
    </section>

    <main class="layout">
      <section class="panel">
        <div id="viewport" class="viewport">
          <div id="board" aria-label="Moon grid"></div>
        </div>
      </section>

      <aside id="sidebar" class="sidebar">
        <div class="sidebar-head">
          <div class="sidebar-title">
            <span>Activity feed</span>
            <button id="toggleLog" class="mobile-log-toggle" type="button">Hide</button>
          </div>
          <label for="logFilter" style="font-size:12px;color:var(--muted);font-weight:600;">Filter by agent</label>
          <select id="logFilter"><option value="all">All agents</option></select>
        </div>
        <div id="feed" class="feed"></div>
      </aside>
    </main>
  </div>

  <script>
    const size = 20;
    const board = document.getElementById("board");
    const viewport = document.getElementById("viewport");
    const feed = document.getElementById("feed");
    const statusEl = document.getElementById("status");
    const agentInput = document.getElementById("agent");
    const remainingEl = document.getElementById("remaining");
    const logFilterEl = document.getElementById("logFilter");
    const sidebarEl = document.getElementById("sidebar");
    const toggleLogBtn = document.getElementById("toggleLog");
    const cells = [];
    const remainingByAgent = {};
    let lastLog = [];
    let panzoom;

    function currentAgent() {
      const name = (agentInput.value || "human").trim();
      return name || "human";
    }

    function updateStatus(ok) {
      statusEl.classList.toggle("ok", !!ok);
      statusEl.querySelector("span:last-child").textContent = ok ? "Connected" : "Offline";
    }

    async function checkHealth() {
      try {
        const response = await fetch("/health");
        const data = await response.json();
        updateStatus(response.ok && data.ok);
      } catch {
        updateStatus(false);
      }
    }

    function renderRemaining() {
      const agent = currentAgent();
      const remaining = remainingByAgent[agent] ?? 10;
      remainingEl.textContent = "Remaining for " + agent + ": " + remaining;
    }

    function setCell(x, y, value) {
      const idx = y * size + x;
      const cell = cells[idx];
      if (!cell) return;
      cell.textContent = value ? "🌝" : "🌚";
      cell.classList.remove("flash");
      cell.offsetWidth;
      cell.classList.add("flash");
    }

    function updateFilterOptions() {
      const current = logFilterEl.value;
      const agents = Array.from(new Set(lastLog.map((e) => e.agent))).sort((a, b) => a.localeCompare(b));
      logFilterEl.innerHTML = '<option value="all">All agents</option>' + agents.map((a) => '<option value="' + a.replace(/"/g, "&quot;") + '">' + a + '</option>').join("");
      if (agents.includes(current)) logFilterEl.value = current;
    }

    function renderLog() {
      const selectedAgent = logFilterEl.value;
      const entries = selectedAgent === "all" ? lastLog : lastLog.filter((e) => e.agent === selectedAgent);

      if (!entries.length) {
        feed.innerHTML = '<div class="empty">No log entries for this filter yet.</div>';
        return;
      }

      feed.innerHTML = entries.map((e) => {
        const moon = e.newValue ? "🌝" : "🌚";
        const ts = new Date(e.timestamp).toLocaleTimeString();
        return '<article class="event">'
          + '<div><strong>' + moon + '</strong> Cell toggled</div>'
          + '<div class="meta"><span class="agent">' + e.agent + '</span><span class="coords">(' + e.x + ',' + e.y + ')</span><span>' + ts + '</span></div>'
          + '</article>';
      }).join("");
    }

    async function loadState() {
      const response = await fetch("/state");
      const data = await response.json();
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) setCell(x, y, !!data.grid[y][x]);
      Object.assign(remainingByAgent, data.remainingByAgent || {});
      renderRemaining();
    }

    async function loadLog() {
      const response = await fetch("/log");
      const data = await response.json();
      lastLog = data.log || [];
      updateFilterOptions();
      renderLog();
    }

    function buildBoard() {
      const frag = document.createDocumentFragment();
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const cell = document.createElement("div");
          cell.className = "cell";
          cell.dataset.x = String(x);
          cell.dataset.y = String(y);
          cells.push(cell);
          frag.appendChild(cell);
        }
      }
      board.appendChild(frag);
    }

    function resetView() {
      if (!panzoom) return;
      panzoom.zoom(1, { animate: false });
      panzoom.pan(0, 0, { animate: false });
    }

    function initPanZoom() {
      panzoom = Panzoom(board, { maxScale: 5, minScale: 0.5, contain: "outside" });
      viewport.addEventListener("wheel", panzoom.zoomWithWheel, { passive: false });
    }

    board.addEventListener("click", (event) => {
      const cell = event.target.closest(".cell");
      if (!cell) return;
      const x = Number(cell.dataset.x);
      const y = Number(cell.dataset.y);
      if (!Number.isInteger(x) || !Number.isInteger(y)) return;

      fetch("/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: currentAgent(), x, y }),
      })
      .then(r => r.json().then(d => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) { alert(d.error || "Toggle failed"); return; }
        setCell(x, y, !!d.cell.value);
        remainingByAgent[currentAgent()] = d.remaining;
        renderRemaining();
        loadLog();
      });
    });

    agentInput.addEventListener("input", renderRemaining);
    document.getElementById("resetBtn").addEventListener("click", resetView);
    logFilterEl.addEventListener("change", renderLog);
    toggleLogBtn.addEventListener("click", () => {
      sidebarEl.classList.toggle("collapsed");
      toggleLogBtn.textContent = sidebarEl.classList.contains("collapsed") ? "Show" : "Hide";
    });

    buildBoard();
    initPanZoom();
    checkHealth();
    loadState();
    loadLog();
    setInterval(checkHealth, 8000);
    setInterval(loadLog, 2000);
  </script>
</body>
</html>`);
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("listening on", port));
