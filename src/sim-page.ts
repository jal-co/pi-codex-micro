/**
 * Single-file HTML page for the Codex Micro simulator.
 * Served by SimHub; talks SSE (/events) + POST (/action).
 *
 * The device is rendered entirely in CSS after the real hardware:
 * white case, frosted plate with corner screws and edge text, dial
 * top-left, black joystick top-right, six translucent RGB indicator
 * keys (two on the top row, four on row two), a row of white icon
 * keys (custom 1, accept, stop, custom 2), then the mic cluster, the
 * wide "Let's build" mic key (new chat), and the test key.
 *
 * All six translucent keys are agent indicators, and the case
 * exterior glows in the selected agent's state colour.
 *
 * Multi-agent: each connected pi session occupies one indicator key.
 * Click = select + jump to its terminal pane; shift-click or 1-6 =
 * select only; clicking a dimmed key removes the dead session.
 * Static DOM updated in place so broadcasts never restart animations.
 */

export const SIM_PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Codex Micro Simulator</title>
<style>
  :root {
    --bg: #f4f4f6;
    --text: #2b2c31;
    --muted: #8d92a3;
    --case: #fbfbfc;
    --case-edge: #e3e3e8;
    --plate: rgba(244,245,248,0.9);
    --key-white: #fcfcfd;
    --idle: #b9bcc6;
    --thinking: #f5a623;
    --complete: #3ddc84;
    --needs-input: #4da3ff;
    --error: #ff5d7d;
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
  header { margin-bottom: 20px; }
  header h1 { font-size: 15px; font-weight: 600; letter-spacing: 0.08em; }
  header .sub { color: var(--muted); font-size: 12px; margin-top: 4px; min-height: 18px; }
  header .sub b { color: var(--text); font-weight: 600; }
  .dot {
    display: inline-block; width: 8px; height: 8px; border-radius: 50%;
    background: var(--error); margin-right: 6px; vertical-align: 1px;
    transition: background 200ms ease;
  }
  .dot.on { background: var(--complete); }

  /* ---------- Case (exterior = indicator) ---------- */
  .device {
    position: relative;
    width: min(88vw, 560px);
    aspect-ratio: 1;
    margin: 0 auto;
    container-type: inline-size;
    background: linear-gradient(180deg, var(--case) 0%, #f1f1f4 78%, var(--case-edge) 100%);
    border-radius: 12%;
    border: 1px solid #e6e6ea;
    box-shadow:
      0 18px 40px rgba(30,32,40,0.14),
      0 2px 6px rgba(30,32,40,0.08),
      inset 0 -8px 14px rgba(30,32,40,0.05);
    transition: box-shadow 400ms ease;
  }
  .device[data-glow="thinking"]     { box-shadow: 0 0 70px 6px color-mix(in srgb, var(--thinking) 55%, transparent), 0 18px 40px rgba(30,32,40,0.12); }
  .device[data-glow="complete"]     { box-shadow: 0 0 70px 6px color-mix(in srgb, var(--complete) 55%, transparent), 0 18px 40px rgba(30,32,40,0.12); }
  .device[data-glow="needs-input"]  { box-shadow: 0 0 70px 6px color-mix(in srgb, var(--needs-input) 55%, transparent), 0 18px 40px rgba(30,32,40,0.12); }
  .device[data-glow="error"]        { box-shadow: 0 0 70px 6px color-mix(in srgb, var(--error) 55%, transparent), 0 18px 40px rgba(30,32,40,0.12); }
  .device[data-glow="thinking"], .device[data-glow="needs-input"] { animation: casepulse 1.6s ease-in-out infinite; }
  @keyframes casepulse { 50% { filter: brightness(1.03); } }

  /* ---------- Frosted plate ---------- */
  .plate {
    position: absolute; inset: 4.5%;
    background: var(--plate);
    border-radius: 9%;
    border: 1px solid rgba(120,124,140,0.25);
    box-shadow: inset 0 1px 4px rgba(255,255,255,0.9), inset 0 -2px 8px rgba(30,32,40,0.05);
  }
  .screw {
    position: absolute; width: 3.6cqi; height: 3.6cqi;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, #4b4c52, #17181c 70%);
    box-shadow: inset 0 0 0 0.7cqi rgba(255,255,255,0.06), 0 1px 2px rgba(0,0,0,0.3);
  }
  .screw::after {
    content: ""; position: absolute; inset: 26%;
    background:
      conic-gradient(from 0deg, #2a2b30 0 60deg, #101114 60deg 120deg, #2a2b30 120deg 180deg,
                     #101114 180deg 240deg, #2a2b30 240deg 300deg, #101114 300deg 360deg);
    border-radius: 50%;
  }
  .screw.tl { left: 2.2%; top: 2.2%; }
  .screw.tr { right: 2.2%; top: 2.2%; }
  .screw.bl { left: 2.2%; bottom: 2.2%; }
  .screw.br { right: 2.2%; bottom: 2.2%; }

  .plate-text {
    position: absolute; color: #6f7280;
    font: 500 2.1cqi/1 "Avenir Next", "Futura", ui-sans-serif, sans-serif;
    letter-spacing: 0.06em; pointer-events: none; white-space: nowrap;
  }
  .plate-text.left  { left: 1.2%; top: 50%; transform: translateY(-50%) rotate(180deg); writing-mode: vertical-rl; }
  .plate-text.right { right: 1.2%; top: 50%; transform: translateY(-50%); writing-mode: vertical-rl; }
  .plate-text.top    { left: 50%; top: 0.8%; transform: translateX(-50%); font-size: 3.2cqi; }
  .plate-text.bottom { left: 50%; bottom: 1.4%; transform: translateX(-50%); }

  /* ---------- Control grid ---------- */
  .grid {
    position: absolute; inset: 9.5% 10.5%;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    grid-template-rows: repeat(4, 1fr);
    gap: 3.2%;
  }
  .cell { position: relative; }

  /* ---------- Dial ---------- */
  .dial {
    position: absolute; inset: 4%;
    border-radius: 50%;
    background: linear-gradient(135deg, #ffffff 0%, #f4f4f6 55%, #dddde2 100%);
    box-shadow: 0 3px 8px rgba(30,32,40,0.18), inset 0 1px 2px rgba(255,255,255,0.9);
  }
  .dial::after {
    content: ""; position: absolute; left: 8%; right: 8%; top: 50%;
    height: 3%; transform: rotate(-45deg);
    background: rgba(30,32,40,0.18); border-radius: 999px;
  }
  .dial-hit {
    position: absolute; top: 0; height: 100%; width: 50%;
    background: transparent; border: none; cursor: pointer; padding: 0;
  }
  .dial-hit.ccw { left: 0; border-radius: 100% 0 0 100% / 50% 0 0 50%; }
  .dial-hit.cw { right: 0; border-radius: 0 100% 100% 0 / 0 50% 50% 0; }
  .dial-hit:hover { background: rgba(30,32,40,0.06); }

  /* ---------- Joystick ---------- */
  .joy {
    position: absolute; inset: 3%;
    border: 0.45cqi dashed #2b2c31;
    border-radius: 26%;
  }
  .joy .puck {
    position: absolute; inset: 7%;
    border-radius: 50%;
    background: radial-gradient(circle at 38% 32%, #3a3b40, #151619 65%);
    box-shadow: 0 3px 7px rgba(0,0,0,0.35), inset 0 1px 2px rgba(255,255,255,0.12);
  }
  .joy .puck::before, .joy .puck::after {
    content: ""; position: absolute; background: #0c0d10; border-radius: 999px;
  }
  .joy .puck::before { left: 44%; right: 44%; top: 16%; bottom: 16%; }
  .joy .puck::after  { top: 44%; bottom: 44%; left: 16%; right: 16%; }
  .joy-hit {
    position: absolute; width: 46%; height: 46%;
    background: transparent; border: none; cursor: pointer; padding: 0; border-radius: 50%;
  }
  .joy-hit:hover { background: rgba(255,255,255,0.14); }
  .joy-hit.up    { left: 27%; top: -2%; }
  .joy-hit.down  { left: 27%; bottom: -2%; }
  .joy-hit.left  { left: -2%; top: 27%; }
  .joy-hit.right { right: -2%; top: 27%; }

  /* ---------- Indicator (agent) keys ---------- */
  .agent {
    position: absolute; inset: 0;
    border: none; padding: 0; cursor: pointer;
    border-radius: 20%;
    background: linear-gradient(180deg, rgba(255,255,255,0.75), rgba(235,236,241,0.65));
    box-shadow:
      inset 0 0 0 1px rgba(120,124,140,0.3),
      inset 0 2px 3px rgba(255,255,255,0.85),
      0 2px 5px rgba(30,32,40,0.12);
    font: inherit; color: var(--text);
    transition: box-shadow 150ms ease, transform 120ms ease;
  }
  .agent:hover { transform: translateY(-1px); }
  .agent:active { transform: translateY(0); }
  .agent:focus-visible { outline: 2px solid var(--needs-input); outline-offset: 3px; }
  .agent .cap {
    position: absolute; inset: 13%;
    border-radius: 22%;
    background: rgba(255,255,255,0.55);
    box-shadow: inset 0 0 0 1px rgba(120,124,140,0.22), inset 0 -2px 5px rgba(30,32,40,0.06);
    transition: background 250ms ease, box-shadow 250ms ease;
    pointer-events: none;
  }
  .agent .stem {
    position: absolute; left: 50%; top: 50%;
    width: 22%; height: 22%; transform: translate(-50%, -50%);
    pointer-events: none;
  }
  .agent .stem::before, .agent .stem::after {
    content: ""; position: absolute; background: #3f4048; border-radius: 999px;
  }
  .agent .stem::before { left: 38%; right: 38%; top: 0; bottom: 0; }
  .agent .stem::after  { top: 38%; bottom: 38%; left: 0; right: 0; }
  .agent[data-state="thinking"] .cap    { background: radial-gradient(circle, var(--thinking) 0%, color-mix(in srgb, var(--thinking) 25%, white) 100%); box-shadow: 0 0 3.5cqi 0.5cqi color-mix(in srgb, var(--thinking) 60%, transparent); animation: pulse 1.1s ease-in-out infinite; }
  .agent[data-state="complete"] .cap    { background: radial-gradient(circle, var(--complete) 0%, color-mix(in srgb, var(--complete) 25%, white) 100%); box-shadow: 0 0 3.5cqi 0.5cqi color-mix(in srgb, var(--complete) 60%, transparent); }
  .agent[data-state="needs-input"] .cap { background: radial-gradient(circle, var(--needs-input) 0%, color-mix(in srgb, var(--needs-input) 25%, white) 100%); box-shadow: 0 0 3.5cqi 0.5cqi color-mix(in srgb, var(--needs-input) 60%, transparent); animation: pulse 1.8s ease-in-out infinite; }
  .agent[data-state="error"] .cap       { background: radial-gradient(circle, var(--error) 0%, color-mix(in srgb, var(--error) 25%, white) 100%); box-shadow: 0 0 3.5cqi 0.5cqi color-mix(in srgb, var(--error) 60%, transparent); }
  .agent .who {
    position: absolute; left: 6%; right: 6%; bottom: 5%;
    font-size: 1.9cqi; letter-spacing: 0.05em; color: var(--muted);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    pointer-events: none;
  }
  .agent[data-empty] { cursor: default; }
  .agent[data-empty]:hover { transform: none; }
  .agent[data-empty] .who { color: #c8cad2; }
  .agent[data-empty] .stem::before, .agent[data-empty] .stem::after { background: #b7b9c2; }
  .agent[data-offline] .cap { opacity: 0.35; animation: none; }
  .agent[data-offline] .who { color: var(--muted); }
  .agent[aria-pressed="true"] { box-shadow: inset 0 0 0 2px #55586a, 0 2px 5px rgba(30,32,40,0.12); }
  @keyframes pulse { 50% { filter: brightness(1.25); } }
  @media (prefers-reduced-motion: reduce) {
    .agent .cap, .device { animation: none !important; }
    * { transition-duration: 0ms !important; }
  }

  /* ---------- White command keys ---------- */
  .key {
    position: absolute; inset: 0;
    border: none; padding: 0; cursor: pointer;
    border-radius: 22%;
    background: linear-gradient(180deg, #ffffff 0%, var(--key-white) 60%, #ededf0 100%);
    box-shadow:
      0 0.8cqi 0 #d8d8de,
      0 1.2cqi 2cqi rgba(30,32,40,0.14),
      inset 0 1px 2px rgba(255,255,255,0.95);
    color: #35363c;
    display: grid; place-items: center;
    font: inherit;
    transition: transform 90ms ease, box-shadow 90ms ease;
  }
  .key:hover { filter: brightness(1.02); }
  .key:active {
    transform: translateY(0.5cqi);
    box-shadow: 0 0.3cqi 0 #d8d8de, 0 0.6cqi 1cqi rgba(30,32,40,0.12), inset 0 1px 2px rgba(255,255,255,0.95);
  }
  .key:focus-visible { outline: 2px solid var(--needs-input); outline-offset: 3px; }
  .key svg { width: 34%; height: 34%; stroke: #35363c; fill: none; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
  .key.wide { border-radius: 14% / 26%; }
  .key.wide svg { width: 16%; height: 34%; }

  /* ---------- Mic cluster (bottom-left) ---------- */
  .cluster { position: absolute; inset: 0; display: flex; align-items: center; gap: 8%; }
  .leds { display: flex; flex-direction: column; gap: 22%; height: 60%; justify-content: center; }
  .leds i {
    width: 2.2cqi; height: 1.4cqi; border-radius: 2px;
    background: linear-gradient(180deg, #f4e9c8, #cbb877);
    box-shadow: 0 0 2px rgba(0,0,0,0.25);
  }
  .mic-touch {
    width: 52%; aspect-ratio: 1; border-radius: 50%;
    border: none; padding: 0; cursor: pointer;
    background: radial-gradient(circle at 38% 32%, #2c2d33, #0d0e11 70%);
    box-shadow: 0 2px 5px rgba(0,0,0,0.3), inset 0 1px 2px rgba(255,255,255,0.1);
    transition: transform 90ms ease;
  }
  .mic-touch:hover { transform: scale(1.05); }
  .mic-touch:focus-visible { outline: 2px solid var(--needs-input); outline-offset: 3px; }

  .cell.span2 { grid-column: span 2; }

  .legend { margin-top: 20px; color: var(--muted); font-size: 11px; }
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

  <div class="device" id="device">
    <div class="plate"></div>
    <span class="screw tl"></span><span class="screw tr"></span>
    <span class="screw bl"></span><span class="screw br"></span>
    <span class="plate-text top">&uarr;</span>
    <span class="plate-text left">Work Louder | OpenAI &nbsp;2026</span>
    <span class="plate-text right">You can just build things</span>
    <span class="plate-text bottom">Let&rsquo;s build</span>

    <div class="grid">
      <!-- Row 1: dial · indicator 0 · indicator 1 · joystick -->
      <div class="cell">
        <div class="dial"></div>
        <button class="dial-hit ccw" data-action='{"kind":"dial","value":"ccw"}' title="thinking down"></button>
        <button class="dial-hit cw" data-action='{"kind":"dial","value":"cw"}' title="thinking up"></button>
      </div>
      <div class="cell">
        <button class="agent" data-slot="0" data-empty aria-pressed="false"><span class="cap"></span><span class="stem"></span><span class="who">OPEN</span></button>
      </div>
      <div class="cell">
        <button class="agent" data-slot="1" data-empty aria-pressed="false"><span class="cap"></span><span class="stem"></span><span class="who">OPEN</span></button>
      </div>
      <div class="cell">
        <div class="joy"><div class="puck"></div></div>
        <button class="joy-hit up" data-action='{"kind":"joystick","value":"up"}' title="joystick up"></button>
        <button class="joy-hit left" data-action='{"kind":"joystick","value":"left"}' title="joystick left"></button>
        <button class="joy-hit right" data-action='{"kind":"joystick","value":"right"}' title="joystick right"></button>
        <button class="joy-hit down" data-action='{"kind":"joystick","value":"down"}' title="joystick down"></button>
      </div>

      <!-- Row 2: indicators 2-5 -->
      <div class="cell"><button class="agent" data-slot="2" data-empty aria-pressed="false"><span class="cap"></span><span class="stem"></span><span class="who">OPEN</span></button></div>
      <div class="cell"><button class="agent" data-slot="3" data-empty aria-pressed="false"><span class="cap"></span><span class="stem"></span><span class="who">OPEN</span></button></div>
      <div class="cell"><button class="agent" data-slot="4" data-empty aria-pressed="false"><span class="cap"></span><span class="stem"></span><span class="who">OPEN</span></button></div>
      <div class="cell"><button class="agent" data-slot="5" data-empty aria-pressed="false"><span class="cap"></span><span class="stem"></span><span class="who">OPEN</span></button></div>

      <!-- Row 3: custom 1 · accept · stop · custom 2 -->
      <div class="cell">
        <button class="key" data-action='{"kind":"key","value":"k1"}' title="custom key 1">
          <svg viewBox="0 0 24 24"><path d="M13 3 5 14h6l-1 7 8-11h-6l1-7z"/></svg>
        </button>
      </div>
      <div class="cell">
        <button class="key" data-action='{"kind":"command","value":"accept"}' title="accept">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.2 2.4 2.4 4.6-4.8"/></svg>
        </button>
      </div>
      <div class="cell">
        <button class="key" data-action='{"kind":"interrupt"}' title="stop">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/></svg>
        </button>
      </div>
      <div class="cell">
        <button class="key" data-action='{"kind":"key","value":"k2"}' title="custom key 2">
          <svg viewBox="0 0 24 24"><path d="M5 5v6M5 11h12M13 7l4 4-4 4M13 17l4-4"/></svg>
        </button>
      </div>

      <!-- Row 4: mic cluster · wide new-chat key · test key -->
      <div class="cell">
        <div class="cluster">
          <span class="leds"><i></i><i></i><i></i></span>
          <button class="mic-touch" data-action='{"kind":"key","value":"mic"}' title="push to talk"></button>
        </div>
      </div>
      <div class="cell span2">
        <button class="key wide" data-action='{"kind":"command","value":"new"}' title="new chat">
          <svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/></svg>
        </button>
      </div>
      <div class="cell">
        <button class="key" data-action='{"kind":"command","value":"test"}' title="LED test">
          <svg viewBox="0 0 24 24"><path d="M12 3.5c1.2 0 2 .9 3 .9s2-.7 3-.1 1 1.8 1.7 2.5 2 .8 2 2-1.2 1.4-1.4 2.5.6 2 .1 3-1.6.9-2.4 1.6-.8 2-2 2.2-1.7-.8-2.9-.8-1.9 1-3 .8-1.2-1.5-2-2.2-2.1-.6-2.6-1.6.4-1.9.2-3S4.3 9.9 4.3 8.8s1.3-1.3 2-2 .7-2 1.7-2.5 2 .1 3 .1 1.8-.9 3-.9z" transform="translate(0 1.5)"/><path d="m10 11 2 2-2 2M13.5 15h2.5"/></svg>
        </button>
      </div>
    </div>
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

    // Exterior glow mirrors the selected agent's state.
    const device = document.getElementById("device");
    const glow = current && current.connected && current.state !== "idle" ? current.state : "";
    if (device.dataset.glow !== glow) {
      if (glow) device.dataset.glow = glow;
      else delete device.dataset.glow;
    }

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
