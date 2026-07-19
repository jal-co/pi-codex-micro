/**
 * Single-file HTML page for the Codex Micro simulator.
 * Served by SimHub; talks SSE (/events) + POST (/action).
 *
 * Multi-agent: each connected pi session occupies one agent key.
 * Clicking an occupied key selects it AND jumps to its terminal pane,
 * matching the real device: pressing an agent key takes you to that
 * agent. Shift-click (or keys 1-4) selects without jumping so the
 * joystick, dial, and command keys can be aimed from the browser. Agent keys are static DOM updated in place so broadcasts
 * never restart animations or shift layout.
 */

export const SIM_PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Codex Micro Simulator</title>
<style>
  :root {
    --bg: #0d0e11;
    --base: #17181d;
    --frame: #23252c;
    --key: #2b2d35;
    --key-edge: #383b45;
    --key-border: #40434f;
    --key-border-hover: #565a68;
    --key-border-selected: #8b91a5;
    --text: #d7d9e0;
    --muted: #8d92a3;
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

  .device {
    background: linear-gradient(160deg, var(--frame), var(--base));
    border: 1px solid #303340;
    border-radius: 22px;
    padding: 26px;
    display: inline-grid;
    grid-template-columns: auto auto;
    gap: 22px;
    box-shadow: 0 18px 50px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.04);
  }

  .keys { display: grid; grid-template-rows: auto auto auto; gap: 12px; }
  .row { display: grid; grid-template-columns: repeat(4, 64px); gap: 12px; }

  .key {
    height: 64px; border-radius: 12px;
    background: linear-gradient(180deg, var(--key-edge), var(--key));
    border: 1px solid var(--key-border);
    color: var(--text);
    display: grid; place-items: center;
    font: inherit; font-size: 18px;
    cursor: pointer; user-select: none;
    transition: background 150ms ease, box-shadow 150ms ease, border-color 150ms ease;
  }
  .key:hover { border-color: var(--key-border-hover); box-shadow: 0 0 0 2px rgba(255,255,255,0.05); }
  .key:active { background: var(--key); }
  .key:focus-visible { outline: 2px solid var(--needs-input); outline-offset: 2px; }
  .key small {
    font-size: 9px; color: var(--muted); letter-spacing: 0.06em;
    max-width: 56px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .key .cap { display: grid; gap: 3px; place-items: center; }

  .agent .led {
    width: 14px; height: 14px; border-radius: 50%;
    background: var(--idle);
    transition: background 250ms ease, box-shadow 250ms ease;
  }
  .agent[data-state="thinking"] .led { background: var(--thinking); box-shadow: 0 0 14px var(--thinking); animation: pulse 1.1s ease-in-out infinite; }
  .agent[data-state="complete"] .led { background: var(--complete); box-shadow: 0 0 12px var(--complete); }
  .agent[data-state="needs-input"] .led { background: var(--needs-input); box-shadow: 0 0 12px var(--needs-input); animation: pulse 1.8s ease-in-out infinite; }
  .agent[data-state="error"] .led { background: var(--error); box-shadow: 0 0 14px var(--error); }
  .agent[data-empty] { cursor: default; }
  .agent[data-empty] .led { background: #33353e; }
  .agent[data-empty] small { color: #565a68; }
  .agent[data-empty]:hover { border-color: var(--key-border); box-shadow: none; }
  .agent[data-offline] .led { opacity: 0.35; box-shadow: none; animation: none; }
  .agent[data-offline] small { color: #565a68; }
  .agent[aria-pressed="true"] { border-color: var(--key-border-selected); box-shadow: 0 0 0 2px rgba(139,145,165,0.25); }
  .agent[aria-pressed="true"] small { color: var(--text); }
  @keyframes pulse { 50% { opacity: 0.45; } }
  @media (prefers-reduced-motion: reduce) {
    .agent .led { animation: none !important; }
    * { transition-duration: 0ms !important; }
  }

  .side { display: grid; gap: 18px; align-content: start; }

  .dial { position: relative; width: 92px; height: 92px; margin: 0 auto; }
  .dial .ring {
    width: 92px; height: 92px; border-radius: 50%;
    background: conic-gradient(from 210deg, #3a3d48, #22242b 70%, #3a3d48);
    border: 1px solid #454858;
    display: grid; place-items: center;
    box-shadow: 0 6px 16px rgba(0,0,0,0.5);
  }
  .dial .level { font-size: 10px; color: var(--muted); text-align: center; }
  .dial .level b { display: block; color: var(--text); font-size: 12px; }
  .dial button {
    position: absolute; top: 50%; transform: translateY(-50%);
    width: 26px; height: 26px; border-radius: 50%;
    background: var(--key); border: 1px solid #454858; color: var(--text);
    cursor: pointer; font: inherit; font-size: 13px; line-height: 1;
    transition: border-color 150ms ease, box-shadow 150ms ease;
  }
  .dial button:hover { border-color: var(--key-border-hover); box-shadow: 0 0 0 2px rgba(255,255,255,0.05); }
  .dial .ccw { left: -34px; }
  .dial .cw { right: -34px; }

  .joy {
    display: grid; grid-template-columns: repeat(3, 30px); grid-template-rows: repeat(3, 30px);
    gap: 4px; justify-content: center;
  }
  .joy button {
    border-radius: 8px; background: var(--key); border: 1px solid #454858;
    color: var(--text); cursor: pointer; font: inherit; font-size: 12px;
    transition: border-color 150ms ease, box-shadow 150ms ease;
  }
  .joy button:hover { border-color: var(--key-border-hover); box-shadow: 0 0 0 2px rgba(255,255,255,0.05); }
  .joy .hub { background: radial-gradient(circle at 35% 35%, #3d404c, #24262e); border-radius: 50%; cursor: default; }

  .legend { margin-top: 18px; color: var(--muted); font-size: 11px; }
  .legend span { margin: 0 8px; }
  .legend i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; }

  .log { margin-top: 14px; color: var(--muted); font-size: 11px; min-height: 16px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1><span class="dot" id="dot"></span>CODEX MICRO · SIM</h1>
    <div class="sub" id="sub">waiting for pi sessions</div>
  </header>

  <div class="device">
    <div class="keys">
      <div class="row" id="agents">
        <button class="key agent" data-slot="0" data-empty aria-pressed="false"><span class="cap"><span class="led"></span><small>OPEN</small></span></button>
        <button class="key agent" data-slot="1" data-empty aria-pressed="false"><span class="cap"><span class="led"></span><small>OPEN</small></span></button>
        <button class="key agent" data-slot="2" data-empty aria-pressed="false"><span class="cap"><span class="led"></span><small>OPEN</small></span></button>
        <button class="key agent" data-slot="3" data-empty aria-pressed="false"><span class="cap"><span class="led"></span><small>OPEN</small></span></button>
      </div>
      <div class="row">
        <button class="key" data-action='{"kind":"command","value":"accept"}'><span class="cap">✓<small>ACCEPT</small></span></button>
        <button class="key" data-action='{"kind":"interrupt"}'><span class="cap">✕<small>STOP</small></span></button>
        <button class="key" data-action='{"kind":"command","value":"new"}'><span class="cap">+<small>NEW</small></span></button>
        <button class="key" data-action='{"kind":"command","value":"test"}'><span class="cap">◈<small>TEST</small></span></button>
      </div>
      <div class="row">
        <button class="key" data-action='{"kind":"key","value":"k1"}'><span class="cap">1<small>KEY</small></span></button>
        <button class="key" data-action='{"kind":"key","value":"k2"}'><span class="cap">2<small>KEY</small></span></button>
        <button class="key" data-action='{"kind":"key","value":"k3"}'><span class="cap">3<small>KEY</small></span></button>
        <button class="key" data-action='{"kind":"key","value":"k4"}'><span class="cap">4<small>KEY</small></span></button>
      </div>
    </div>

    <div class="side">
      <div class="dial">
        <button class="ccw" data-action='{"kind":"dial","value":"ccw"}' title="thinking down">−</button>
        <div class="ring"><div class="level">THINK<b id="level">·</b></div></div>
        <button class="cw" data-action='{"kind":"dial","value":"cw"}' title="thinking up">+</button>
      </div>
      <div class="joy">
        <span></span>
        <button data-action='{"kind":"joystick","value":"up"}'>▲</button>
        <span></span>
        <button data-action='{"kind":"joystick","value":"left"}'>◀</button>
        <div class="hub"></div>
        <button data-action='{"kind":"joystick","value":"right"}'>▶</button>
        <span></span>
        <button data-action='{"kind":"joystick","value":"down"}'>▼</button>
        <span></span>
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
  <div class="log" id="log">click agent = jump to pane · shift-click or 1-4 = target only · arrows = joystick · +/- = dial</div>
</div>

<script>
  const SLOT_COUNT = 4;
  let sessions = [];
  let selectedId = null;

  const log = (message) => { document.getElementById("log").textContent = message; };
  const selected = () => sessions.find((s) => s.id === selectedId) ?? null;

  const agentKeys = [...document.querySelectorAll(".agent")];

  function render() {
    // Keep selection valid: fall back to the first occupied slot.
    if (!selected()) selectedId = sessions[0] ? sessions[0].id : null;

    for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
      const key = agentKeys[slot];
      const session = sessions.find((s) => s.slot === slot) ?? null;
      const state = session ? session.state : "idle";
      // Only touch attributes that changed; untouched LEDs keep pulsing.
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
      const small = key.querySelector("small");
      if (small.textContent !== label) small.textContent = label;
      key.setAttribute("aria-pressed", String(Boolean(session && session.id === selectedId)));
    }

    const current = selected();
    const sub = document.getElementById("sub");
    if (current) {
      sub.replaceChildren();
      const name = document.createElement("b");
      name.textContent = current.name;
      sub.appendChild(name);
      sub.appendChild(document.createTextNode(current.model ? " · " + current.model : ""));
    } else {
      sub.textContent = "waiting for pi sessions";
    }
    document.getElementById("level").textContent = current && current.thinking ? current.thinking : "·";
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
      selectedId = session.id;
      render();
      // Shift-click targets without switching panes.
      if (event.shiftKey) return;
      if (!session.canFocus) { log(session.name + ": pane focus not supported here"); return; }
      log(session.name + ": jumping to pane");
      fetch("/action", { method: "POST", body: JSON.stringify({ kind: "focus", sessionId: session.id }) }).catch(() => {});
    });
  });

  document.addEventListener("keydown", (event) => {
    if (["1", "2", "3", "4"].includes(event.key)) {
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
