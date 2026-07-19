/**
 * User configuration, loaded from ~/.pi/agent/codex-micro.json.
 * All fields optional; defaults below.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PRODUCT_ID, USAGE, USAGE_PAGE, VENDOR_ID } from "./protocol.js";

export interface MicroConfig {
  /** "hid" once hardware works, "mock" until then. */
  transport: "hid" | "mock";
  vendorId: number;
  productId: number;
  usagePage: number;
  usage: number;
  /** Which agent key slot this pi instance lights up (0-based). */
  agentSlot: number;
  /**
   * Join the simulator mesh automatically at session start. The first
   * session hosts the hub; the rest connect as clients. /codex-micro
   * sim then only opens the browser page. Set false to opt out.
   */
  autoStart: boolean;
  /**
   * Joystick directions -> pi input to send. Values are sent as user
   * messages, so slash commands, /skill:name, and plain prompts all work.
   */
  joystick: { up: string; down: string; left: string; right: string };
  /** Extra command keys -> pi input to send (keyed by shortcut). */
  commandKeys: Record<string, string>;
  /**
   * Custom pane-focus command as an argv array, overriding terminal
   * auto-detection. Example: ["tmux", "select-pane", "-t", "%3"].
   */
  focusCommand?: string[];
}

export const DEFAULT_CONFIG: MicroConfig = {
  transport: "mock",
  vendorId: VENDOR_ID,
  productId: PRODUCT_ID,
  usagePage: USAGE_PAGE,
  usage: USAGE,
  agentSlot: 0,
  autoStart: true,
  joystick: {
    up: "/skill:impeccable",
    down: "/skill:git",
    left: "Review my latest changes and point out problems.",
    right: "Continue where you left off.",
  },
  commandKeys: {},
};

export function loadConfig(): MicroConfig {
  const path = join(homedir(), ".pi", "agent", "codex-micro.json");
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<MicroConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...raw,
      joystick: { ...DEFAULT_CONFIG.joystick, ...raw.joystick },
      commandKeys: { ...DEFAULT_CONFIG.commandKeys, ...raw.commandKeys },
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export const CONFIG_PATH = join(homedir(), ".pi", "agent", "codex-micro.json");
