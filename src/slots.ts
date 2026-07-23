/**
 * Agent-key slot registry: assigns each pi session its own of the six
 * agent keys. Lock files under ~/.pi/agent/codex-micro-slots/ hold the
 * owning pid; stale locks (dead pids) are reclaimed. Sessions prefer
 * config.agentSlot but fall back to the lowest free slot.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SLOT_DIR = join(homedir(), ".pi", "agent", "codex-micro-slots");
const SLOT_COUNT = 6;

function slotPath(slot: number): string {
  return join(SLOT_DIR, `${slot}.pid`);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function ownerOf(slot: number): number | null {
  try {
    const pid = Number(readFileSync(slotPath(slot), "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** Claim a slot for this process. Prefers `preferred`, else lowest free. */
export function acquireSlot(preferred: number): number {
  mkdirSync(SLOT_DIR, { recursive: true });
  const order = [preferred, ...Array.from({ length: SLOT_COUNT }, (_, i) => i)];
  for (const slot of order) {
    if (slot < 0 || slot >= SLOT_COUNT) continue;
    const owner = ownerOf(slot);
    if (owner === process.pid) return slot;
    if (owner !== null && isAlive(owner)) continue;
    writeFileSync(slotPath(slot), String(process.pid), "utf8");
    // Re-read to survive two sessions racing for the same slot.
    if (ownerOf(slot) === process.pid) return slot;
  }
  return preferred; // all six taken: share the preferred slot
}

/** Release this process's slot (session shutdown). */
export function releaseSlot(slot: number): void {
  if (ownerOf(slot) === process.pid && existsSync(slotPath(slot))) {
    try {
      rmSync(slotPath(slot));
    } catch {
      // best effort
    }
  }
}
