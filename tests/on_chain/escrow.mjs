/* The consequence: money that can only reach the passport-holder the buyer bound to.
 *
 *   PASSPORT=0x… ISSUED=honest REFUSED=hijacker CLAIM=can:code node tests/on_chain/escrow.mjs
 *
 * Deploys escrows against a register: one for an agent whose passport was
 * issued, bound to its real operator and endpoint (the operator is paid);
 * one for an agent whose passport was refused (the buyer is refunded); one
 * for the issued agent but bound to a stranger's address, as if a squatter
 * held the name (the buyer is refunded); and one bound to the right operator
 * but another endpoint (the buyer would be refunded). There is no path that
 * pays anybody but the operator the buyer named, and only while the passport
 * covers the claim.
 */
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { generatePrivateKey } from "viem/accounts";
// OPERATOR_KEY=0x… (the throwaway key smoke.mjs printed) adds the check that the operator cannot settle before day 7.
import { readFileSync } from "node:fs";

const RPC = "https://studio.genlayer.com/api";
const rpc = async (m, p) => { let last; for (let i = 0; i < 8; i++) { try { const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: m, params: p }) }); return (await r.json()).result; } catch (e) { last = e; await new Promise((x) => setTimeout(x, 2500)); } } throw last; };
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? "  · " + d : ""}`); };
const REGISTER = process.env.PASSPORT; const ISSUED = process.env.ISSUED || "honest"; const REFUSED = process.env.REFUSED || "hijacker"; const CLAIM = process.env.CLAIM || "can:code";
if (!REGISTER) { console.log("set PASSPORT=0x… to a register with an issued and a refused agent"); process.exit(2); }

const buyer = createAccount(generatePrivateKey()); const stranger = createAccount(generatePrivateKey());
await rpc("sim_fundAccount", { account_address: buyer.address, amount: 400e18 });
await rpc("sim_fundAccount", { account_address: stranger.address, amount: 100e18 });
const c = createClient({ chain: studionet, account: buyer }); const cs = createClient({ chain: studionet, account: stranger }); const rd = createClient({ chain: studionet });
const balance = async (a) => BigInt(await rpc("eth_getBalance", [a, "latest"]) || "0x0");
const moved = async (a, before) => { for (let i = 0; i < 15; i++) { const b = await balance(a); if (b !== before) return b; await new Promise((r) => setTimeout(r, 4000)); } return await balance(a); };
const code = readFileSync(new URL("../../contracts/fixtures/escrow.py", import.meta.url));
const wait = async (tx) => { for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 4000)); const t = await rpc("eth_getTransactionByHash", [tx]); if (t?.status === "FINALIZED") { const lr = t.consensus_data?.leader_receipt, one = Array.isArray(lr) ? lr[0] : lr; let msg = ""; try { msg = Buffer.from(one.result, "base64").toString("utf8").replace(/[^\x20-\x7e]/g, " ").trim(); } catch (e) {} let j = null; const b = msg.indexOf("{"); if (b !== -1) { try { j = JSON.parse(msg.slice(b)); } catch (e) {} } return { msg, j, exec: one?.execution_result }; } } return { msg: "TIMEOUT" }; };
const deployFor = async (agent, operator, endpoint) => { const dh = await c.deployContract({ code, args: [REGISTER, agent, CLAIM, operator, endpoint], leaderOnly: false }); return (await c.waitForTransactionReceipt({ hash: dh, status: "ACCEPTED", retries: 40, interval: 4000 }))?.data?.contract_address; };
const send = async (E, client, fn, args = [], value) => wait(await client.writeContract({ address: E, functionName: fn, args, ...(value ? { value } : {}) }));
const view = async (E, fn, args = []) => rd.readContract({ address: E, functionName: fn, args });
const row = async (id) => JSON.parse(String(await rd.readContract({ address: REGISTER, functionName: "passport", args: [id] })));
const GEN = 10n ** 18n;

const issued = await row(ISSUED), refused = await row(REFUSED);
const operator = issued.operator, endpoint = issued.endpoint;
console.log("register", REGISTER, "· issued agent", ISSUED, `(${issued.status})`, "· refused agent", REFUSED, `(${refused.status})`, "· operator", operator, "\n");

const E1 = await deployFor(ISSUED, operator, endpoint); console.log("escrow for", ISSUED, "bound to its operator and endpoint, at", E1);
ok("would_pay reads the passport with no model and no consensus", (await view(E1, "would_pay")) === "operator", String(await view(E1, "would_pay")));
const st0 = JSON.parse(String(await view(E1, "status")));
ok("status shows what the job is bound to", st0.operator?.toLowerCase() === operator.toLowerCase() && st0.endpoint === endpoint);
const f = await send(E1, c, "fund", [], 12n * GEN); ok("the job takes funds", f.j?.ok === true, `pool ${f.j?.pool}`);
const s = await send(E1, cs, "release"); ok("a stranger cannot settle the job", s.exec === "ERROR" && s.msg.includes("only the buyer settles"), s.msg.slice(0, 80));
if (process.env.OPERATOR_KEY) {
  const co = createClient({ chain: studionet, account: createAccount(process.env.OPERATOR_KEY) });
  const early = await send(E1, co, "release");
  ok("the operator cannot settle before the job is 7 days old", early.exec === "ERROR" && early.msg.includes("7 days old"), early.msg.slice(0, 90));
  const st = JSON.parse(String(await view(E1, "status")));
  ok("status says so, from the message clock", st.operator_may_settle === false && st.settle_after_days === 7 && String(st.funded_at).length > 10, `funded_at ${st.funded_at}`);
} else console.log("(set OPERATOR_KEY to also check the operator's early-settle refusal)");
const before = await balance(operator);
const r1 = await send(E1, c, "release"); ok("release pays the operator the buyer bound to", r1.j?.ok === true && r1.j?.paid === "operator" && r1.j?.bound === true && r1.j?.to?.toLowerCase() === operator.toLowerCase(), `${r1.j?.passport} → ${r1.j?.paid}`);
ok("the money actually moved", (await moved(operator, before)) - before === 12n * GEN, "12 GEN");
const twice = await send(E1, c, "release"); ok("a job settles once", twice.exec === "ERROR" && twice.msg.includes("already been settled"));

const E2 = await deployFor(REFUSED, refused.operator, refused.endpoint); console.log("\nescrow for", REFUSED, "at", E2);
ok("would_pay says the buyer gets it back when the passport does not cover the claim", (await view(E2, "would_pay")) === "buyer");
await send(E2, c, "fund", [], 7n * GEN);
const bBefore = await balance(buyer.address);
const r2 = await send(E2, c, "release"); ok("release refunds the buyer when the passport does not cover the claim", r2.j?.ok === true && r2.j?.paid === "buyer" && r2.j?.valid === false, `${r2.j?.passport} → ${r2.j?.paid}`);
ok("and the buyer got the 7 GEN back (minus gas)", (await moved(buyer.address, bBefore)) - bBefore > 6n * GEN);
const late = await send(E1, c, "fund", [], 2n * GEN); ok("funding a settled job is refused *and refunded*", late.j?.ok === false && String(late.j?.reason).includes("returned"));

const E3 = await deployFor(ISSUED, stranger.address, endpoint); console.log("\nescrow for", ISSUED, "bound to a stranger's address, as if a squatter held the name, at", E3);
ok("would_pay says the buyer: a valid passport under a name somebody else holds pays nobody", (await view(E3, "would_pay")) === "buyer");
await send(E3, c, "fund", [], 3n * GEN);
const sBefore = await balance(stranger.address), b3 = await balance(buyer.address);
const r3 = await send(E3, c, "release"); ok("release refunds the buyer, the passport being valid but not the row the buyer bound to", r3.j?.ok === true && r3.j?.paid === "buyer" && r3.j?.valid === true && r3.j?.bound === false, `valid ${r3.j?.valid}, bound ${r3.j?.bound} → ${r3.j?.paid}`);
ok("the stranger did not get a wei", (await balance(stranger.address)) === sBefore);
ok("the buyer got the 3 GEN back (minus gas)", (await moved(buyer.address, b3)) - b3 > 2n * GEN);

const other = endpoint + (endpoint.includes("?") ? "&" : "?") + "other=1";
const E4 = await deployFor(ISSUED, operator, other); console.log("\nescrow for", ISSUED, "bound to the right operator but another endpoint, at", E4);
ok("would_pay says the buyer: the row no longer serves the endpoint the buyer bought from", (await view(E4, "would_pay")) === "buyer");
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
