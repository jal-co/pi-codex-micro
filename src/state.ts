/**
 * Maps pi session lifecycle to Codex Micro agent-key states.
 */

import type { AgentState, DeviceTransport } from "./transport.js";

export class AgentStateTracker {
  private current: AgentState = "idle";
  private erroredThisRun = false;

  constructor(
    private readonly transport: DeviceTransport,
    private readonly slot: number,
  ) {}

  get state(): AgentState {
    return this.current;
  }

  async set(state: AgentState): Promise<void> {
    if (state === this.current) return;
    this.current = state;
    await this.transport.setAgentState(this.slot, state);
  }

  markError(): void {
    this.erroredThisRun = true;
  }

  async onRunStart(): Promise<void> {
    this.erroredThisRun = false;
    await this.set("thinking");
  }

  /**
   * Called on agent_settled. `askedQuestion` is a heuristic: the last
   * assistant message ended with a question, so the agent likely needs
   * user input rather than being "done".
   */
  async onRunSettled(askedQuestion: boolean): Promise<void> {
    if (this.erroredThisRun) {
      await this.set("error");
    } else if (askedQuestion) {
      await this.set("needs-input");
    } else {
      await this.set("complete");
    }
  }
}
