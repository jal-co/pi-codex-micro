/**
 * pi-codex-micro: Work Louder Codex Micro support for pi.
 *
 * Input side (works without the LED protocol): the Micro's command keys,
 * dial, and joystick are mapped in Work Louder Input to the keystrokes
 * this extension registers as pi shortcuts.
 *
 * Output side: pi lifecycle events drive the device's agent-key LEDs
 * through a DeviceTransport (mock until the HID protocol is discovered,
 * see docs/protocol-discovery.md).
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CONFIG_PATH, loadConfig } from "./config.js";
import { HidTransport } from "./hid-transport.js";
import { MockTransport } from "./mock-transport.js";
import { basename } from "node:path";
import { exec } from "node:child_process";
import { SimConnection } from "./sim.js";
import { SIM_PAGE } from "./sim-page.js";
import type { SimAction } from "./sim-shared.js";
import { AgentStateTracker } from "./state.js";
import { acquireSlot, releaseSlot } from "./slots.js";
import { detectTerminal } from "./terminal.js";
import type { AgentState, DeviceTransport } from "./transport.js";

/** Fans state changes out to the real transport and the simulator. */
class MultiTransport implements DeviceTransport {
  constructor(private readonly targets: DeviceTransport[]) {}
  async connect(): Promise<boolean> {
    const results = await Promise.all(this.targets.map((t) => t.connect()));
    return results.some(Boolean);
  }
  async disconnect(): Promise<void> {
    await Promise.all(this.targets.map((t) => t.disconnect()));
  }
  isConnected(): boolean {
    return this.targets.some((t) => t.isConnected());
  }
  async setAgentState(slot: number, state: AgentState): Promise<void> {
    await Promise.all(this.targets.map((t) => t.setAgentState(slot, state)));
  }
  describe(): string {
    return this.targets.map((t) => t.describe()).join(" | ");
  }
}

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type ThinkingLevel = (typeof THINKING_LEVELS)[number];

const STATE_ICONS: Record<AgentState, string> = {
  idle: "○",
  thinking: "◐",
  complete: "●",
  "needs-input": "◍",
  error: "✕",
};

/** Footer icon color per state, matching the simulator LED palette. */
const STATE_COLORS: Record<AgentState, "dim" | "accent" | "success" | "warning" | "error"> = {
  idle: "dim",
  thinking: "accent",
  complete: "success",
  "needs-input": "warning",
  error: "error",
};

/**
 * Survives /reload and /new so the hub keeps its port and agent keys
 * stay put. Stamped with a build signature: if a reload brings new sim
 * code (page, protocol, routing), the stale connection is torn down
 * and rebuilt so updates actually apply; other sessions rejoin via
 * their reconnect logic.
 */
const SIM_BUILD = `v1.${SIM_PAGE.length}`;
const globalSim = globalThis as { __codexMicroSim?: { sim: SimConnection; build: string } };

