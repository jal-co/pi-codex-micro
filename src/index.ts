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
import { SimConnection } from "./sim.js";
import type { SimAction } from "./sim-shared.js";
import { AgentStateTracker } from "./state.js";
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

export default function (pi: ExtensionAPI) {
  const config = loadConfig();
  const sim = new SimConnection((action) => handleSimAction(action));
  const device: DeviceTransport =
    config.transport === "hid" ? new HidTransport(config) : new MockTransport();
  const transport: DeviceTransport = new MultiTransport([device, sim]);
  const tracker = new AgentStateTracker(transport, config.agentSlot);
  let lastAssistantText = "";
  let latestCtx: ExtensionContext | null = null;

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
    ctx.ui.setStatus(
      "codex-micro",
      `micro ${STATE_ICONS[tracker.state]} ${tracker.state}${transport.isConnected() ? "" : " (offline)"}`,
    );
  };

  // ── Lifecycle → device LEDs ────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    latestCtx = ctx;
    sim.setIdentity(String(process.pid), basename(ctx.cwd));
    await transport.connect();
    await tracker.set("idle");
    // Auto-join a running simulator so every zentty pane shows up
    // on the page without needing /codex-micro sim in each one.
    await sim.probe();
    sim.setThinkingLevel(pi.getThinkingLevel());
    showStatus(ctx);
  });

  pi.on("session_shutdown", async () => {
    latestCtx = null;
    await tracker.set("idle").catch(() => {});
    await transport.disconnect().catch(() => {});
    await sim.stop().catch(() => {});
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
          await sim.setAgentState(config.agentSlot, tracker.state);
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
        case "status": {
          const lines = [
            `transport: ${transport.describe()}`,
            `state: ${tracker.state}`,
            `agent slot: ${config.agentSlot}`,
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
