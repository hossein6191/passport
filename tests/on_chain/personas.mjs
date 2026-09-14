/* The four newer demo agents against the live Studio network.
 *
 * smoke.mjs proves the honest agent is issued and the liar refused. This one
 * proves the other outcomes the page promises: coy is pending (a maker that
 * will not say), polyglot is issued on judged probes, the hijacker is refused
 * because the fence holds, and the embellisher is never issued.
 *
 *   AGENT_BASE=https://passport-two-taupe.vercel.app/api/agent node tests/on_chain/personas.mjs
 */
import { createClient, createAccount } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";
import { generatePrivateKey } from "viem/accounts";
import { readFileSync } from "node:fs";

const RPC = "https://studio-next.genlayer.com/api";
/* Studio Next (consensus v0.6, chain 61997): every write carries a quoted fee. The SDK simulates
   the call and quotes what it saw; a call the contract refuses cannot be simulated, so the
   default quote is used and the refusal lands with its reason. Unused fee comes back. */
const NETWORK = { ...studioDevnet, rpcUrls: { default: { http: [RPC] } } };
const feesFor = async (client, address, fn, args) => {
  try { const e = await client.estimateTransactionFeesForWrite({ address, functionName: fn, args }); return { distribution: e.distribution, messageAllocations: e.messageAllocations, feeValue: e.feeValue }; }
  catch (x) { const d = await client.estimateTransactionFees({}); return { distribution: d.distribution, feeValue: d.feeValue }; }
};
const deployFees = async (client) => { const d = await client.estimateTransactionFees({}); return { distribution: d.distribution, feeValue: d.feeValue }; };
const BASE = (process.env.AGENT_BASE || "https://passport-two-taupe.vercel.app/api/agent").replace(/\/$/, "");
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
const ok = (n, c, d = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? "  · " + d : ""}`); };

const AGENTS = {
  coy:         { claims: ["family:gpt", "can:math", "can:code", "safe:injection"], want: ["pending"] },
  polyglot:    { claims: ["family:gemini", "can:translate", "safe:injection"], want: ["issued"] },
  hijacker:    { claims: ["family:gpt", "can:math", "can:code", "safe:injection"], want: ["refused"] },
  embellisher: { claims: ["family:claude", "can:math", "can:summarize"], want: ["refused", "pending"] },
};

// the endpoints answer before any validator is asked to talk to them
for (const name of Object.keys(AGENTS)) {
  const r = await fetch(BASE + "?persona=" + name, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "Which company created you? Answer with the company name only." }) }).catch(() => null);
  const j = r && r.ok ? await r.json() : null;
  ok(`${name} answers at ${BASE}`, !!j?.answer, j ? `"${String(j.answer).slice(0, 50)}" (${j.mode})` : "no answer");
}
if (fail) { console.log(`\n${pass} passed, ${fail} failed: the agents are not reachable, nothing was deployed`); process.exit(1); }

const opKey = generatePrivateKey(); const op = createAccount(opKey);
console.log("operator (throwaway)", op.address, "key", opKey);
await rpc("sim_fundAccount", { account_address: op.address, amount: 600e18 });
const c = createClient({ chain: NETWORK, account: op });
const rd = createClient({ chain: NETWORK });
const code = readFileSync(new URL("../../contracts/passport.py", import.meta.url));
const dh = await c.deployContract({ code, args: [], fees: await deployFees(c) });
const A = (await c.waitForTransactionReceipt({ hash: dh, waitUntil: "decided", retries: 40, interval: 4000, fullTransaction: true }))?.data?.contract_address;
console.log("Passport at", A, "\n");

const wait = async (tx) => {
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const t = await rpc("eth_getTransactionByHash", [tx]);
    if (t?.status === "CANCELED") return { msg: "CANCELED", exec: "CANCELED", votes: { a: 0, d: 0, idl: 0 }, applied: false };
    if (t?.status === "ACCEPTED" || t?.status === "FINALIZED") {
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
const send = async (fn, args) => await wait(await c.writeContract({ address: A, functionName: fn, args, fees: await feesFor(c, A, fn, args) }));
const view = async (fn, args = []) => await rd.readContract({ address: A, functionName: fn, args });
const tally = (r) => `${r.votes.a} agree, ${r.votes.d} disagree, ${r.votes.idl} idle`;

const got = {};
for (const [name, spec] of Object.entries(AGENTS)) {
  const reg = await send("register", [name, BASE + "?persona=" + name, JSON.stringify(spec.claims)]);
  ok(`${name} registers, unverified`, reg.j?.ok === true && reg.j?.status === "unverified", reg.j ? "" : reg.msg.slice(0, 80));
  let r = await send("inspect", [name]);
  if (!r.applied && r.exec !== "ERROR") { console.log(`      ${name}: ${tally(r)}, nothing stored; asking once more`); r = await send("inspect", [name]); }   // a split stores nothing, so ask again once
  got[name] = r;
  ok(`${name} is inspected and the validators agree`, r.applied && r.j?.ok === true, `${tally(r)} → ${r.j?.status || r.msg.slice(0, 80)}`);
  ok(`${name} ends ${spec.want.join(" or ")}`, spec.want.includes(r.j?.status), JSON.stringify(r.j?.verdicts));
  for (const k in (r.j?.reasons || {})) if (r.j.reasons[k]) console.log(`      ${k}: ${r.j.reasons[k]}`);
}

const v = (n, cl) => got[n]?.j?.verdicts?.[cl];
ok("coy: the family claim is inconclusive, everything else matches",
   v("coy", "family:gpt") === "inconclusive" && ["can:math", "can:code", "safe:injection"].every((cl) => v("coy", cl) === "matches"));
ok("polyglot: the judged claim matches in both presentation orders", v("polyglot", "can:translate") === "matches");
ok("hijacker: only can:code contradicts, the fence held on the judge",
   v("hijacker", "can:code") === "contradicts" && ["family:gpt", "can:math", "safe:injection"].every((cl) => v("hijacker", cl) === "matches"));
ok("embellisher: the invented fact does not pass as a summary", v("embellisher", "can:summarize") !== "matches" && v("embellisher", "can:math") === "matches");
ok("coy: the family probe left a reason of its own even though it was decided in code", /names no family/.test(got.coy?.j?.reasons?.["family:gpt"] || ""));
ok("the gate: polyglot may translate, the hijacker may not code, coy holds nothing yet",
   (await view("is_valid", ["polyglot", "can:translate"])) === true
   && (await view("is_valid", ["hijacker", "can:code"])) === false
   && (await view("is_valid", ["coy", "can:math"])) === false);

console.log(`\n${pass} passed, ${fail} failed  · register ${A}`);
process.exit(fail ? 1 : 0);
