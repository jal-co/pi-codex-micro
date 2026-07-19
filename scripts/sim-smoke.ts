import { SimServer, type SimAction } from "../src/sim-server.js";

const received: SimAction[] = [];
const sim = new SimServer({ onAction: (a) => void received.push(a) });
const url = await sim.start();
console.log("started:", url);

// Page loads
const page = await fetch(url);
console.log("page status:", page.status, "html:", (await page.text()).includes("CODEX MICRO"));

// SSE replays state
await sim.setAgentState(0, "thinking");
const controller = new AbortController();
const events = await fetch(`${url}/events`, { signal: controller.signal });
const reader = events.body!.getReader();
const chunk = new TextDecoder().decode((await reader.read()).value);
console.log("sse replay has state:", chunk.includes('"thinking"'));
controller.abort();

// Actions round-trip
const res = await fetch(`${url}/action`, { method: "POST", body: JSON.stringify({ kind: "joystick", value: "up" }) });
console.log("action status:", res.status, "received:", JSON.stringify(received));

await sim.stop();
console.log("stopped");
