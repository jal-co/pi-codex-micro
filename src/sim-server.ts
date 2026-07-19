/**
 * Browser-based Codex Micro simulator.
 *
 * Implements DeviceTransport so LED state changes mirror to the page in
 * real time (Server-Sent Events), and forwards clicks on the virtual
 * keys/dial/joystick back into pi as real inputs. Zero dependencies:
 * plain node:http + SSE + fetch POSTs.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { SIM_PAGE } from "./sim-page.js";
import type { AgentState, DeviceTransport } from "./transport.js";

export interface SimAction {
  kind: "joystick" | "dial" | "command" | "interrupt" | "key";
  /** joystick: up/down/left/right. dial: cw/ccw. command/key: identifier. */
  value?: string;
}

export interface SimHandlers {
  onAction(action: SimAction): void | Promise<void>;
}

interface SimEvent {
  type: "state" | "thinking" | "model" | "hello";
  slot?: number;
  state?: AgentState;
  level?: string;
  model?: string;
}

export class SimServer implements DeviceTransport {
  private server: Server | null = null;
  private clients = new Set<ServerResponse>();
  private lastStates = new Map<number, AgentState>();
  private lastThinking = "";
  private lastModel = "";

  constructor(private readonly handlers: SimHandlers) {}

  // ── DeviceTransport ────────────────────────────────────────────────

  async connect(): Promise<boolean> {
    return this.server !== null;
  }

  async disconnect(): Promise<void> {
    await this.stop();
  }

  isConnected(): boolean {
    return this.server !== null;
  }

  async setAgentState(slot: number, state: AgentState): Promise<void> {
    this.lastStates.set(slot, state);
    this.broadcast({ type: "state", slot, state });
  }

  describe(): string {
    return this.server ? `sim running at ${this.url()}` : "sim stopped";
  }

  // ── Extra state mirrored to the page ───────────────────────────────

  setThinkingLevel(level: string): void {
    this.lastThinking = level;
    this.broadcast({ type: "thinking", level });
  }

  setModelName(model: string): void {
    this.lastModel = model;
    this.broadcast({ type: "model", model });
  }

  // ── Server lifecycle ───────────────────────────────────────────────

  async start(port = 0): Promise<string> {
    if (this.server) return this.url();
    this.server = createServer((req, res) => void this.route(req, res));
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(port, "127.0.0.1", resolve);
    });
    return this.url();
  }

  async stop(): Promise<void> {
    for (const client of this.clients) client.end();
    this.clients.clear();
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.server = null;
    }
  }

  url(): string {
    const address = this.server?.address() as AddressInfo | null;
    return address ? `http://127.0.0.1:${address.port}` : "";
  }

  // ── HTTP routing ───────────────────────────────────────────────────

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;

    if (req.method === "GET" && path === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(SIM_PAGE);
      return;
    }

    if (req.method === "GET" && path === "/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      this.clients.add(res);
      req.on("close", () => this.clients.delete(res));
      // Replay current state to the new client.
      this.send(res, { type: "hello" });
      for (const [slot, state] of this.lastStates) this.send(res, { type: "state", slot, state });
      if (this.lastThinking) this.send(res, { type: "thinking", level: this.lastThinking });
      if (this.lastModel) this.send(res, { type: "model", model: this.lastModel });
      return;
    }

    if (req.method === "POST" && path === "/action") {
      try {
        const body = await readBody(req);
        const action = JSON.parse(body) as SimAction;
        await this.handlers.onAction(action);
        res.writeHead(204).end();
      } catch (error) {
        res.writeHead(400, { "content-type": "text/plain" }).end(String(error));
      }
      return;
    }

    res.writeHead(404).end("not found");
  }

  private broadcast(event: SimEvent): void {
    for (const client of this.clients) this.send(client, event);
  }

  private send(res: ServerResponse, event: SimEvent): void {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += String(chunk)));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
