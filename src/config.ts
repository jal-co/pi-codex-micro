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
  /**
   * Joystick action menu. When non-empty, deflecting the joystick opens
   * a select menu of these actions instead of firing the directional
   * bindings; navigate with the joystick, confirm with the dial click.
   * Set to [] to restore direct directional bindings.
   */
  joystickMenu: Array<{ label: string; input: string }>;
  /** Extra command keys -> pi input to send (keyed by shortcut). */
  commandKeys: Record<string, string>;
  /**
   * Direct device-key bindings (vendor HID events, no Work Louder
   * Input needed). Keys: AG00-AG05, ACT06-ACT12, ENC_CW, ENC_CC,
   * ENC_CLK. Values: pi input to send, "exec:<shell command>" to run
   * a command on press, or "holdexec:<cmd>" to run "<cmd> down" on
   * press and "<cmd> up" on release (hold-to-talk bindings).
   */
  deviceKeys: Record<string, string>;
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
  joystickMenu: [
    { label: "Continue where you left off", input: "Continue where you left off." },
    { label: "Review latest changes", input: "Review my latest changes and point out problems." },
    { label: "Commit the work", input: "/skill:git commit the current work" },
    { label: "Explain what you're doing", input: "Explain what you're currently doing and what's left." },
    { label: "New session", input: "/new" },
  ],
  deviceKeys: {
    // Big mic key: hold the fn/globe key while pressed (Wispr Flow
    // hold-to-talk). Compile scripts/fnkey.swift to ~/.pi/agent/fnkey.
    ACT10: `holdexec:${join(homedir(), ".pi", "agent", "fnkey")}`,
    // Approve/deny answer pi's select dialogs via keystrokes:
    // Enter accepts the highlighted YES; Down+Enter selects NO.
    // Compile scripts/keysend.swift to ~/.pi/agent/keysend.
    ACT07: `exec:${join(homedir(), ".pi", "agent", "keysend")} 36`,
    ACT08: `exec:${join(homedir(), ".pi", "agent", "keysend")} 125 36`,
  },
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
      deviceKeys: { ...DEFAULT_CONFIG.deviceKeys, ...raw.deviceKeys },
      joystickMenu: raw.joystickMenu ?? DEFAULT_CONFIG.joystickMenu,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export const CONFIG_PATH = join(homedir(), ".pi", "agent", "codex-micro.json");
