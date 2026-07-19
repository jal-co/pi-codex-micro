/**
 * Terminal adapters for pane focusing.
 *
 * Each pi session detects its own terminal from the environment at
 * startup and executes its own focus command when the simulator (or,
 * later, the physical device) asks to jump to it. The hub never needs
 * to know which terminal a session lives in, so mixed setups (a zentty
 * window here, a tmux session there) work by construction.
 */

import { execFile } from "node:child_process";

export interface TerminalFocus {
  /** Short name shown in the sim tooltip ("zentty", "tmux", ...). */
  name: string;
  /** Whether focus() can actually bring this pane forward. */
  canFocus: boolean;
  focus(): Promise<void>;
}

function run(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(command, args, (error) => resolve(!error));
  });
}

/** Bring the hosting terminal app itself forward (macOS). */
async function activateApp(appName: string | null): Promise<void> {
  if (process.platform !== "darwin" || !appName) return;
  await run("open", ["-a", appName]);
}

/** Map TERM_PROGRAM to a macOS app name for activation. */
function appNameFromEnv(env: NodeJS.ProcessEnv): string | null {
  const program = env.TERM_PROGRAM ?? "";
  const map: Record<string, string> = {
    "zentty": "Zentty",
    "iTerm.app": "iTerm",
    "Apple_Terminal": "Terminal",
    "WezTerm": "WezTerm",
    "ghostty": "Ghostty",
    "kitty": "kitty",
    "vscode": "Visual Studio Code",
    "Tabby": "Tabby",
    "Hyper": "Hyper",
    "WarpTerminal": "Warp",
  };
  return map[program] ?? (program || null);
}

export function detectTerminal(
  env: NodeJS.ProcessEnv = process.env,
  focusCommand?: string[],
): TerminalFocus {
  const appName = appNameFromEnv(env);

  // 1. User-supplied override always wins.
  if (focusCommand && focusCommand.length > 0) {
    const [command, ...args] = focusCommand;
    return {
      name: "custom",
      canFocus: true,
      focus: async () => {
        await run(command, args);
        await activateApp(appName);
      },
    };
  }

  // 2. Terminals with a real pane-focus API.
  if (env.ZENTTY_PANE_ID) {
    const bin = env.ZENTTY_CLI_BIN ?? "zentty";
    const args = ["pane", "focus", "--pane-id", env.ZENTTY_PANE_ID];
    if (env.ZENTTY_WINDOW_ID) args.push("--window-id", env.ZENTTY_WINDOW_ID);
    return {
      name: "zentty",
      canFocus: true,
      focus: async () => {
        await run(bin, args);
        await activateApp("Zentty");
      },
    };
  }

  if (env.TMUX && env.TMUX_PANE) {
    const pane = env.TMUX_PANE;
    return {
      name: "tmux",
      canFocus: true,
      focus: async () => {
        await run("tmux", ["select-window", "-t", pane]);
        await run("tmux", ["select-pane", "-t", pane]);
        await run("tmux", ["switch-client", "-t", pane]);
        await activateApp(appName);
      },
    };
  }

  if (env.WEZTERM_PANE) {
    const pane = env.WEZTERM_PANE;
    return {
      name: "wezterm",
      canFocus: true,
      focus: async () => {
        await run("wezterm", ["cli", "activate-pane", "--pane-id", pane]);
        await activateApp("WezTerm");
      },
    };
  }

  if (env.KITTY_WINDOW_ID) {
    const id = env.KITTY_WINDOW_ID;
    return {
      name: "kitty",
      canFocus: true,
      focus: async () => {
        // Requires allow_remote_control in kitty.conf.
        await run("kitten", ["@", "focus-window", "--match", `id:${id}`]);
        await activateApp("kitty");
      },
    };
  }

  // 3. No pane API: activate the app so at least the right terminal
  //    comes forward.
  if (appName) {
    return {
      name: (env.TERM_PROGRAM ?? "terminal").toLowerCase().replace(/\.app$/, ""),
      canFocus: process.platform === "darwin",
      focus: () => activateApp(appName),
    };
  }

  return { name: "unknown", canFocus: false, focus: async () => {} };
}
