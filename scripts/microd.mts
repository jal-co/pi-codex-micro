/**
 * Standalone Codex Micro daemon: turns the pad into a system-wide
 * macropad. It owns the keys whenever the pi host terminal (Zentty)
 * is NOT frontmost; when Zentty is frontmost the pi extension owns
 * them, so the two never double-fire. Bindings come from globalKeys
 * (falling back to exec/holdexec entries in deviceKeys). Run via
 * launchd (scripts/install-daemon.sh) or `npm run daemon`.
 */

import { exec, execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { HidTransport } from "../src/hid-transport.ts";
import { loadConfig } from "../src/config.ts";

const FRONTAPP = join(homedir(), ".pi", "agent", "frontapp");

let frontBundle = "";
function refreshFront(): void {
  execFile(FRONTAPP, (error, stdout) => {
    if (!error) frontBundle = stdout.trim();
  });
}
refreshFront();
setInterval(refreshFront, 300).unref();

const config = loadConfig();
const transport = new HidTransport(config);

function bindingFor(key: string): string | undefined {
  const g = config.globalKeys[key];
  if (g) return g;
  const d = config.deviceKeys[key];
  // Only exec/holdexec bindings make sense with no pi to receive text.
  return d && (d.startsWith("exec:") || d.startsWith("holdexec:")) ? d : undefined;
}

transport.onDeviceEvent((event) => {
  if (event.type !== "key") return;
  // Zentty frontmost -> the pi extension owns the keys; stay out.
  if (frontBundle === config.hostBundleId) return;
  const input = bindingFor(event.key);
  if (!input) return;
  if (input.startsWith("holdexec:")) {
    if (event.act !== 0 && event.act !== 1) return;
    exec(`${input.slice(9)} ${event.act === 1 ? "down" : "up"}`, () => {});
    return;
  }
  if (event.act !== 1 && event.act !== 2) return;
  if (input.startsWith("exec:")) exec(input.slice(5), () => {});
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
