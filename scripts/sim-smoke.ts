/**
 * Headless smoke test for the multi-session simulator.
 * Exercises: hub startup, local + remote registration, slot assignment,
 * state broadcast to the browser stream, action routing to a remote
 * client, and client failover detection.
 *
 *   npx tsx scripts/sim-smoke.ts
 */

import { SimClient } from "../src/sim-client.js";
import { SimHub } from "../src/sim-server.js";
import type { SimAction } from "../src/sim-shared.js";

const results: Array<[string, boolean]> = [];
const check = (name: string, ok: boolean) => {
  results.push([name, ok]);
  console.log(`${ok ? "ok " : "FAIL"} ${name}`);
};

const hubActions: SimAction[] = [];
const hub = new SimHub((a) => void hubActions.push(a));
await hub.start(0);
const url = hub.url();
check("hub starts", Boolean(url));

// Page serves
const page = await fetch(url);
check("page 200 + html", page.status === 200 && (await page.text()).includes("CODEX MICRO"));

// Local session takes slot 0
const slot0 = hub.registerLocal("local", "hub-session");
check("local session gets slot 0", slot0 === 0);

// Remote client registers via SSE channel and takes slot 1
const clientActions: SimAction[] = [];
let disconnected = false;
const client = new SimClient(url, "remote", "pane-two", (a) => void clientActions.push(a), () => (disconnected = true));
check("client registers", await client.connect());

// State pushes broadcast to browser stream
check("client state push", await client.pushState("thinking"));
const controller = new AbortController();
const events = await fetch(`${url}/events`, { signal: controller.signal });
const chunk = new TextDecoder().decode((await events.body!.getReader().read()).value);
controller.abort();
check(
  "browser snapshot has both sessions",
  chunk.includes("hub-session") && chunk.includes("pane-two") && chunk.includes('"thinking"'),
);

// Actions route: to hub-local session
await fetch(`${url}/action`, { method: "POST", body: JSON.stringify({ kind: "dial", value: "cw", sessionId: "local" }) });
await new Promise((r) => setTimeout(r, 100));
check("action routes to local", hubActions.some((a) => a.kind === "dial"));

// Actions route: forwarded to remote client
await fetch(`${url}/action`, { method: "POST", body: JSON.stringify({ kind: "joystick", value: "up", sessionId: "remote" }) });
await new Promise((r) => setTimeout(r, 200));
check("action forwards to client", clientActions.some((a) => a.kind === "joystick" && a.value === "up"));

// Sticky slots: dropping the stream keeps the key for the grace period
client.close();
await new Promise((r) => setTimeout(r, 200));
const c2 = new AbortController();
const events2 = await fetch(`${url}/events`, { signal: c2.signal });
const chunk2 = new TextDecoder().decode((await events2.body!.getReader().read()).value);
c2.abort();
check("disconnected session keeps slot (grace)", chunk2.includes("pane-two") && chunk2.includes('"connected":false'));

// Reconnect reclaims the same slot
const client2 = new SimClient(url, "remote", "pane-two", () => {}, () => {});
check("reconnect succeeds", await client2.connect());
const c3 = new AbortController();
const events3 = await fetch(`${url}/events`, { signal: c3.signal });
const chunk3 = new TextDecoder().decode((await events3.body!.getReader().read()).value);
c3.abort();
const reconnected = /\{[^}]*"id":"remote"[^}]*\}/.exec(chunk3)?.[0] ?? "";
check("same slot after reconnect", reconnected.includes('"slot":1') && reconnected.includes('"connected":true'));

// Hub teardown triggers client disconnect callback
let lost = false;
const client3 = new SimClient(url, "remote-3", "pane-three", () => {}, () => (lost = true));
check("third client registers", await client3.connect());
await hub.stop();
await new Promise((r) => setTimeout(r, 200));
check("client detects hub loss", lost);
client2.close();
client3.close();
void disconnected;

const failed = results.filter(([, ok]) => !ok).length;
console.log(failed === 0 ? "all checks passed" : `${failed} checks FAILED`);
process.exit(failed === 0 ? 0 : 1);
