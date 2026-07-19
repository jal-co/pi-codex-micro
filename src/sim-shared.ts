/**
 * Wire types shared by the sim hub, sim client, and browser page.
 */

import type { AgentState } from "./transport.js";

/** Fixed hub port so every pi session and the browser find each other. */
export const SIM_PORT = 7327;

/** The device has four agent keys. */
export const SLOT_COUNT = 4;

export interface SimAction {
  kind: "joystick" | "dial" | "command" | "interrupt" | "key";
  /** joystick: up/down/left/right. dial: cw/ccw. command/key: identifier. */
  value?: string;
  /** Which registered session the action targets. */
  sessionId?: string;
}

export interface SessionSnapshot {
  id: string;
  name: string;
  slot: number;
  state: AgentState;
  thinking: string;
  model: string;
}

/** SSE payloads pushed to the browser. */
export type BrowserEvent =
  | { type: "hello" }
  | { type: "sessions"; sessions: SessionSnapshot[] };

export interface RegisterRequest {
  id: string;
  name: string;
}

export interface StateRequest {
  id: string;
  state: AgentState;
}

export interface MetaRequest {
  id: string;
  thinking?: string;
  model?: string;
}
