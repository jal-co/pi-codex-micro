/**
 * Frontmost-app detection for focus-based key ownership. When the pi
 * host terminal is frontmost the extension owns the Codex Micro keys;
 * when any other app is frontmost the background daemon owns them.
 *
 * Reads a compiled `frontapp` helper (scripts/frontapp.swift ->
 * ~/.pi/agent/frontapp). Results are cached briefly so bursts of HID
 * events (mic down/up, joystick spam) don't spawn a process each time.
 */

import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const FRONTAPP = join(homedir(), ".pi", "agent", "frontapp");
const CACHE_MS = 400;

let cachedBundle = "";
let cachedAt = 0;
let inflight: Promise<string> | null = null;

function queryFrontmost(): Promise<string> {
  if (inflight) return inflight;
  inflight = new Promise<string>((resolve) => {
    execFile(FRONTAPP, (error, stdout) => {
      inflight = null;
      if (error) {
        resolve(cachedBundle); // keep last known on failure
        return;
      }
      cachedBundle = stdout.trim();
      cachedAt = Date.now();
      resolve(cachedBundle);
    });
  });
  return inflight;
}

/** Bundle id of the frontmost app (cached up to CACHE_MS). */
export async function frontmostBundle(): Promise<string> {
  if (Date.now() - cachedAt < CACHE_MS) return cachedBundle;
  return queryFrontmost();
}

/** True when the given host terminal bundle id is frontmost. */
export async function isHostFrontmost(hostBundleId: string): Promise<boolean> {
  return (await frontmostBundle()) === hostBundleId;
}
