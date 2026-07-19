/**
 * Multi-session simulator hub.
 *
 * The first pi session to run /codex-micro sim binds SIM_PORT and serves
 * the device page. Every other pi session registers as a client over
 * HTTP, is assigned an agent-key slot, streams its state in, and
 * receives forwarded page actions over a per-session SSE channel.
 * Liveness is the SSE connection itself: when a client's channel closes,
 * its slot frees and the page updates.
 */

import { execFile } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { SIM_PAGE } from "./sim-page.js";
import {
  SLOT_COUNT,
  SLOT_GRACE_MS,
  type PaneInfo,
  type BrowserEvent,
  type MetaRequest,
  type RegisterRequest,
  type SessionSnapshot,
  type SimAction,
  type StateRequest,
} from "./sim-shared.js";
import type { AgentState } from "./transport.js";

interface HubSession {
  id: string;
  name: string;
  slot: number;
  state: AgentState;
  thinking: string;
  model: string;
  /** SSE channel for forwarding actions to a remote session. Null for the hub's own session. */
  channel: ServerResponse | null;
  isLocal: boolean;
  connected: boolean;
  paneId?: string;
  windowId?: string;
  /** Pending removal after disconnect; cleared if the session reconnects. */
  removeTimer: ReturnType<typeof setTimeout> | null;
}

export class SimHub {
  private server: Server | null = null;
  private browsers = new Set<ServerResponse>();
  private sessions = new Map<string, HubSession>();

  constructor(private readonly onLocalAction: (action: SimAction) => void | Promise<void>) {}

  // ── Lifecycle ──────────────────────────────────────────────────────

  async start(port: number): Promise<void> {
    if (this.server) return;
    const server = createServer((req, res) => void this.route(req, res));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
    this.server = server;
  }

