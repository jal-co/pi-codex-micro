/**
 * Device transport abstraction for the Work Louder Codex Micro.
 *
 * The LED/state protocol is not public yet. Everything protocol-specific
 * lives in protocol.ts so that once the hardware arrives and the report
 * format is sniffed, only that file needs real bytes.
 */

export type AgentState =
  | "idle"
  | "thinking"
  | "needs-input"
  | "complete"
  | "error";

export interface DeviceTransport {
  /** Attempt to open the device. Resolves false if not present. */
  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  /**
   * Reflect an agent state on the device (Agent Key LEDs).
   * `slot` selects which agent key (0-based) for multi-session setups.
   */
  setAgentState(slot: number, state: AgentState): Promise<void>;
  /** Human-readable transport description for /codex-micro status. */
  describe(): string;
  /**
   * Subscribe to device input events (vendor channel), if the transport
   * supports reading. `key` is the firmware key ID (AG00-AG05,
   * ACT06-ACT12, ENC_CW/ENC_CC/ENC_CLK) and `act` is 0=release,
   * 1=press, 2=encoder step. Joystick events arrive as key "RAD" with
   * angle/distance in the extra payload.
   */
  onDeviceEvent?(listener: DeviceEventListener): void;
}

export type DeviceEvent =
  | { type: "key"; key: string; act: number }
  | { type: "joystick"; angle: number; distance: number };

export type DeviceEventListener = (event: DeviceEvent) => void;
