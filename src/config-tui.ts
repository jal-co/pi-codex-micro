/**
 * /codex-micro config: interactive editor for codex-micro.json built
 * on pi's dialog primitives (select / input / confirm). Edits are
 * written back to CONFIG_PATH; a /reload applies them.
 */

import { readFileSync, writeFileSync } from "node:fs";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CONFIG_PATH, DEFAULT_CONFIG, type MicroConfig } from "./config.js";

const BINDABLE_KEYS = [
  "ACT06", "ACT07", "ACT08", "ACT09", "ACT10", "ACT11", "ACT12",
  "ENC_CW", "ENC_CC", "ENC_CLK",
  "AG00", "AG01", "AG02", "AG03", "AG04", "AG05",
];

type RawConfig = Partial<MicroConfig> & Record<string, unknown>;

function readRaw(): RawConfig {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as RawConfig;
  } catch {
    return {};
  }
}

function save(raw: RawConfig): void {
  writeFileSync(CONFIG_PATH, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
}

function describeBinding(value: string | undefined): string {
  if (!value) return "unbound";
  if (value.startsWith("holdexec:")) return `hold-run: ${value.slice(9)}`;
  if (value.startsWith("exec:")) return `run: ${value.slice(5)}`;
  return `send: ${value}`;
}

export async function runConfigTui(ctx: ExtensionContext): Promise<boolean> {
  if (!ctx.hasUI) return false;
  const raw = readRaw();
  let dirty = false;

  for (;;) {
    const choice = await ctx.ui.select("Codex Micro config", [
      "Device keys",
      "Joystick menu",
      "Joystick directions",
      "Preferred agent slot",
      dirty ? "Save and exit" : "Exit",
    ]);
    if (choice === undefined || choice === "Exit") return false;
    if (choice === "Save and exit") {
      save(raw);
      return true;
    }

    if (choice === "Device keys") {
      const keys = { ...DEFAULT_CONFIG.deviceKeys, ...(raw.deviceKeys ?? {}) };
      const key = await ctx.ui.select(
        "Bind which key?",
        BINDABLE_KEYS.map((k) => `${k} — ${describeBinding(keys[k])}`),
      );
      if (!key) continue;
      const keyId = key.split(" ")[0];
      const kind = await ctx.ui.select(`${keyId}: bind to`, [
        "Send text to pi",
        "Run shell command",
        "Hold-run command (down/up)",
        "Unbind",
        "Back",
      ]);
      if (!kind || kind === "Back") continue;
      const deviceKeys = (raw.deviceKeys ?? {}) as Record<string, string>;
      if (kind === "Unbind") {
        deviceKeys[keyId] = "";
      } else {
        const prompts: Record<string, string> = {
          "Send text to pi": "Text or /command to send:",
          "Run shell command": "Shell command to run on press:",
          "Hold-run command (down/up)": "Command (called with 'down'/'up'):",
        };
        const value = await ctx.ui.input(prompts[kind], "");
        if (!value) continue;
        deviceKeys[keyId] =
          kind === "Run shell command" ? `exec:${value}` : kind === "Hold-run command (down/up)" ? `holdexec:${value}` : value;
      }
      raw.deviceKeys = deviceKeys;
      dirty = true;
      continue;
    }

    if (choice === "Joystick menu") {
      const menu = [...(raw.joystickMenu ?? DEFAULT_CONFIG.joystickMenu)];
      const pick = await ctx.ui.select("Joystick menu entries", [
        ...menu.map((m, i) => `${i + 1}. ${m.label}`),
        "+ Add entry",
        menu.length > 0 ? "- Remove entry" : "Back",
        "Back",
      ]);
      if (!pick || pick === "Back") continue;
      if (pick === "+ Add entry") {
        const label = await ctx.ui.input("Menu label:", "");
        if (!label) continue;
        const input = await ctx.ui.input("Text or /command it sends:", "");
        if (!input) continue;
        menu.push({ label, input });
      } else if (pick === "- Remove entry") {
        const target = await ctx.ui.select("Remove which?", menu.map((m, i) => `${i + 1}. ${m.label}`));
        if (!target) continue;
        menu.splice(Number(target.split(".")[0]) - 1, 1);
      } else {
        const index = Number(pick.split(".")[0]) - 1;
        const input = await ctx.ui.input(`New action for "${menu[index].label}":`, menu[index].input);
        if (!input) continue;
        menu[index] = { ...menu[index], input };
      }
      raw.joystickMenu = menu;
      dirty = true;
      continue;
    }

    if (choice === "Joystick directions") {
      const joystick = { ...DEFAULT_CONFIG.joystick, ...(raw.joystick ?? {}) };
      const direction = await ctx.ui.select(
        "Which direction? (used when joystickMenu is empty)",
        (Object.keys(joystick) as Array<keyof typeof joystick>).map((d) => `${d} — ${joystick[d]}`),
      );
      if (!direction) continue;
      const dir = direction.split(" ")[0] as keyof typeof joystick;
      const input = await ctx.ui.input(`Joystick ${dir} sends:`, joystick[dir]);
      if (!input) continue;
      raw.joystick = { ...joystick, [dir]: input };
      dirty = true;
      continue;
    }

    if (choice === "Preferred agent slot") {
      const slot = await ctx.ui.select("Preferred agent key (auto-assigned if taken)", ["0", "1", "2", "3", "4", "5"]);
      if (slot === undefined) continue;
      raw.agentSlot = Number(slot);
      dirty = true;
    }
  }
}
