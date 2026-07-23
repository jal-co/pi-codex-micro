/**
 * Codex Micro HID protocol.
 *
 * Verified against real hardware (USB enumeration) and the protocol
 * notes in https://github.com/imliubo/codex-micro-4-core2 (observed
 * vendor wire format, docs/TECHNICAL.md).
 *
 * Transport: vendor-defined HID collection, report ID 6, 63-byte
 * report body framed as [type=0x02, payloadLen, ...utf8 JSON chunk]
 * zero-padded. JSON messages are newline-terminated JSON-RPC-like
 * objects split across fragments of at most 61 bytes.
 *
 * Host -> device `v.oai.thstatus` sets the six agent status lights:
 * params is an array of { id, c (24-bit RGB), b (brightness 0.0-1.0),
 * e (effect enum: off=0, solid=1, snake=2, rainbow=3, breath=4,
 * gradient=5, shallowBreath=6), s (speed 0.0-1.0), sk/sa (sync keys/
 * ambient flags) }. RPC ids must stay in 0..999 (firmware constraint).
 * Field semantics per DevVig/microbridge docs/device-hid.md (mined from
 * ChatGPT Desktop's @worklouder/wl-device-kit).
 */

import type { AgentState } from "./transport.js";

/** USB vendor ID observed on hardware (Espressif-allocated). */
export const VENDOR_ID = 0x303a;

/** USB product ID observed on hardware. */
export const PRODUCT_ID = 0x8360;

/** Vendor-defined usage page / application usage. */
export const USAGE_PAGE = 0xff00;
export const USAGE = 0x01;

/** Report ID for the vendor collection. */
export const REPORT_ID = 6;

/** Report body size (excludes report ID). */
export const REPORT_SIZE = 63;

/** Max JSON payload bytes per fragment. */
export const FRAGMENT_SIZE = REPORT_SIZE - 2;

/** Frame type byte currently in use. */
export const FRAME_TYPE = 0x02;

/** Effect enum values (firmware). */
export const EFFECT = { off: 0, solid: 1, snake: 2, rainbow: 3, breath: 4, gradient: 5, shallowBreath: 6 } as const;

/** Per-state light config sent via v.oai.thstatus. */
export const STATE_LIGHTS: Record<AgentState, { c: number; b: number; e: number }> = {
  idle: { c: 0x000000, b: 0, e: EFFECT.off },
  thinking: { c: 0x8b5cf6, b: 1, e: EFFECT.breath },
  complete: { c: 0x22c55e, b: 1, e: EFFECT.solid },
  "needs-input": { c: 0xf59e0b, b: 1, e: EFFECT.breath },
  error: { c: 0xef4444, b: 1, e: EFFECT.solid },
};

let rpcId = 0;

/** Frame a JSON-RPC message into HID write buffers (report ID first). */
export function frameMessage(message: object): number[][] {
  const json = Buffer.from(`${JSON.stringify(message)}\n`, "utf8");
  const reports: number[][] = [];
  for (let offset = 0; offset < json.length; offset += FRAGMENT_SIZE) {
    const chunk = json.subarray(offset, offset + FRAGMENT_SIZE);
    const body = new Array<number>(REPORT_SIZE + 1).fill(0);
    body[0] = REPORT_ID;
    body[1] = FRAME_TYPE;
    body[2] = chunk.length;
    for (let i = 0; i < chunk.length; i += 1) body[3 + i] = chunk[i];
    reports.push(body);
  }
  return reports;
}

/** Build the framed reports for an agent-state light change. */
export function buildAgentStateReports(slot: number, state: AgentState): number[][] {
  const light = STATE_LIGHTS[state];
  rpcId = (rpcId + 1) % 1000;
  return frameMessage({
    method: "v.oai.thstatus",
    params: [{ id: slot, c: light.c, b: light.b, e: light.e, s: 0.5 }],
    id: rpcId,
  });
}
