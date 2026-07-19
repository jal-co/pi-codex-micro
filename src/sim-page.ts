/**
 * Single-file HTML page for the Codex Micro simulator.
 * Served by SimHub; talks SSE (/events) + POST (/action).
 *
 * The device is rendered from the real face-plate line art (embedded
 * PNG); invisible hit areas are positioned over each drawn control.
 * Layout per the plate: dial top-left, joystick top-right, two top
 * keys (accept / stop), rows two and three carry the six agent keys
 * plus two custom keys, mic touch sensor bottom-left, the wide
 * "Let's build" key (new chat), and a test key bottom-right.
 *
 * Multi-agent: each connected pi session occupies one agent key.
 * Click = select + jump to its terminal pane; shift-click or 1-6 =
 * select only; clicking a dimmed key removes the dead session.
 * Static DOM updated in place so broadcasts never restart animations.
 */

import { DEVICE_PNG_BASE64 } from "./device-image.js";

export const SIM_PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Codex Micro Simulator</title>
<style>
  :root {
    --bg: #0d0e11;
    --text: #d7d9e0;
    --muted: #8d92a3;
    --hit: rgba(255,255,255,0.28);
    --idle: #4a4d59;
    --thinking: #f5a623;
    --complete: #3ddc84;
    --needs-input: #4da3ff;
    --error: #ff5d5d;
  }
  * { box-sizing: border-box; margin: 0; }
  body {
    background: var(--bg);
    color: var(--text);
    font: 14px/1.5 ui-monospace, "SF Mono", Menlo, monospace;
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 24px;
  }
  .wrap { text-align: center; }
  header { margin-bottom: 16px; }
  header h1 { font-size: 15px; font-weight: 600; letter-spacing: 0.08em; }
  header .sub { color: var(--muted); font-size: 12px; margin-top: 4px; min-height: 18px; }
  header .sub b { color: var(--text); font-weight: 600; }
  .dot {
    display: inline-block; width: 8px; height: 8px; border-radius: 50%;
    background: var(--error); margin-right: 6px; vertical-align: 1px;
    transition: background 200ms ease;
  }
  .dot.on { background: var(--complete); }

  .device {
    position: relative;
    width: min(88vw, 540px);
    aspect-ratio: 1;
    margin: 0 auto;
    background: url("data:image/png;base64,${DEVICE_PNG_BASE64}") center / contain no-repeat;
  }

  .pad {
    position: absolute;
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
    border-radius: 18%;
    color: var(--text);
    font: inherit;
    transition: box-shadow 150ms ease;
  }
  .pad:hover { box-shadow: inset 0 0 0 2px var(--hit); }
  .pad:focus-visible { outline: 2px solid var(--needs-input); outline-offset: 2px; }
  .pad.round { border-radius: 50%; }
  .pad .tag {
    position: absolute; left: 0; right: 0; bottom: 7%;
    font-size: 9px; letter-spacing: 0.08em; color: var(--muted);
    pointer-events: none;
  }

  /* Agent keys: LED glow inside the drawn circle + session label */
  .agent .led {
    position: absolute; inset: 16%;
    border-radius: 50%;
    background: transparent;
    transition: background 250ms ease, box-shadow 250ms ease;
    pointer-events: none;
  }
  .agent[data-state="thinking"] .led { background: radial-gradient(circle, var(--thinking) 0%, transparent 68%); animation: pulse 1.1s ease-in-out infinite; }
  .agent[data-state="complete"] .led { background: radial-gradient(circle, var(--complete) 0%, transparent 68%); }
  .agent[data-state="needs-input"] .led { background: radial-gradient(circle, var(--needs-input) 0%, transparent 68%); animation: pulse 1.8s ease-in-out infinite; }
  .agent[data-state="error"] .led { background: radial-gradient(circle, var(--error) 0%, transparent 68%); }
  .agent .who {
    position: absolute; left: 8%; right: 8%; top: 50%;
    transform: translateY(-50%);
    font-size: 9px; letter-spacing: 0.05em; color: var(--muted);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    pointer-events: none;
  }
  .agent[data-state]:not([data-state="idle"]) .who { color: #0d0e11; font-weight: 700; }
  .agent[data-empty] { cursor: default; }
  .agent[data-empty]:hover { box-shadow: none; }
  .agent[data-empty] .who { color: #3a3d48; }
  .agent[data-offline] .led { opacity: 0.3; animation: none; }
  .agent[data-offline] .who { color: var(--muted); font-weight: 400; }
  .agent[aria-pressed="true"] { box-shadow: inset 0 0 0 2px rgba(139,145,165,0.55); }
  @keyframes pulse { 50% { opacity: 0.45; } }
  @media (prefers-reduced-motion: reduce) {
    .agent .led { animation: none !important; }
    * { transition-duration: 0ms !important; }
  }

  .legend { margin-top: 16px; color: var(--muted); font-size: 11px; }
  .legend span { margin: 0 8px; }
  .legend i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; }
  .log { margin-top: 12px; color: var(--muted); font-size: 11px; min-height: 16px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1><span class="dot" id="dot"></span>CODEX MICRO · SIM</h1>
    <div class="sub" id="sub">waiting for pi sessions</div>
  </header>

  <div class="device">
    <!-- Dial (top-left): left half down, right half up -->
    <button class="pad round" style="left:9.3%; top:9%; width:9.5%; height:19%; border-radius:100% 0 0 100% / 50% 0 0 50%;"
      data-action='{"kind":"dial","value":"ccw"}' title="thinking down"></button>
    <button class="pad round" style="left:18.8%; top:9%; width:9.5%; height:19%; border-radius:0 100% 100% 0 / 0 50% 50% 0;"
      data-action='{"kind":"dial","value":"cw"}' title="thinking up"></button>

    <!-- Top command keys -->
    <button class="pad" style="left:29.8%; top:8.6%; width:20%; height:20%;" data-action='{"kind":"command","value":"accept"}' title="accept"><span class="tag">ACCEPT</span></button>
    <button class="pad" style="left:50.6%; top:8.6%; width:20%; height:20%;" data-action='{"kind":"interrupt"}' title="stop"><span class="tag">STOP</span></button>

    <!-- Joystick (top-right): four quadrant hits -->
    <button class="pad round" style="left:78%; top:11.5%; width:7%; height:7%;" data-action='{"kind":"joystick","value":"up"}' title="joystick up"></button>
    <button class="pad round" style="left:74.4%; top:15.3%; width:7%; height:7%;" data-action='{"kind":"joystick","value":"left"}' title="joystick left"></button>
    <button class="pad round" style="left:81.6%; top:15.3%; width:7%; height:7%;" data-action='{"kind":"joystick","value":"right"}' title="joystick right"></button>
    <button class="pad round" style="left:78%; top:19%; width:7%; height:7%;" data-action='{"kind":"joystick","value":"down"}' title="joystick down"></button>

    <!-- Agent keys: row two (slots 0-3), row three cols 1-2 (slots 4-5) -->
    <button class="pad agent" data-slot="0" data-empty aria-pressed="false" style="left:8.8%;  top:29.3%; width:20%; height:20%;"><span class="led"></span><span class="who">OPEN</span></button>
    <button class="pad agent" data-slot="1" data-empty aria-pressed="false" style="left:29.8%; top:29.3%; width:20%; height:20%;"><span class="led"></span><span class="who">OPEN</span></button>
    <button class="pad agent" data-slot="2" data-empty aria-pressed="false" style="left:50.6%; top:29.3%; width:20%; height:20%;"><span class="led"></span><span class="who">OPEN</span></button>
    <button class="pad agent" data-slot="3" data-empty aria-pressed="false" style="left:71.5%; top:29.3%; width:20%; height:20%;"><span class="led"></span><span class="who">OPEN</span></button>
    <button class="pad agent" data-slot="4" data-empty aria-pressed="false" style="left:8.8%;  top:50.2%; width:20%; height:20%;"><span class="led"></span><span class="who">OPEN</span></button>
    <button class="pad agent" data-slot="5" data-empty aria-pressed="false" style="left:29.8%; top:50.2%; width:20%; height:20%;"><span class="led"></span><span class="who">OPEN</span></button>

    <!-- Custom keys: row three cols 3-4 -->
    <button class="pad" style="left:50.6%; top:50.2%; width:20%; height:20%;" data-action='{"kind":"key","value":"k1"}' title="custom key 1"><span class="tag">KEY 1</span></button>
    <button class="pad" style="left:71.5%; top:50.2%; width:20%; height:20%;" data-action='{"kind":"key","value":"k2"}' title="custom key 2"><span class="tag">KEY 2</span></button>

    <!-- Bottom row: mic touch, wide new-chat key, test key -->
    <button class="pad round" style="left:13.5%; top:75.8%; width:10.5%; height:10.5%;" data-action='{"kind":"key","value":"mic"}' title="push to talk"></button>
    <button class="pad" style="left:29.8%; top:71%; width:40.8%; height:19%; border-radius:12%;" data-action='{"kind":"command","value":"new"}' title="new chat"><span class="tag">NEW CHAT</span></button>
    <button class="pad" style="left:71.5%; top:71%; width:20%; height:20%;" data-action='{"kind":"command","value":"test"}' title="LED test"><span class="tag">TEST</span></button>
  </div>

  <div class="legend">
    <span><i style="background:var(--idle)"></i>idle</span>
    <span><i style="background:var(--thinking)"></i>thinking</span>
    <span><i style="background:var(--complete)"></i>complete</span>
    <span><i style="background:var(--needs-input)"></i>needs input</span>
    <span><i style="background:var(--error)"></i>error</span>
  </div>
  <div class="log" id="log">click agent = jump to pane · shift-click or 1-6 = target only · click dimmed = remove · arrows = joystick · +/- = dial</div>
</div>

<script>
  const SLOT_COUNT = 6;
  let sessions = [];
  let selectedId = null;

  const log = (message) => { document.getElementById("log").textContent = message; };
  const selected = () => sessions.find((s) => s.id === selectedId) ?? null;
  const agentKeys = [...document.querySelectorAll(".agent")];

  function render() {
    if (!selected()) selectedId = sessions[0] ? sessions[0].id : null;

    for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
      const key = agentKeys[slot];
      const session = sessions.find((s) => s.slot === slot) ?? null;
      const state = session ? session.state : "idle";
      if (key.dataset.state !== state) key.dataset.state = state;
      if (session) {
        key.removeAttribute("data-empty");
        key.disabled = false;
        if (session.connected) key.removeAttribute("data-offline");
        else key.setAttribute("data-offline", "");
        const parts = [session.name];
        if (session.model) parts.push(session.model);
        if (session.terminal) parts.push(session.terminal);
        key.title = parts.join(" · ");
      } else {
        key.setAttribute("data-empty", "");
        key.removeAttribute("data-offline");
        key.disabled = true;
        key.title = "";
      }
      const label = session ? session.name.toUpperCase() : "OPEN";
      const who = key.querySelector(".who");
      if (who.textContent !== label) who.textContent = label;
      key.setAttribute("aria-pressed", String(Boolean(session && session.id === selectedId)));
    }

    const current = selected();
    const sub = document.getElementById("sub");
    if (current) {
      sub.replaceChildren();
      const name = document.createElement("b");
      name.textContent = current.name;
      sub.appendChild(name);
      const extra = [];
      if (current.model) extra.push(current.model);
      if (current.thinking) extra.push("think " + current.thinking);
      sub.appendChild(document.createTextNode(extra.length ? " · " + extra.join(" · ") : ""));
    } else {
      sub.textContent = "waiting for pi sessions";
    }
  }

  async function act(action) {
    const current = selected();
    if (!current) { log("no agent connected"); return; }
    action.sessionId = current.id;
    log(current.name + ": " + action.kind + (action.value ? " " + action.value : ""));
    try {
      await fetch("/action", { method: "POST", body: JSON.stringify(action) });
    } catch {
      log("hub unreachable");
    }
  }

  document.querySelectorAll("[data-action]").forEach((el) => {
    el.addEventListener("click", () => act(JSON.parse(el.dataset.action)));
  });

  agentKeys.forEach((key, slot) => {
    key.addEventListener("click", (event) => {
      const session = sessions.find((s) => s.slot === slot);
      if (!session) return;
      if (!session.connected) {
        log(session.name + ": removed");
        fetch("/kick", { method: "POST", body: JSON.stringify({ id: session.id }) }).catch(() => {});
        return;
      }
      selectedId = session.id;
      render();
      if (event.shiftKey) return;
      if (!session.canFocus) { log(session.name + ": pane focus not supported here"); return; }
      log(session.name + ": jumping to pane");
      fetch("/action", { method: "POST", body: JSON.stringify({ kind: "focus", sessionId: session.id }) }).catch(() => {});
    });
  });

  document.addEventListener("keydown", (event) => {
    if (["1", "2", "3", "4", "5", "6"].includes(event.key)) {
      const session = sessions.find((s) => s.slot === Number(event.key) - 1);
      if (session) { selectedId = session.id; render(); }
      return;
    }
    const map = {
      ArrowUp: { kind: "joystick", value: "up" },
      ArrowDown: { kind: "joystick", value: "down" },
      ArrowLeft: { kind: "joystick", value: "left" },
      ArrowRight: { kind: "joystick", value: "right" },
      "=": { kind: "dial", value: "cw" },
      "+": { kind: "dial", value: "cw" },
      "-": { kind: "dial", value: "ccw" },
      Escape: { kind: "interrupt" },
    };
    if (map[event.key]) { event.preventDefault(); act(map[event.key]); }
  });

  function connect() {
    const source = new EventSource("/events");
    source.onopen = () => document.getElementById("dot").classList.add("on");
    source.onerror = () => document.getElementById("dot").classList.remove("on");
    source.onmessage = (message) => {
      const event = JSON.parse(message.data);
      if (event.type === "sessions") { sessions = event.sessions; render(); }
    };
  }

  render();
  connect();
</script>
</body>
</html>
`;
