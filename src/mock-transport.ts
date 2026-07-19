/**
 * Mock transport used until the hardware arrives (or for testing).
 * Records state changes so /codex-micro status can show what would
 * have been sent to the device.
 */

import type { AgentState, DeviceTransport } from "./transport.js";

export class MockTransport implements DeviceTransport {
  private connected = false;
  readonly history: Array<{ slot: number; state: AgentState; at: number }> = [];

  async connect(): Promise<boolean> {
    this.connected = true;
    return true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async setAgentState(slot: number, state: AgentState): Promise<void> {
    this.history.push({ slot, state, at: Date.now() });
    if (this.history.length > 50) this.history.shift();
  }

  describe(): string {
    const last = this.history.at(-1);
    return last
      ? `mock (last: slot ${last.slot} -> ${last.state})`
      : "mock (no state changes yet)";
  }
}
