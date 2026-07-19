/**
 * Standalone simulator demo: no pi session needed.
 * Starts the sim page on a fixed port, cycles agent states so the LEDs
 * are visibly alive, and logs any actions clicked on the page.
 *
 *   npx tsx scripts/sim-demo.ts
 */

import { SimServer } from "../src/sim-server.js";
import type { AgentState } from "../src/transport.js";

const sim = new SimServer({
  onAction: (action) => console.log("action:", action.kind, action.value ?? ""),
});

const url = await sim.start(7327);
sim.setModelName("demo mode (not connected to a pi session)");
sim.setThinkingLevel("medium");
console.log(`Codex Micro sim demo: ${url} (ctrl+c to stop)`);

const cycle: AgentState[] = ["idle", "thinking", "thinking", "thinking", "complete", "needs-input", "error"];
let tick = 0;
setInterval(() => {
  void sim.setAgentState(0, cycle[tick % cycle.length]);
  void sim.setAgentState(1, cycle[(tick + 3) % cycle.length]);
  void sim.setAgentState(2, cycle[(tick + 5) % cycle.length]);
  tick += 1;
}, 1500);
