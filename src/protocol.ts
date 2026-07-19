/**
 * Codex Micro HID protocol constants.
 *
 * STATUS: PLACEHOLDER. The Codex Micro is not in hand yet and the
 * state-LED protocol is undocumented. Work Louder's previous boards
 * (Creator Micro, Nomad) are QMK-based and expose a raw HID interface
 * on the standard QMK/VIA usage page. The values below are the best
 * guess to be validated with docs/protocol-discovery.md once the
 * device arrives.
 */

import type { AgentState } from "./transport.js";

/** Work Louder USB vendor ID (0x574C = "WL"). Verify with `hidutil list`. */
export const VENDOR_ID = 0x574c;

/** Unknown until the device arrives. 0 = match any Work Louder product. */
export const PRODUCT_ID = 0x0000;

/** QMK raw HID interface (VIA-compatible boards). */
export const USAGE_PAGE = 0xff60;
export const USAGE = 0x61;

/** QMK raw HID reports are 32 bytes + report ID. */
export const REPORT_SIZE = 32;

/**
 * Placeholder command byte for "set agent key state".
 * QMK reserves 0x00-0xFF; VIA uses low values, so custom user commands
 * typically sit in the 0x50+ range. TO BE DISCOVERED.
 */
export const CMD_SET_AGENT_STATE = 0x50;

/** Placeholder state codes matching the marketing states. TO BE DISCOVERED. */
export const STATE_CODES: Record<AgentState, number> = {
  idle: 0x00,
  thinking: 0x01,
  complete: 0x02,
  "needs-input": 0x03,
  error: 0x04,
};

/** Build a raw HID report for a state change. Format is a placeholder. */
export function buildAgentStateReport(slot: number, state: AgentState): number[] {
  const report = new Array<number>(REPORT_SIZE + 1).fill(0);
  report[0] = 0x00; // report ID
  report[1] = CMD_SET_AGENT_STATE;
  report[2] = slot & 0xff;
  report[3] = STATE_CODES[state];
  return report;
}
