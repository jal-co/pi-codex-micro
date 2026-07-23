/**
 * Standalone Codex Micro daemon: keeps exec-style key bindings (fn
 * mic, keystroke keys) working when no pi session is running. Skips
 * all events while any live pi session holds an agent slot, so the
 * extension and daemon never double-fire. Run via launchd (see
 * scripts/install-daemon.sh) or `npm run daemon`.
 */

import { exec } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { HidTransport } from "../src/hid-transport.ts";
import { loadConfig } from "../src/config.ts";

const SLOT_DIR = join(homedir(), ".pi", "agent", "codex-micro-slots");

function piSessionAlive(): boolean {
  try {
    for (const file of readdirSync(SLOT_DIR)) {
      if (!file.endsWith(".pid")) continue;
      const pid = Number(readFileSync(join(SLOT_DIR, file), "utf8").trim());
      if (!Number.isInteger(pid) || pid <= 0) continue;
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EPERM") return true;
      }
    }
  } catch {
    // no slot dir yet
  }
  return false;
}

const config = loadConfig();
const transport = new HidTransport(config);

transport.onDeviceEvent((event) => {
  if (event.type !== "key") return;
  if (piSessionAlive()) return; // a pi session owns the keys right now
  const input = config.deviceKeys[event.key];
  if (!input) return;
  if (input.startsWith("holdexec:")) {
    if (event.act !== 0 && event.act !== 1) return;
    exec(`${input.slice(9)} ${event.act === 1 ? "down" : "up"}`, () => {});
    return;
  }
  if (event.act !== 1 && event.act !== 2) return;
  if (input.startsWith("exec:")) exec(input.slice(5), () => {});
  // Plain text bindings need a pi session; nothing to send them to.
});

async function run(): Promise<void> {
  for (;;) {
    if (!transport.isConnected()) {
      const ok = await transport.connect();
      console.log(new Date().toISOString(), ok ? "connected" : `waiting for device (${transport.describe()})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

void run();
