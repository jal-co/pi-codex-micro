# pi-codex-micro

[Work Louder Codex Micro](https://worklouder.cc/codex-micro) support for
[pi](https://github.com/badlogic/pi-mono). Command keys, dial, and
joystick drive pi; pi drives the agent-state LEDs back.

## Status

- **Input side: working.** Keys, dial, and joystick are mapped through
  Work Louder Input to keystrokes that pi shortcuts handle.
- **Simulator: working, multi-agent.** `/codex-micro sim` opens a
  browser-based virtual Codex Micro. Every running pi session (each
  zentty pane) occupies one agent key with its own live state; inputs
  route to whichever agent is selected. No hardware needed.
- **Output side: scaffolded.** The LED protocol is undocumented, so the
  extension ships with a mock transport. See
  [docs/protocol-discovery.md](docs/protocol-discovery.md) for the plan
  to fill in `src/protocol.ts` once the hardware arrives, then flip
  `"transport": "hid"`.

## Install

```bash
cd ~/Documents/GitHub/pi-codex-micro && npm install
```

Add to `~/.pi/agent/settings.json`:

```json
{
  "extensions": ["/Users/justin/Documents/GitHub/pi-codex-micro/src/index.ts"]
}
```

Then `/reload` in pi.

## Device mapping (Work Louder Input)

Map the Micro's physical controls to these keystrokes in the Input
configurator. Native pi keybindings cover half the surface; extension
shortcuts cover the rest.

| Control | Keystroke | Action in pi |
|---|---|---|
| Accept key | `enter` | Submit / confirm dialogs |
| Reject key | `escape` | Interrupt / cancel dialogs |
| New chat key | `ctrl+alt+n`* | New session |
| Model key | `ctrl+p` | Cycle model |
| Thinking key | `shift+tab` | Cycle thinking level |
| Dial CW | `ctrl+alt+=` | Thinking level up |
| Dial CCW | `ctrl+alt+-` | Thinking level down |
| Joystick up | `ctrl+alt+i` | Skill slot 1 |
| Joystick down | `ctrl+alt+k` | Skill slot 2 |
| Joystick left | `ctrl+alt+j` | Skill slot 3 |
| Joystick right | `ctrl+alt+l` | Skill slot 4 |

\* Bind in `~/.pi/agent/keybindings.json`:

```json
{
  "app.session.new": ["ctrl+alt+n"]
}
```

Push-to-talk is handled on the OS side (map the touch sensor to your
dictation hotkey); the transcript lands in pi's editor like any typed
prompt.

## Configuration

`~/.pi/agent/codex-micro.json` (all fields optional):

```json
{
  "transport": "mock",
  "agentSlot": 0,
  "joystick": {
    "up": "/skill:impeccable",
    "down": "/skill:git",
    "left": "Review my latest changes and point out problems.",
    "right": "Continue where you left off."
  },
  "commandKeys": {
    "ctrl+alt+r": "/reload"
  }
}
```

Joystick and command-key values are sent as pi input, so slash commands,
`/skill:name`, and plain prompts all work.

## Simulator

Run `/codex-micro sim` in pi. A local page opens showing the device.

The first session to run it hosts the hub on port 7327; every other pi
session auto-joins at startup (or via `/codex-micro sim`, which reports
it joined instead of opening a second window). Each session takes one
agent key, labeled with its project directory. If the hosting session
exits, a remaining session takes over the port and the page reconnects
on its own.

- **Agent keys** glow with each session's live state (thinking pulses
  amber, complete green, needs-input blue, error red); click one (or
  press 1-4) to select which agent the controls target; double-click
  to jump straight to that session's zentty pane
- **Slots are sticky:** a dropped session keeps its key for 10 seconds
  so reconnects, `/new`, and `/reload` never reshuffle the row; the
  hub itself survives `/reload` and `/new` (it only shuts down when pi
  exits), and keys dim while a session is briefly offline
- **Joystick** arrows fire the selected session's four skill/prompt slots
- **Dial** buttons step the selected session's thinking level (shown in
  the knob)
- **ACCEPT / STOP / NEW / TEST** command keys: accept sends
  `commandKeys["sim:accept"]` (default "Looks good, proceed."), stop
  aborts the current run, new sends `commandKeys["sim:new"]`
  (default `/new`), test cycles all LED states
- **Keys 1-4** send `commandKeys["sim:k1"]` through `sim:k4`
- Keyboard works too: arrows = joystick, `+`/`-` = dial, Esc = stop

State flows over Server-Sent Events; clicks POST back into the
extension and become ordinary pi input. `scripts/sim-smoke.ts`
(`npx tsx scripts/sim-smoke.ts`) smoke-tests the server headlessly.

## Commands

| Command | Action |
|---|---|
| `/codex-micro status` | Transport, state, and config summary |
| `/codex-micro sim` | Start the browser simulator and open it |
| `/codex-micro sim stop` | Stop the simulator server |
| `/codex-micro connect` | (Re)connect the HID device |
| `/codex-micro disconnect` | Close the HID device |
| `/codex-micro test` | Cycle all five LED states |

## LED state mapping

| pi lifecycle | Device state |
|---|---|
| Session start / user typing | idle |
| Agent running | thinking |
| Run settled, last message ends with `?` | needs input |
| Run settled cleanly | complete |
| Run settled after an error stop | error |

## Layout

```
src/
  index.ts          extension entry (shortcuts, commands, events)
  state.ts          pi lifecycle -> agent-state mapping
  transport.ts      DeviceTransport interface
  hid-transport.ts  node-hid implementation
  mock-transport.ts no-hardware fallback
  protocol.ts       HID report constants (placeholders until sniffed)
  sim.ts            hub-or-client facade with failover
  sim-server.ts     multi-session hub (page, SSE, action routing)
  sim-client.ts     client for sessions joining an existing hub
  sim-shared.ts     wire types, fixed port, slot count
  sim-page.ts       simulator device page (single-file HTML)
  config.ts         ~/.pi/agent/codex-micro.json loader
scripts/
  sim-smoke.ts      headless simulator smoke test
docs/
  protocol-discovery.md  reverse-engineering plan
```
