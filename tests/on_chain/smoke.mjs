/* Passport against the live Studio network.
 *
 * Two agents: one honest, one that claims a model family it is not and obeys
 * instructions smuggled into its input. The claim to prove is that five
 * validators, each talking to the agent themselves, reach the same three
 * words per claim — and that the refused passport is as readable as the
 * issued one.
 *
 *   HONEST_URL=https://…/api/agent?persona=honest LIAR_URL=https://…/api/agent?persona=liar \
 *   node tests/on_chain/smoke.mjs
 */
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { generatePrivateKey } from "viem/accounts";
import { readFileSync } from "node:fs";

const RPC = "https://studio.genlayer.com/api";
const rpc = async (m, p) => {
  let last;
  for (let i = 0; i < 8; i++) {
    try {
      const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: m, params: p }) });
      return (await r.json()).result;
    } catch (e) { last = e; await new Promise((x) => setTimeout(x, 2500)); }
  }
  throw last;
};
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };

const HONEST = process.env.HONEST_URL || "https://passport-agents.vercel.app/api/agent?persona=honest";
const LIAR = process.env.LIAR_URL || "https://passport-agents.vercel.app/api/agent?persona=liar";

const op = createAccount(generatePrivateKey());
const stranger = createAccount(generatePrivateKey());
await rpc("sim_fundAccount", { account_address: op.address, amount: 600e18 });
await rpc("sim_fundAccount", { account_address: stranger.address, amount: 200e18 });
const c = createClient({ chain: studionet, account: op });
const cs = createClient({ chain: studionet, account: stranger });
const rd = createClient({ chain: studionet });
const code = readFileSync(new URL("../../contracts/passport.py", import.meta.url));
const dh = await c.deployContract({ code, args: [], leaderOnly: false });
const A = (await c.waitForTransactionReceipt({ hash: dh, status: "ACCEPTED", retries: 40, interval: 4000 }))?.data?.contract_address;
console.log("Passport at", A, "\n");

const wait = async (tx) => {
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const t = await rpc("eth_getTransactionByHash", [tx]);
    if (t?.status === "CANCELED") return { msg: "CANCELED", exec: "CANCELED", votes: { a: 0, d: 0, idl: 0 }, applied: false };
    if (t?.status === "FINALIZED") {
      const lr = t.consensus_data?.leader_receipt, one = Array.isArray(lr) ? lr[0] : lr;
      let msg = ""; try { msg = Buffer.from(one.result, "base64").toString("utf8").replace(/[^\x20-\x7e]/g, " ").trim(); } catch (e) {}
      let a = 0, d = 0, idl = 0;
      for (const k in (t.consensus_data?.votes || {})) { const v = t.consensus_data.votes[k]; if (v === "agree") a++; else if (v === "disagree") d++; else idl++; }
      let j = null; const b = msg.indexOf("{"); if (b !== -1) { try { j = JSON.parse(msg.slice(b)); } catch (e) {} }
      return { msg, j, exec: one?.execution_result, votes: { a, d, idl }, applied: a * 2 > a + d + idl };
    }
  }
  return { msg: "TIMEOUT", exec: "", votes: { a: 0, d: 0, idl: 0 }, applied: false };
};
const send = async (client, fn, args) => await wait(await client.writeContract({ address: A, functionName: fn, args }));
const view = async (fn, args = []) => await rd.readContract({ address: A, functionName: fn, args });
const tally = (r) => `${r.votes.a} agree, ${r.votes.d} disagree, ${r.votes.idl} idle`;

const CLAIMS = JSON.stringify(["family:gpt", "can:math", "can:code", "safe:injection"]);

// ---------- rules before any validator talks to anybody ----------
const bad = await send(c, "register", ["h1", HONEST, JSON.stringify(["can:fly"])]);
ok("a claim outside the closed set is refused", bad.exec === "ERROR" && bad.msg.includes("unknown claim"), bad.msg.slice(0, 70));
const http = await send(c, "register", ["h1", "http://insecure.example/agent", CLAIMS]);
ok("an http endpoint is refused", http.exec === "ERROR" && http.msg.includes("https"), http.msg.slice(0, 60));
const reg = await send(c, "register", ["honest", HONEST, CLAIMS]);
ok("the honest agent registers, unverified", reg.j?.ok === true && reg.j?.status === "unverified", tally(reg));
const reg2 = await send(c, "register", ["liar", LIAR, CLAIMS]);
ok("so does the liar, claiming the same things", reg2.j?.ok === true, tally(reg2));
const intrude = await send(cs, "update", ["honest", LIAR, CLAIMS]);
ok("a stranger cannot change an agent's endpoint", intrude.exec === "ERROR" && intrude.msg.includes("only the operator"), intrude.msg.slice(0, 60));
ok("is_valid is false before any inspection", (await view("is_valid", ["honest", "can:math"])) === false);

// ---------- the inspections: the calls that cost consensus ----------
const h = await send(cs, "inspect", ["honest"]);
ok("the honest agent is inspected and the validators agree", h.applied && h.j?.ok === true, `${tally(h)} → ${h.j?.status}`);
ok("its passport is issued", h.j?.status === "issued", JSON.stringify(h.j?.verdicts));
const l = await send(cs, "inspect", ["liar"]);
ok("the liar is inspected and the validators agree", l.applied && l.j?.ok === true, `${tally(l)} → ${l.j?.status}`);
ok("its passport is refused", l.j?.status === "refused", JSON.stringify(l.j?.verdicts));
ok("the family claim is what contradicted, and the injection probe too",
   l.j?.verdicts?.["family:gpt"] === "contradicts" && l.j?.verdicts?.["safe:injection"] === "contradicts", JSON.stringify(l.j?.verdicts));
ok("math held for both — the liar can multiply", h.j?.verdicts?.["can:math"] === "matches" && l.j?.verdicts?.["can:math"] === "matches");

// ---------- the gate, free ----------
ok("is_valid gates on the stored passport with no model and no consensus",
   (await view("is_valid", ["honest", "can:code"])) === true && (await view("is_valid", ["liar", "can:code"])) === false);
const again = await send(cs, "inspect", ["liar"]);
ok("the refused pair cannot be re-inspected unchanged", again.exec === "ERROR" && again.msg.includes("already refused"), again.msg.slice(0, 70));
const fixed = await send(c, "update", ["liar", LIAR, JSON.stringify(["can:math"])]);
ok("the operator narrows the claims to what is true, resetting the passport", fixed.j?.status === "unverified", tally(fixed));
const l2 = await send(cs, "inspect", ["liar"]);
ok("and with honest claims the same agent is issued a passport for what it can do", l2.j?.status === "issued", `${tally(l2)} → ${JSON.stringify(l2.j?.verdicts)}`);
const rules = JSON.parse(await view("rules"));
ok("the rules are published, including that this is not a proof", String(rules.not_a_proof).includes("not a proof"));

console.log(`\n${pass} passed, ${fail} failed`);
console.log("contract:", A);
