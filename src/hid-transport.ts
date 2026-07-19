/**
 * node-hid transport for the Codex Micro.
 *
 * Degrades gracefully: if node-hid is missing or no matching device is
 * connected, connect() resolves false and the extension keeps working
 * in input-only mode.
 */

import type { AgentState, DeviceTransport } from "./transport.js";
import type { MicroConfig } from "./config.js";
import { buildAgentStateReport } from "./protocol.js";

interface HidDeviceLike {
  write(data: number[]): number;
  close(): void;
}

interface HidModuleLike {
  devices(): Array<{
    vendorId: number;
    productId: number;
    usagePage?: number;
    usage?: number;
    path?: string;
    product?: string;
  }>;
  HID: new (path: string) => HidDeviceLike;
}

export class HidTransport implements DeviceTransport {
  private device: HidDeviceLike | null = null;
  private deviceLabel = "";
  private lastError = "";

  constructor(private readonly config: MicroConfig) {}

  async connect(): Promise<boolean> {
    if (this.device) return true;
    let hid: HidModuleLike;
    try {
      hid = (await import("node-hid")) as unknown as HidModuleLike;
    } catch (error) {
      this.lastError = `node-hid unavailable: ${String(error)}`;
      return false;
    }

    try {
      const match = hid.devices().find((d) => {
        if (d.vendorId !== this.config.vendorId) return false;
        if (this.config.productId !== 0 && d.productId !== this.config.productId) return false;
        if (d.usagePage !== undefined && d.usagePage !== this.config.usagePage) return false;
        if (d.usage !== undefined && d.usage !== this.config.usage) return false;
        return Boolean(d.path);
      });
      if (!match?.path) {
        this.lastError = "no matching HID device found";
        return false;
      }
      this.device = new hid.HID(match.path);
      this.deviceLabel = match.product ?? `${match.vendorId.toString(16)}:${match.productId.toString(16)}`;
      this.lastError = "";
      return true;
    } catch (error) {
      this.lastError = `open failed: ${String(error)}`;
      this.device = null;
      return false;
    }
  }

  async disconnect(): Promise<void> {
    try {
      this.device?.close();
    } finally {
      this.device = null;
    }
  }

  isConnected(): boolean {
    return this.device !== null;
  }

  async setAgentState(slot: number, state: AgentState): Promise<void> {
    if (!this.device) return;
    try {
      this.device.write(buildAgentStateReport(slot, state));
    } catch (error) {
      this.lastError = `write failed: ${String(error)}`;
      await this.disconnect();
    }
  }

  describe(): string {
    if (this.device) return `hid connected (${this.deviceLabel})`;
    return this.lastError ? `hid disconnected (${this.lastError})` : "hid disconnected";
  }
}