  async stop(): Promise<void> {
    for (const browser of this.browsers) browser.end();
    this.browsers.clear();
    for (const session of this.sessions.values()) {
      session.channel?.end();
      if (session.removeTimer) clearTimeout(session.removeTimer);
    }
    this.sessions.clear();
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.server = null;
    }
  }

  isRunning(): boolean {
    return this.server !== null;
  }

  url(): string {
    const address = this.server?.address() as AddressInfo | null;
    return address ? `http://127.0.0.1:${address.port}` : "";
  }

  // ── Local (hub-owned) session ──────────────────────────────────────

  registerLocal(id: string, name: string, pane?: PaneInfo): number {
    return this.upsert(id, name, null, true, pane);
  }

  updateState(id: string, state: AgentState): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.state = state;
    this.broadcast();
  }

  updateMeta(id: string, meta: { thinking?: string; model?: string }): void {
    const session = this.sessions.get(id);
    if (!session) return;
    if (meta.thinking !== undefined) session.thinking = meta.thinking;
    if (meta.model !== undefined) session.model = meta.model;
    this.broadcast();
  }

  removeSession(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.channel?.end();
    if (session.removeTimer) clearTimeout(session.removeTimer);
    this.sessions.delete(id);
    this.broadcast();
  }

  /**
   * Mark a session disconnected but keep its agent key for a grace
   * period so reconnects (pane restarts, hub failover, /reload) come
   * back to the same slot instead of reshuffling the row.
   */
  private markDisconnected(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.connected = false;
    session.channel = null;
    if (session.removeTimer) clearTimeout(session.removeTimer);
    session.removeTimer = setTimeout(() => this.removeSession(id), SLOT_GRACE_MS);
    this.broadcast();
  }

  sessionCount(): number {
    return this.sessions.size;
  }

  // ── Internals ──────────────────────────────────────────────────────

  private upsert(
    id: string,
    name: string,
    channel: ServerResponse | null,
    isLocal: boolean,
    pane?: PaneInfo,
  ): number {
    const existing = this.sessions.get(id);
    if (existing) {
      existing.name = name;
      existing.connected = true;
      if (pane?.paneId) existing.paneId = pane.paneId;
      if (pane?.windowId) existing.windowId = pane.windowId;
      if (existing.removeTimer) {
        clearTimeout(existing.removeTimer);
        existing.removeTimer = null;
      }
      if (channel) {
        existing.channel?.end();
        existing.channel = channel;
      }
      this.broadcast();
      return existing.slot;
    }
    const used = new Set([...this.sessions.values()].map((s) => s.slot));
    let slot = -1;
    for (let i = 0; i < SLOT_COUNT; i += 1) {
      if (!used.has(i)) {
        slot = i;
        break;
      }
    }
    if (slot === -1) return -1; // all agent keys taken
    this.sessions.set(id, {
      id,
      name,
      slot,
      state: "idle",
      thinking: "",
      model: "",
      channel,
      isLocal,
      connected: true,
      paneId: pane?.paneId,
      windowId: pane?.windowId,
      removeTimer: null,
    });
    this.broadcast();
    return slot;
  }

  private snapshot(): SessionSnapshot[] {
    return [...this.sessions.values()]
      .sort((a, b) => a.slot - b.slot)
      .map(({ id, name, slot, state, thinking, model, connected }) => ({
        id,
        name,
        slot,
        state,
        thinking,
        model,
        connected,
      }));
  }

  /** Jump to a session's zentty pane, bringing the app forward. */
  private focusPane(session: HubSession): void {
    if (!session.paneId) return;
    const bin = process.env.ZENTTY_CLI_BIN ?? "zentty";
    const args = ["pane", "focus", "--pane-id", session.paneId];
    if (session.windowId) args.push("--window-id", session.windowId);
    execFile(bin, args, (error) => {
      if (!error) execFile("open", ["-a", "Zentty"], () => {});
    });
  }

  private broadcast(): void {
    const event: BrowserEvent = { type: "sessions", sessions: this.snapshot() };
    for (const browser of this.browsers) this.send(browser, event);
  }

  private send(res: ServerResponse, event: unknown): void {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (req.method === "GET" && path === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(SIM_PAGE);
      return;
    }

    if (req.method === "GET" && path === "/ping") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, sessions: this.sessions.size }));
      return;
    }

    // Browser state stream.
    if (req.method === "GET" && path === "/events") {
      this.sse(res);
      this.browsers.add(res);
      req.on("close", () => this.browsers.delete(res));
      this.send(res, { type: "hello" } satisfies BrowserEvent);
      this.send(res, { type: "sessions", sessions: this.snapshot() } satisfies BrowserEvent);
      return;
    }

    // Remote session action channel. The connection doubles as liveness.
    if (req.method === "GET" && path === "/agent-events") {
      const id = url.searchParams.get("id") ?? "";
      const name = url.searchParams.get("name") ?? "agent";
      const pane: PaneInfo = {
        paneId: url.searchParams.get("paneId") ?? undefined,
        windowId: url.searchParams.get("windowId") ?? undefined,
      };
      this.sse(res);
      const slot = this.upsert(id, name, res, false, pane);
      if (slot === -1) {
        this.send(res, { type: "rejected", reason: "all agent keys in use" });
        res.end();
        return;
      }
      this.send(res, { type: "registered", slot });
      req.on("close", () => {
        const session = this.sessions.get(id);
        if (session && session.channel === res) this.markDisconnected(id);
      });
      return;
    }

    if (req.method === "POST" && path === "/state") {
      const body = JSON.parse(await readBody(req)) as StateRequest;
      this.updateState(body.id, body.state);
      res.writeHead(204).end();
      return;
    }

    if (req.method === "POST" && path === "/meta") {
      const body = JSON.parse(await readBody(req)) as MetaRequest;
      this.updateMeta(body.id, body);
      res.writeHead(204).end();
      return;
    }

    if (req.method === "POST" && path === "/register") {
      const body = JSON.parse(await readBody(req)) as RegisterRequest;
      const slot = this.upsert(body.id, body.name, null, false, body);
      res.writeHead(slot === -1 ? 409 : 200, { "content-type": "application/json" });
      res.end(JSON.stringify({ slot }));
      return;
    }

    if (req.method === "POST" && path === "/action") {
      try {
        const action = JSON.parse(await readBody(req)) as SimAction;
        const target = action.sessionId ? this.sessions.get(action.sessionId) : null;
        if (action.kind === "focus") {
          if (target) this.focusPane(target);
        } else if (target && !target.isLocal && target.channel) {
          this.send(target.channel, { type: "action", action });
        } else if (target?.isLocal || !action.sessionId) {
          await this.onLocalAction(action);
        }
        res.writeHead(204).end();
      } catch (error) {
        res.writeHead(400, { "content-type": "text/plain" }).end(String(error));
      }
      return;
    }

    res.writeHead(404).end("not found");
  }

  private sse(res: ServerResponse): void {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
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
