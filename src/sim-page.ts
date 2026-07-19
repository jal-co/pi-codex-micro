/**
 * Single-file HTML page for the Codex Micro simulator.
 * Served by SimServer; talks SSE (/events) + POST (/action).
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
    --text: #d7d9e0;
    --muted: #7c8090;
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
  header .sub { color: var(--muted); font-size: 12px; margin-top: 4px; }
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
  .row { display: grid; grid-template-columns: repeat(4, 56px); gap: 12px; }

  .key {
    height: 56px; border-radius: 12px;
    background: linear-gradient(180deg, var(--key-edge), var(--key));
    border: 1px solid #40434f;
    color: var(--text);
    display: grid; place-items: center;
    font: inherit; font-size: 18px;
    cursor: pointer; user-select: none;
    transition: background 150ms ease, box-shadow 150ms ease, border-color 150ms ease;
  }
  .key:hover { border-color: #565a68; box-shadow: 0 0 0 2px rgba(255,255,255,0.05); }
  .key:active { background: var(--key); }
  .key small { font-size: 9px; color: var(--muted); letter-spacing: 0.06em; }
  .key .cap { display: grid; gap: 2px; place-items: center; }

  .agent { cursor: default; }
  .agent .led {
    width: 14px; height: 14px; border-radius: 50%;
    background: var(--idle);
    transition: background 250ms ease, box-shadow 250ms ease;
  }
  .agent[data-state="thinking"] .led { background: var(--thinking); box-shadow: 0 0 14px var(--thinking); animation: pulse 1.1s ease-in-out infinite; }
  .agent[data-state="complete"] .led { background: var(--complete); box-shadow: 0 0 12px var(--complete); }
  .agent[data-state="needs-input"] .led { background: var(--needs-input); box-shadow: 0 0 12px var(--needs-input); animation: pulse 1.8s ease-in-out infinite; }
  .agent[data-state="error"] .led { background: var(--error); box-shadow: 0 0 14px var(--error); }
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
  .dial button:hover { border-color: #565a68; box-shadow: 0 0 0 2px rgba(255,255,255,0.05); }
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
  .joy button:hover { border-color: #565a68; box-shadow: 0 0 0 2px rgba(255,255,255,0.05); }
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
    <div class="sub" id="model">pi not connected</div>
  </header>

  <div class="device">
    <div class="keys">
      <div class="row" id="agents">
        <button class="key agent" data-slot="0" data-state="idle"><span class="cap"><span class="led"></span><small>AGENT 1</small></span></button>
        <button class="key agent" data-slot="1" data-state="idle"><span class="cap"><span class="led"></span><small>AGENT 2</small></span></button>
        <button class="key agent" data-slot="2" data-state="idle"><span class="cap"><span class="led"></span><small>AGENT 3</small></span></button>
        <button class="key agent" data-slot="3" data-state="idle"><span class="cap"><span class="led"></span><small>AGENT 4</small></span></button>
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
        <div class="ring"><div class="level">THINK<b id="level">?</b></div></div>
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
  <div class="log" id="log">arrows = joystick · +/- = dial</div>
</div>

<script>
  const log = (message) => { document.getElementById("log").textContent = message; };

  async function act(action) {
    log(action.kind + (action.value ? " " + action.value : ""));
    try {
      await fetch("/action", { method: "POST", body: JSON.stringify(action) });
    } catch {
      log("pi unreachable");
    }
  }

  document.querySelectorAll("[data-action]").forEach((el) => {
    el.addEventListener("click", () => act(JSON.parse(el.dataset.action)));
  });

  document.addEventListener("keydown", (event) => {
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

  const source = new EventSource("/events");
  source.onopen = () => document.getElementById("dot").classList.add("on");
  source.onerror = () => document.getElementById("dot").classList.remove("on");
  source.onmessage = (message) => {
    const event = JSON.parse(message.data);
    if (event.type === "state") {
      const key = document.querySelector('.agent[data-slot="' + event.slot + '"]');
      if (key) key.dataset.state = event.state;
    } else if (event.type === "thinking") {
      document.getElementById("level").textContent = event.level;
    } else if (event.type === "model") {
      document.getElementById("model").textContent = event.model;
    } else if (event.type === "hello") {
      document.getElementById("model").textContent = "pi connected";
    }
  };
</script>
</body>
</html>
`;
