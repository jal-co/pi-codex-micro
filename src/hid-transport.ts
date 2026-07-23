/**
 * node-hid transport for the Codex Micro.
 *
 * Degrades gracefully: if node-hid is missing or no matching device is
 * connected, connect() resolves false and the extension keeps working
 * in input-only mode.
 */

import type { AgentState, DeviceEventListener, DeviceTransport } from "./transport.js";
import type { MicroConfig } from "./config.js";
import { buildAgentStateReports, REPORT_ID, FRAME_TYPE } from "./protocol.js";

interface HidDeviceLike {
  write(data: number[]): number;
  close(): void;
  on(event: "data", cb: (buf: Buffer) => void): void;
  on(event: "error", cb: (err: unknown) => void): void;
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
  HID: new (path: string, options?: { nonExclusive?: boolean }) => HidDeviceLike;
}

export class HidTransport implements DeviceTransport {
  private device: HidDeviceLike | null = null;
  private deviceLabel = "";
  private lastError = "";
  private listener: DeviceEventListener | null = null;
  private rxBuffer = "";

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
      this.device = new hid.HID(match.path, { nonExclusive: true });
      this.deviceLabel = match.product ?? `${match.vendorId.toString(16)}:${match.productId.toString(16)}`;
      this.lastError = "";
      this.device.on("data", (buf) => this.handleReport(buf));
      this.device.on("error", () => {
        void this.disconnect();
      });
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
      for (const report of buildAgentStateReports(slot, state)) {
        this.device.write(report);
        await new Promise((r) => setTimeout(r, 4));
      }
    } catch (error) {
      this.lastError = `write failed: ${String(error)}`;
      await this.disconnect();
    }
  }

  describe(): string {
    if (this.device) return `hid connected (${this.deviceLabel})`;
    return this.lastError ? `hid disconnected (${this.lastError})` : "hid disconnected";
  }

  onDeviceEvent(listener: DeviceEventListener): void {
    this.listener = listener;
  }

  /** Reassemble framed JSON lines and emit key/joystick events. */
  private handleReport(buf: Buffer): void {
    const off = buf[0] === REPORT_ID ? 1 : 0;
    if (buf[off] !== FRAME_TYPE) return; // channel 1 is debug logs
    const len = buf[off + 1];
    this.rxBuffer += buf.subarray(off + 2, off + 2 + len).toString("utf8");
    if (this.rxBuffer.length > 8192) this.rxBuffer = "";
    let newline;
    while ((newline = this.rxBuffer.indexOf("\n")) >= 0) {
      const line = this.rxBuffer.slice(0, newline);
      this.rxBuffer = this.rxBuffer.slice(newline + 1);
      this.dispatch(line);
    }
  }

  private dispatch(line: string): void {
    if (!this.listener) return;
    let msg: { m?: string; p?: { k?: string; act?: number; a?: number; d?: number } };
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.m === "v.oai.hid" && msg.p?.k !== undefined) {
      this.listener({ type: "key", key: msg.p.k, act: msg.p.act ?? 1 });
    } else if (msg.m === "v.oai.rad" && msg.p) {
      this.listener({ type: "joystick", angle: msg.p.a ?? 0, distance: msg.p.d ?? 0 });
    }
  }
}
