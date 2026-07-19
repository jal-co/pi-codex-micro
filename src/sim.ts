/**
 * SimConnection: one object the extension talks to, regardless of
 * whether this pi session hosts the simulator hub or joins one.
 *
 * - ensure(): become the hub on SIM_PORT, or register as a client if
 *   another session already hosts it.
 * - probe(): silent auto-join at session_start so extra zentty panes
 *   appear on the page without any command.
 * - Failover: if the hub session exits, clients notice the closed
 *   stream and race to re-ensure; one becomes the new hub on the same
 *   port, and the browser's EventSource reconnects on its own.
 */

import { SimClient } from "./sim-client.js";
import { SimHub } from "./sim-server.js";
import { SIM_PORT, type PaneInfo, type SimAction } from "./sim-shared.js";
import type { AgentState, DeviceTransport } from "./transport.js";

export type SimMode = "off" | "hub" | "client";

export class SimConnection implements DeviceTransport {
  private mode: SimMode = "off";
  private hub: SimHub | null = null;
  private client: SimClient | null = null;
  private id = String(process.pid);
  private name = "agent";
  private pane: PaneInfo = {};
  private onAction: (action: SimAction) => void | Promise<void>;
  private lastState: AgentState = "idle";
  private lastThinking = "";
  private lastModel = "";
  private reconnecting = false;
  private stopped = true;

  constructor(onAction: (action: SimAction) => void | Promise<void>) {
    this.onAction = onAction;
  }

  setIdentity(id: string, name: string, pane: PaneInfo = {}): void {
    this.id = id;
    this.name = name;
    this.pane = pane;
  }

  /**
   * Rebind the action handler. Used when the extension reloads but the
   * connection survives (it lives on globalThis across reloads); the
   * old handler closes over dead extension state.
   */
  setActionHandler(onAction: (action: SimAction) => void | Promise<void>): void {
    this.onAction = onAction;
  }

  getMode(): SimMode {
    return this.mode;
  }

  url(): string {
    return `http://127.0.0.1:${SIM_PORT}`;
  }

  // ── DeviceTransport ────────────────────────────────────────────────

  async connect(): Promise<boolean> {
    return this.mode !== "off";
  }

  async disconnect(): Promise<void> {
    await this.stop();
  }

  isConnected(): boolean {
    return this.mode !== "off";
  }

  async setAgentState(_slot: number, state: AgentState): Promise<void> {
    this.lastState = state;
    if (this.mode === "hub") {
      this.hub?.updateState(this.id, state);
    } else if (this.mode === "client") {
      const ok = await this.client?.pushState(state);
      if (!ok) this.scheduleReconnect();
    }
  }

  describe(): string {
    if (this.mode === "hub") return `sim hub at ${this.url()} (${this.hub?.sessionCount() ?? 0} agents)`;
    if (this.mode === "client") return `sim client of ${this.url()}`;
    return "sim off";
  }

  // ── Meta mirrored to the page ──────────────────────────────────────

  setThinkingLevel(level: string): void {
    this.lastThinking = level;
    if (this.mode === "hub") this.hub?.updateMeta(this.id, { thinking: level });
    else if (this.mode === "client") void this.client?.pushMeta({ thinking: level });
  }

  setModelName(model: string): void {
    this.lastModel = model;
    if (this.mode === "hub") this.hub?.updateMeta(this.id, { model });
    else if (this.mode === "client") void this.client?.pushMeta({ model });
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  /** Become hub or client. Returns the resulting mode. */
  async ensure(): Promise<SimMode> {
    this.stopped = false;
    if (this.mode !== "off") return this.mode;

    // Try to claim the port.
    const hub = new SimHub((action) => this.onAction(action));
    try {
      await hub.start(SIM_PORT);
      this.hub = hub;
      this.mode = "hub";
      hub.registerLocal(this.id, this.name, this.pane);
      this.replay();
      return this.mode;
    } catch {
      // Port taken: join the existing hub as a client.
    }

    const client = new SimClient(
      this.url(),
      this.id,
      this.name,
      (action) => this.onAction(action),
      () => this.scheduleReconnect(),
      this.pane,
    );
    if (await client.connect()) {
      this.client = client;
      this.mode = "client";
      this.replay();
      return this.mode;
    }
    client.close();
    return "off";
  }

  /** Silent auto-join: only connects if a hub is already running. */
  async probe(): Promise<void> {
    if (this.mode !== "off") return;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 400);
      const response = await fetch(`${this.url()}/ping`, { signal: controller.signal });
      clearTimeout(timer);
      if (response.ok) {
        this.stopped = false;
        await this.ensure();
      }
    } catch {
      // no hub running; stay off
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.mode = "off";
    this.client?.close();
    this.client = null;
    await this.hub?.stop();
    this.hub = null;
  }

  // ── Internals ──────────────────────────────────────────────────────

  /** Push cached state/meta after (re)connecting so the page is in sync. */
  private replay(): void {
    void this.setAgentState(0, this.lastState);
    if (this.lastThinking) this.setThinkingLevel(this.lastThinking);
    if (this.lastModel) this.setModelName(this.lastModel);
  }

  private scheduleReconnect(): void {
    if (this.reconnecting || this.stopped) return;
    this.reconnecting = true;
    this.client?.close();
    this.client = null;
    this.mode = "off";
    setTimeout(() => {
      this.reconnecting = false;
      if (!this.stopped) void this.ensure();
    }, 1000 + Math.random() * 1000);
  }
}
