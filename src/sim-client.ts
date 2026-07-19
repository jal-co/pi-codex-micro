/**
 * Client side of the simulator hub: used by every pi session that is
 * not hosting the page. Registers over the /agent-events SSE stream
 * (which doubles as the liveness signal), pushes state/meta with plain
 * POSTs, and executes actions the hub forwards.
 */

import type { MetaRequest, SimAction } from "./sim-shared.js";
import type { AgentState } from "./transport.js";

export class SimClient {
  private controller: AbortController | null = null;
  private registered = false;

  constructor(
    private readonly base: string,
    private readonly id: string,
    private readonly name: string,
    private readonly onAction: (action: SimAction) => void | Promise<void>,
    private readonly onDisconnect: () => void,
  ) {}

  isConnected(): boolean {
    return this.registered;
  }

  /** Open the action stream. Resolves true once the hub assigns a slot. */
  async connect(): Promise<boolean> {
    if (this.controller) return this.registered;
    this.controller = new AbortController();
    const url = `${this.base}/agent-events?id=${encodeURIComponent(this.id)}&name=${encodeURIComponent(this.name)}`;
    try {
      const response = await fetch(url, { signal: this.controller.signal });
      if (!response.ok || !response.body) throw new Error(`hub responded ${response.status}`);
      const registration = new Promise<boolean>((resolve) => {
        void this.pump(response.body!, resolve);
      });
      const ok = await Promise.race([
        registration,
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000)),
      ]);
      this.registered = ok;
      if (!ok) this.close();
      return ok;
    } catch {
      this.close();
      return false;
    }
  }

  close(): void {
    this.controller?.abort();
    this.controller = null;
    this.registered = false;
  }

  async pushState(state: AgentState): Promise<boolean> {
    return this.post("/state", { id: this.id, state });
  }

  async pushMeta(meta: Omit<MetaRequest, "id">): Promise<boolean> {
    return this.post("/meta", { id: this.id, ...meta });
  }

  private async post(path: string, body: unknown): Promise<boolean> {
    try {
      const response = await fetch(`${this.base}${path}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return response.ok || response.status === 204;
    } catch {
      return false;
    }
  }

  /** Read the SSE stream, resolving `onRegistered` at the handshake. */
  private async pump(
    body: ReadableStream<Uint8Array>,
    onRegistered: (ok: boolean) => void,
  ): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index = buffer.indexOf("\n\n");
        while (index !== -1) {
          const frame = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          index = buffer.indexOf("\n\n");
          const data = frame
            .split("\n")
            .filter((line) => line.startsWith("data: "))
            .map((line) => line.slice(6))
            .join("");
          if (!data) continue;
          const event = JSON.parse(data) as { type: string; action?: SimAction };
          if (event.type === "registered") onRegistered(true);
          else if (event.type === "rejected") onRegistered(false);
          else if (event.type === "action" && event.action) await this.onAction(event.action);
        }
      }
    } catch {
      // stream torn down; fall through to disconnect
    }
    onRegistered(false);
    if (this.registered) {
      this.registered = false;
      this.onDisconnect();
    }
    this.controller = null;
  }
}