export default function (pi: ExtensionAPI) {
  const config = loadConfig();
  const terminal = detectTerminal(process.env, config.focusCommand);
  const surviving = globalSim.__codexMicroSim;
  let sim: SimConnection;
  if (surviving && surviving.build === SIM_BUILD) {
    sim = surviving.sim;
  } else {
    sim = new SimConnection((action) => handleSimAction(action));
    if (surviving) {
      // A reload replaced hub code: re-host after the stale hub stops
      // (upgrade in place). A plain exit still kills the sim for good.
      if (surviving.sim.getMode() === "hub") sim.markPreferHost();
      void surviving.sim.stop().catch(() => {});
    }
  }
  globalSim.__codexMicroSim = { sim, build: SIM_BUILD };
  sim.setActionHandler((action) => handleSimAction(action));
  const device: DeviceTransport =
    config.transport === "hid" ? new HidTransport(config) : new MockTransport();
  const transport: DeviceTransport = new MultiTransport([device, sim]);
  const agentSlot = acquireSlot(config.agentSlot);
  const tracker = new AgentStateTracker(transport, agentSlot);
  let lastAssistantText = "";
  let latestCtx: ExtensionContext | null = null;

  // Direct device-key bindings over the vendor HID channel.
  let joystickArmed = true;
  device.onDeviceEvent?.((event) => {
    if (event.type === "key") {
      // Dial click confirms the joystick menu while it is open.
      if (menuOpen && event.key === "ENC_CLK" && event.act === 1) {
        exec(`${KEYSEND} 36`, () => {});
        return;
      }
      const input = config.deviceKeys[event.key];
      // Dial rotation steps the thinking level, unless overridden.
      if (!input && (event.key === "ENC_CW" || event.key === "ENC_CC")) {
        if (event.act === 2) stepThinking(latestCtx, event.key === "ENC_CW" ? 1 : -1);
        return;
      }
      // Agent keys focus the session that owns the slot, unless the
      // user bound them to something else in deviceKeys.
      if (!input && /^AG0[0-5]$/.test(event.key)) {
        if (event.act === 1 && Number(event.key.slice(2)) === agentSlot) void terminal.focus();
        return;
      }
      if (!input) return;
      // holdexec: run "<cmd> down" on press and "<cmd> up" on release
      // (hold-to-talk style bindings, e.g. dictation hotkeys).
      if (input.startsWith("holdexec:")) {
        if (event.act !== 0 && event.act !== 1) return;
        exec(`${input.slice(9)} ${event.act === 1 ? "down" : "up"}`, (error) => {
          if (error && latestCtx?.hasUI) latestCtx.ui.notify(`deviceKeys[${event.key}] exec failed: ${String(error)}`, "error");
        });
        return;
      }
      if (event.act !== 1 && event.act !== 2) return; // ignore releases
      if (input.startsWith("exec:")) {
        exec(input.slice(5), (error) => {
          if (error && latestCtx?.hasUI) latestCtx.ui.notify(`deviceKeys[${event.key}] exec failed: ${String(error)}`, "error");
        });
      } else {
        pi.sendUserMessage(input, { deliverAs: "followUp" });
      }
      return;
    }
    // Joystick: fire once per deflection, rearm near center.
    if (event.distance < 0.3) {
      joystickArmed = true;
      return;
    }
    if (!joystickArmed || event.distance < 0.9) return;
    joystickArmed = false;
    const a = event.angle;
    const direction: keyof typeof config.joystick =
      a >= 0.875 || a < 0.125 ? "right" : a < 0.375 ? "down" : a < 0.625 ? "left" : "up";
    if (config.joystickMenu.length > 0) {
      // Menu mode: any deflection opens the action menu; while it is
      // open, up/down deflections and the dial click are translated to
      // arrow/enter keystrokes so the stick navigates its own menu.
      if (menuOpen) {
        if (direction === "up" || direction === "down")
          exec(`${KEYSEND} ${direction === "up" ? 126 : 125}`, () => {});
        return;
      }
      void openJoystickMenu();
      return;
    }
    const input = config.joystick[direction];
    if (input) pi.sendUserMessage(input, { deliverAs: "followUp" });
  });

  const KEYSEND = `${process.env.HOME}/.pi/agent/keysend`;
  let menuOpen = false;
  async function openJoystickMenu(): Promise<void> {
    const ctx = latestCtx;
    if (!ctx?.hasUI || menuOpen) return;
    menuOpen = true;
    try {
      const labels = config.joystickMenu.map((item) => item.label);
      const choice = await ctx.ui.select("Codex Micro actions", labels);
      const picked = config.joystickMenu.find((item) => item.label === choice);
      if (picked) pi.sendUserMessage(picked.input, { deliverAs: "followUp" });
    } finally {
      menuOpen = false;
    }
  }

  async function handleSimAction(action: SimAction): Promise<void> {
    switch (action.kind) {
      case "joystick": {
        const input = config.joystick[action.value as keyof typeof config.joystick];
        if (input) pi.sendUserMessage(input, { deliverAs: "followUp" });
        break;
      }
      case "dial":
        stepThinking(latestCtx, action.value === "cw" ? 1 : -1);
        break;
      case "interrupt":
        latestCtx?.abort();
        break;
      case "focus":
        await terminal.focus();
        break;
      case "command": {
        if (action.value === "test") {
          await runLedTest();
        } else if (action.value === "accept") {
          pi.sendUserMessage(config.commandKeys["sim:accept"] ?? "Looks good, proceed.", { deliverAs: "followUp" });
        } else if (action.value === "new") {
          pi.sendUserMessage(config.commandKeys["sim:new"] ?? "/new", { deliverAs: "followUp" });
        }
        break;
      }
      case "key": {
        const input = config.commandKeys[`sim:${action.value}`];
        if (input) pi.sendUserMessage(input, { deliverAs: "followUp" });
        else if (latestCtx?.hasUI) latestCtx.ui.notify(`Sim key ${action.value} unmapped. Set commandKeys["sim:${action.value}"] in codex-micro.json`, "info");
        break;
      }
    }
  }

  async function runLedTest(): Promise<void> {
    const states: AgentState[] = ["idle", "thinking", "needs-input", "complete", "error", "idle"];
    for (const state of states) {
      await tracker.set(state);
      if (latestCtx) showStatus(latestCtx);
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }

  const showStatus = (ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;
    const icon = ctx.ui.theme.fg(STATE_COLORS[tracker.state], STATE_ICONS[tracker.state]);
    ctx.ui.setStatus(
      "codex-micro",
      `micro ${icon} ${tracker.state}${transport.isConnected() ? "" : " (offline)"}`,
    );
  };

  // ── Lifecycle → device LEDs ────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    latestCtx = ctx;
    sim.setIdentity(String(process.pid), basename(ctx.cwd), {
      canFocus: terminal.canFocus,
      terminal: terminal.name,
    });
    await transport.connect();
    await tracker.set("idle");
    // Join the sim mesh automatically: the first interactive session
    // hosts the hub, later ones register as clients on creation.
    // Skip print/json modes so scripted pi runs don't bind ports.
    // Interactive sessions only: print/json runs are transient and
    // should never appear as agent keys or bind the hub port.
    // Sessions JOIN a running sim automatically but never host one;
    // hosting is explicit (/codex-micro sim) or a hub upgrading
    // across /reload. Exiting the hosting pi kills the sim.
    if (ctx.hasUI && config.autoStart) {
      if (sim.consumePreferHost()) await sim.ensure();
      else await sim.probe();
      sim.keepAlive();
    }
    sim.setThinkingLevel(pi.getThinkingLevel());
    showStatus(ctx);
  });

  pi.on("session_shutdown", async (event) => {
    latestCtx = null;
    await tracker.set("idle").catch(() => {});
    releaseSlot(agentSlot);
    await device.disconnect().catch(() => {});
    // Only tear the sim down when pi actually exits. /new, /resume,
    // /fork, and /reload replace the extension instance in the same
    // process; the connection lives on globalThis and carries over,
    // so the hub keeps the port and agent keys stay put.
    if (event.reason === "quit") {
      // Belt and braces: never let sim teardown block pi's exit. The
      // server dies with the process regardless.
      await Promise.race([
        sim.stop(),
        new Promise<void>((resolve) => setTimeout(resolve, 1500).unref()),
      ]).catch(() => {});
      globalSim.__codexMicroSim = undefined;
    }
  });

  pi.on("model_select", async (event) => {
    sim.setModelName(`${event.model.provider}/${event.model.id}`);
  });

  pi.on("thinking_level_select", async (event) => {
    sim.setThinkingLevel(event.level);
  });

  pi.on("agent_start", async (_event, ctx) => {
    latestCtx = ctx;
    lastAssistantText = "";
    await tracker.onRunStart();
    showStatus(ctx);
  });

  pi.on("message_end", async (event) => {
    if (event.message.role !== "assistant") return;
    const text = event.message.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    if (text.trim()) lastAssistantText = text.trim();
    if (event.message.stopReason === "error") tracker.markError();
  });

  pi.on("tool_execution_end", async (event) => {
    // Tool errors alone should not latch the error LED; a run that
    // recovers still settles as complete. Only track aborted/fatal runs.
    void event;
  });

  pi.on("agent_settled", async (_event, ctx) => {
    const askedQuestion = /\?\s*$/.test(lastAssistantText);
    await tracker.onRunSettled(askedQuestion);
    showStatus(ctx);
  });

  pi.on("input", async (_event, ctx) => {
    // User is typing/answering: needs-input and complete resolve to thinking soon;
    // clear stale "complete"/"needs-input" glow on new input.
    if (tracker.state === "needs-input" || tracker.state === "complete") {
      await tracker.set("idle");
      showStatus(ctx);
    }
    return { action: "continue" };
  });

  // ── Dial: thinking level ───────────────────────────────────────────

  const stepThinking = (ctx: ExtensionContext | null, direction: 1 | -1) => {
    const current = pi.getThinkingLevel() as ThinkingLevel;
    const index = THINKING_LEVELS.indexOf(current);
    const next = THINKING_LEVELS[Math.min(THINKING_LEVELS.length - 1, Math.max(0, index + direction))];
    if (next !== current) pi.setThinkingLevel(next);
    if (ctx?.hasUI) ctx.ui.notify(`thinking: ${next}`, "info");
  };

  pi.registerShortcut("ctrl+alt+=", {
    description: "Codex Micro dial: thinking level up",
    handler: async (ctx) => stepThinking(ctx, 1),
  });

  pi.registerShortcut("ctrl+alt+-", {
    description: "Codex Micro dial: thinking level down",
    handler: async (ctx) => stepThinking(ctx, -1),
  });

  // ── Joystick: 4 skill/prompt slots ─────────────────────────────────

  type ShortcutKey = Parameters<ExtensionAPI["registerShortcut"]>[0];

  const joystick: Array<{ key: ShortcutKey; direction: keyof typeof config.joystick }> = [
    { key: "ctrl+alt+i", direction: "up" },
    { key: "ctrl+alt+k", direction: "down" },
    { key: "ctrl+alt+j", direction: "left" },
    { key: "ctrl+alt+l", direction: "right" },
  ];

  for (const { key, direction } of joystick) {
    pi.registerShortcut(key, {
      description: `Codex Micro joystick ${direction}`,
      handler: async (ctx) => {
        const input = config.joystick[direction];
        if (!input) return;
        if (ctx.hasUI) ctx.ui.notify(`joystick ${direction}: ${input}`, "info");
        pi.sendUserMessage(input, { deliverAs: "followUp" });
      },
    });
  }

  // ── Custom command keys from config ────────────────────────────────

  for (const [shortcut, input] of Object.entries(config.commandKeys)) {
    pi.registerShortcut(shortcut as ShortcutKey, {
      description: `Codex Micro command key: ${input}`,
      handler: async () => {
        pi.sendUserMessage(input, { deliverAs: "followUp" });
      },
    });
  }

  // ── /codex-micro command ───────────────────────────────────────────

  pi.registerCommand("codex-micro", {
    description: "Codex Micro: status | sim | sim stop | connect | disconnect | test",
    handler: async (args, ctx) => {
      latestCtx = ctx;
      const sub = (args ?? "").trim() || "status";
      switch (sub) {
        case "sim": {
          const mode = await sim.ensure();
          await sim.setAgentState(agentSlot, tracker.state);
          sim.setThinkingLevel(pi.getThinkingLevel());
          if (mode === "hub") {
            await pi.exec("open", [sim.url()]).catch(() => {});
            ctx.ui.notify(`Simulator running at ${sim.url()}`, "info");
          } else if (mode === "client") {
            ctx.ui.notify(`Joined simulator at ${sim.url()} (hosted by another pi session)`, "info");
          } else {
            ctx.ui.notify("Could not start or join the simulator (all agent keys in use?)", "error");
          }
          break;
        }
        case "sim stop": {
          await sim.stop();
          ctx.ui.notify("Simulator stopped", "info");
          break;
        }
        case "leave": {
          // Drop this session off the sim mesh without touching the
          // device transport. If it was hosting, another session takes
          // over the port via its reconnect logic.
          await sim.leave();
          ctx.ui.notify("Left the simulator mesh (/codex-micro join to rejoin)", "info");
          showStatus(ctx);
          break;
        }
        case "join": {
          const joined = await sim.ensure();
          sim.keepAlive();
          ctx.ui.notify(
            joined === "off" ? "Could not join the mesh" : `Joined the mesh as ${joined}`,
            joined === "off" ? "error" : "info",
          );
          showStatus(ctx);
          break;
        }
        case "status": {
          const lines = [
            `transport: ${transport.describe()}`,
            `state: ${tracker.state}`,
            `agent slot: ${agentSlot}`,
            `config: ${CONFIG_PATH} (${config.transport})`,
          ];
          ctx.ui.notify(lines.join("\n"), "info");
          break;
        }
        case "connect": {
          const ok = await transport.connect();
          ctx.ui.notify(ok ? "Codex Micro connected" : `Connect failed: ${transport.describe()}`, ok ? "info" : "error");
          showStatus(ctx);
          break;
        }
        case "disconnect": {
          await transport.disconnect();
          ctx.ui.notify("Codex Micro disconnected", "info");
          showStatus(ctx);
          break;
        }
        case "test": {
          await runLedTest();
          ctx.ui.notify(`LED test cycled. Transport: ${transport.describe()}`, "info");
          break;
        }
        default:
          ctx.ui.notify(`Unknown subcommand: ${sub}. Use status | sim | sim stop | connect | disconnect | test`, "error");
      }
    },
  });
}
