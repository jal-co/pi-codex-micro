# Codex Micro protocol discovery

The agent-state LED protocol is not public. This is the plan for reverse
engineering it once the hardware arrives. Everything learned here gets
encoded in `src/protocol.ts`.

## Step 1: Identify the device

Plug in over USB-C, then:

```bash
hidutil list | grep -i "work\|louder\|codex"
ioreg -p IOUSB -l -w0 | grep -iA5 "codex\|louder"
system_profiler SPUSBDataType | grep -iB2 -A8 "codex\|louder"
```

Record the real `vendorId` / `productId` and every HID interface
(usage page / usage pairs). Update `src/protocol.ts` and
`~/.pi/agent/codex-micro.json`.

Expected interfaces if the board is QMK-based like other Work Louder
hardware:

| Usage page | Usage | Purpose |
|---|---|---|
| 0x0001 | 0x0006 | Keyboard (keystrokes from keys/dial/joystick) |
| 0x000C | 0x0001 | Consumer control (media keys) |
| 0xFF60 | 0x0061 | Raw HID (VIA/custom protocol — the interesting one) |

## Step 2: Check for QMK/VIA

```bash
# Try VIA protocol version handshake on the raw interface
node -e '
const HID = require("node-hid");
const d = HID.devices().find(x => x.usagePage === 0xff60 && /codex/i.test(x.product||""));
if (!d) { console.log("no raw interface"); process.exit(1); }
const dev = new HID.HID(d.path);
dev.write([0x00, 0x01, 0x00]); // VIA: get protocol version
console.log(dev.readTimeout(500));
dev.close();
'
```

A sane 3-byte version response means the board speaks VIA and custom
commands almost certainly live in the `id_custom_*` channel range
(0x07-0x09 in modern VIA) or a vendor keyrange.

## Step 3: Sniff what Codex sends

The Codex CLI/app has the real integration. Capture its traffic:

- **macOS:** `sudo log stream --predicate 'sender == "IOHIDFamily"'` is
  noisy but free. Better: Wireshark with a USB capture
  (`brew install wireshark`, XHC20 interface needs
  `sudo ifconfig XHC20 up` on older macOS; on newer macOS use a Linux VM
  or a hardware sniffer).
- **Easiest path:** run Codex in a Linux VM with USB passthrough and use
  `usbmon` + Wireshark. Filter by the device address, watch interrupt OUT
  transfers on the raw HID endpoint while agent state changes
  (idle → thinking → complete → needs input → error).
- Diff the payloads across state transitions. The changing bytes are the
  command + state + slot encoding.

Also check whether the Codex integration is local HID at all — if the
device pairs over Bluetooth, capture with PacketLogger
(Additional Tools for Xcode) instead.

## Step 4: Check for official surface area first

Before sniffing, look for a sanctioned path:

- Codex CLI release notes / `codex --help` for device flags
- Work Louder "Input" configurator app bundle for a JS/Electron protocol
  implementation (`asar extract`, grep for `hid`, `0xff60`, `writeReport`)
- QMK firmware source: Work Louder has upstreamed boards to
  [qmk_firmware](https://github.com/qmk/qmk_firmware/tree/master/keyboards/work_louder)
  before. A `work_louder/codex` (or similar) directory would hand us the
  whole protocol in `rawhid` handlers. Check `via` keymap and
  `raw_hid_receive` implementations.

## Step 5: Encode findings

1. Fill in real values in `src/protocol.ts` (VID/PID, command bytes,
   state codes, report layout).
2. Flip `"transport": "hid"` in `~/.pi/agent/codex-micro.json`.
3. Run `/codex-micro test` in pi and watch the keys light up.
4. If the dial/joystick emit raw HID events instead of keystrokes in
   Codex mode, add a read loop to `HidTransport` and translate events to
   the same handlers the shortcuts use.
