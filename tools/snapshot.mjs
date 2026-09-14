/* Take a labelled snapshot of the demo register, for the minute when Studio
   answers reads with "Contract not found" for an address the explorer shows
   perfectly well. The page shows this file, marked as a snapshot with its date,
   only when live reads of the demo register fail after eight tries.

     node tools/snapshot.mjs 0x…            # writes data/snapshot.json
*/
import { createClient } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";
import { writeFileSync, mkdirSync } from "node:fs";

const A = process.argv[2];
if (!/^0x[0-9a-fA-F]{40}$/.test(A || "")) { console.error("usage: node tools/snapshot.mjs 0x<register>"); process.exit(2); }
const rd = createClient({ chain: { ...studioDevnet, rpcUrls: { default: { http: ["https://studio-next.genlayer.com/api"] } } } });
async function read(fn, args = []) {
  let last;
  for (let i = 0; i < 8; i++) {
    try { return await rd.readContract({ address: A, functionName: fn, args }); }
    catch (e) { last = e; await new Promise((r) => setTimeout(r, Math.min(8000, 500 + 350 * (i + 1) * (i + 1)))); }
  }
  throw last;
}
const rules = JSON.parse(String(await read("rules")));
const battery = JSON.parse(String(await read("battery")));
const order = JSON.parse(String(await read("agents_list")));
const agents = {};
for (const id of order) agents[id] = JSON.parse(String(await read("passport", [id])));
const snap = { register: A, taken: new Date().toISOString(), rules, battery, order, agents };
mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
writeFileSync(new URL("../data/snapshot.json", import.meta.url), JSON.stringify(snap, null, 1) + "\n");
console.log(`snapshot of ${A}: ${order.length} agents (${order.map((i) => i + ":" + agents[i].status).join(", ")}) taken ${snap.taken}`);
