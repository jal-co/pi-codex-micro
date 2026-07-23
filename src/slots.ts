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

function statePath(slot: number): string {
  return join(SLOT_DIR, `${slot}.state`);
}

/** Publish a slot's agent state so the macropad app can mirror its
 * indicator color. Best effort; never throws into the caller. */
export function writeSlotState(slot: number, state: string): void {
  try {
    mkdirSync(SLOT_DIR, { recursive: true });
    writeFileSync(statePath(slot), state, "utf8");
  } catch {
    // best effort
  }
}

/** Remove a slot's published state (session end / light cleared). */
export function clearSlotState(slot: number): void {
  try {
    if (existsSync(statePath(slot))) rmSync(statePath(slot));
  } catch {
    // best effort
  }
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

/** Slots whose lock file points at a dead pid (lights may be stuck). */
export function staleSlots(): number[] {
  const stale: number[] = [];
  for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
    const owner = ownerOf(slot);
    if (owner !== null && !isAlive(owner)) stale.push(slot);
  }
  return stale;
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
