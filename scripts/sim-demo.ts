/**
 * Standalone simulator demo: no pi session needed.
 * Starts the hub on the fixed port, registers three fake agents, and
 * cycles their states so the multi-agent UI can be previewed.
 *
 *   npx tsx scripts/sim-demo.ts
 */

import { SimHub } from "../src/sim-server.js";
import { SIM_PORT } from "../src/sim-shared.js";
import type { AgentState } from "../src/transport.js";

const hub = new SimHub((action) => console.log("action:", action.sessionId, action.kind, action.value ?? ""));
await hub.start(SIM_PORT);

hub.registerLocal("demo-1", "jalco-pi-mono");
hub.registerLocal("demo-2", "pi-codex-micro");
hub.registerLocal("demo-3", "shieldcn");
hub.updateMeta("demo-1", { model: "anthropic/claude-fable-5", thinking: "medium" });
hub.updateMeta("demo-2", { model: "openai-codex/gpt-5.5", thinking: "high" });
hub.updateMeta("demo-3", { model: "zai/glm-5.2", thinking: "low" });

console.log(`Codex Micro sim demo: http://127.0.0.1:${SIM_PORT} (ctrl+c to stop)`);

const cycle: AgentState[] = ["idle", "thinking", "thinking", "thinking", "complete", "needs-input", "error"];
let tick = 0;
setInterval(() => {
  hub.updateState("demo-1", cycle[tick % cycle.length]);
  hub.updateState("demo-2", cycle[(tick + 3) % cycle.length]);
  hub.updateState("demo-3", cycle[(tick + 5) % cycle.length]);
  tick += 1;
}, 1500);
