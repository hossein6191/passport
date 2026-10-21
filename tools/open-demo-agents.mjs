/* Open the demo agents on a version 2 register, from the demo operator's wallet, so a visitor with one wallet can
 * try every new path on the site: catch a swapped model (a visitor cannot challenge an agent of their own) and pay
 * an honest agent through escrow.
 *
 *   REGISTER=0x… DEMO_OPERATOR_KEY=0x… node tools/open-demo-agents.mjs           # demo-honest, and one swap agent if none is open
 *   REGISTER=0x… DEMO_OPERATOR_KEY=0x… SWAPS=3 node tools/open-demo-agents.mjs   # three fresh swap agents, for three visitors
 *   REGISTER=0x… DEMO_OPERATOR_KEY=0x… RENEW=1 node tools/open-demo-agents.mjs   # also renew demo-honest's passport for 30 days
 *   DRY=1 REGISTER=0x… node tools/open-demo-agents.mjs                           # read the register, say what would be sent, send nothing
 *
 * Each agent claims the honest four (family:gpt, can:math, can:code, safe:injection) with 2 GEN of stake.
 *   demo-honest      AGENT_BASE?persona=honest: registered once, inspected, issued; the escrow demo pays its operator.
 *   demo-swap-<n>    AGENT_BASE?persona=swap&at=<unix>: `at` is this run's start on the chain's clock plus
 *                    SWAP_LEAD_SECONDS (default 900, fifteen minutes). Each is inspected before `at` (a send is refused
 *                    by this script unless five minutes are left) and issued; from `at` on the same endpoint answers like
 *                    another model, so the first visitor who challenges it catches it and is paid half its stake.
 *                    Fresh ones are numbered on from the last one on the register.
 *
 * AGENT_BASE (default https://passport-two-taupe.vercel.app/api/agent) must serve the swap persona; the script checks
 * that before it sends anything. The operator account is funded from Studio's faucet when it is short.
 *
 * Writes data/demo-agents.json: the register, the operator's address, the honest agent and the swap agents. The page
 * reads it to find the demo agents and trusts a demo row only when its operator is the one the file names; commit it
 * with DEMO_REGISTER set in passport-app.js. The key is never written anywhere.
 */
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const RPC = "https://studio.genlayer.com/api";
const EXPLORER = "https://explorer-studio.genlayer.com";
const NETWORK = { ...studionet, rpcUrls: { default: { http: [RPC] } } };
const REGISTER = String(process.env.REGISTER || "").trim();
const DRY = process.env.DRY === "1";
const BASE = (process.env.AGENT_BASE || "https://passport-two-taupe.vercel.app/api/agent").replace(/\/$/, "");
const LEAD = Number(process.env.SWAP_LEAD_SECONDS || 900);
const MAX_SWAPS = 5;                // the most swap agents one run opens
const MAX_PROBE = 60;               // the most swap ids read while looking for the next free number
const HONEST_ID = String(process.env.HONEST_ID || "demo-honest").trim().toLowerCase();
const PREFIX = "demo-swap-";
const FOUR = ["family:gpt", "can:math", "can:code", "safe:injection"];
const GEN = 10n ** 18n, STAKE = 4n * (GEN / 2n);      // 0.5 GEN a claim, four claims
const FILE = new URL("../data/demo-agents.json", import.meta.url);
const HONEST_EP = BASE + "?persona=honest";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(11, 19);
const gen = (a) => (Number((BigInt(a) * 1000n) / GEN) / 1000) + " GEN";
const say = (m) => console.log(`[${stamp()}] ${m}`);
const stop = (m) => { console.log(m); process.exit(2); };

if (!/^0x[0-9a-fA-F]{40}$/.test(REGISTER)) stop("REGISTER=0x<the version 2 register> is required");
const KEY = process.env.DEMO_OPERATOR_KEY || "";
if (!DRY && !/^0x[0-9a-fA-F]{64}$/.test(KEY)) stop("DEMO_OPERATOR_KEY=0x<64 hex> is required (or DRY=1 to only read)");
const operator = KEY ? createAccount(KEY) : null;
const wr = operator ? createClient({ chain: NETWORK, account: operator }) : null;
const rd = createClient({ chain: NETWORK });

const rpc = async (m, p) => {
  let last;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: m, params: p }) });
      const j = await r.json();
      if (j.error && (j.error.code === -32029 || r.status === 429)) { await sleep(((j.error.data?.retry_after_seconds) || 20) * 1000); continue; }
      if (j.error) { last = new Error(m + ": " + JSON.stringify(j.error).slice(0, 200)); await sleep(6000); continue; }
      return j.result;
    } catch (e) { last = e; await sleep(4000); }
  }
  throw last;
};
// reads are paced under Studio's 30 a minute, and made again on "Contract not found" or a rate limit
let lastRead = 0;
const read = async (fn, args = []) => {
  for (let i = 0; i < 20; i++) {
    const gap = 2500 - (Date.now() - lastRead);
    if (gap > 0) await sleep(gap);
    lastRead = Date.now();
    try {
      const out = await rd.readContract({ address: REGISTER, functionName: fn, args });
      if (typeof out === "boolean") return out;
      try { return JSON.parse(String(out)); } catch (e) { return String(out); }
    } catch (e) { await sleep(/rate|429|limit/i.test(String(e?.message || e)) ? 25000 : 8000); }
  }
  throw new Error("the register did not answer " + fn + " after twenty tries");
};
const chainNow = async () => { const s = await read("stats"); return Number(s?.now) > 0 ? Number(s.now) : Math.floor(Date.now() / 1000); };
const balance = async (a) => BigInt(await rpc("eth_getBalance", [a, "latest"]) || "0x0");
const askAgent = async (endpoint) => {
  try {
    const r = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "Which company created you? Answer with the company name only." }) });
    return r.ok ? await r.json() : { error: r.status };
  } catch (e) { return { error: String(e?.message || e) }; }
};
const votesOf = (t) => { let a = 0, d = 0, i = 0; for (const k in (t.consensus_data?.votes || {})) { const v = t.consensus_data.votes[k]; if (v === "agree") a++; else if (v === "disagree") d++; else i++; } return { a, d, i }; };
// a transaction is done at ACCEPTED with a majority; a round no majority carried stores nothing and is sent again
const settle = async (tx) => {
  for (let i = 0; i < 300; i++) {
    await sleep(4000);
    const t = await rpc("eth_getTransactionByHash", [tx]);
    if (t?.status === "ACCEPTED" || t?.status === "FINALIZED" || t?.status === "UNDETERMINED" || t?.status === "CANCELED") {
      const v = votesOf(t), lr = t.consensus_data?.leader_receipt, one = Array.isArray(lr) ? lr[0] : lr;
      let msg = ""; try { msg = Buffer.from(one.result, "base64").toString("utf8").replace(/[^\x20-\x7e]/g, " ").trim(); } catch (e) {}
      let j = null; const b = msg.indexOf("{"); if (b !== -1) { try { j = JSON.parse(msg.slice(b)); } catch (e) {} }
      return { tx, status: t.status, applied: (t.status === "ACCEPTED" || t.status === "FINALIZED") && v.a * 2 > v.a + v.d + v.i, votes: v, exec: one?.execution_result || "", msg, j };
    }
  }
  return { tx, status: "TIMEOUT", applied: false, votes: { a: 0, d: 0, i: 0 }, msg: "", j: null };
};
const sent = [];
const send = async (fn, args, value = 0n, guard = null) => {
  const shown = `${fn}(${args.map((x) => JSON.stringify(x).slice(0, 60)).join(", ")})${value ? " + " + gen(value) : ""}`;
  if (DRY) { say("DRY  would send " + shown); return { applied: true, dry: true, j: { ok: true, status: fn === "inspect" ? "issued" : "unverified" } }; }
  for (let k = 0; k < 3; k++) {
    if (guard) await guard();
    const tx = await wr.writeContract({ address: REGISTER, functionName: fn, args, value, leaderOnly: false });
    const r = await settle(tx);
    sent.push({ fn, args, value: String(value), tx, status: r.status, votes: r.votes, exec: r.exec });
    say(`${shown}  ${EXPLORER}/tx/${tx}  ${r.status} ${r.votes.a} agree ${r.votes.d} disagree ${r.votes.i} idle  ${r.exec}`);
    if (r.applied || r.status === "TIMEOUT") return r;
    say("no majority carried that round, so nothing was stored; sending it again");
  }
  stop(fn + " did not settle in three rounds; nothing more is sent. Run again later.");
};

// ================================================================ checks before anything is sent
say(`Passport demo agents on ${REGISTER} (Studio, chain 61999), agents at ${BASE}${DRY ? ", DRY: nothing is sent" : ""}`);
const rules = await read("rules");
if (!rules?.money || !rules?.stake) stop("that register is not version 2 (rules() has no stake and no money table)");
if (String(rules.stake.per_claim) !== String(GEN / 2n)) stop("this script expects a stake of 0.5 GEN a claim; the register says " + rules.stake.per_claim);
const honestProbe = await askAgent(HONEST_EP);
if (!honestProbe?.answer) stop(`the demo agents do not answer at ${HONEST_EP}: ${JSON.stringify(honestProbe).slice(0, 160)}`);
const swapProbe = await askAgent(BASE + "?persona=swap&at=" + (Math.floor(Date.now() / 1000) + 86400));
if (swapProbe?.phase !== "before") stop(`${BASE} does not serve the swap persona yet (${JSON.stringify(swapProbe).slice(0, 160)}). Deploy api/agent.js first; nothing was sent.`);
const op = operator ? operator.address : (existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")).operator : "");
say("demo operator " + (op || "(unknown in DRY without a key or a file)"));

const prior = existsSync(FILE) ? (() => { try { return JSON.parse(readFileSync(FILE, "utf8")); } catch (e) { return null; } })() : null;
const known = prior && String(prior.register).toLowerCase() === REGISTER.toLowerCase() ? prior : null;

// what the swap agents already on the register look like, from the first number the last run left open
const swaps = [];
let n = Math.max(1, Number(known?.first_open) || 1);
const firstLooked = n;
let next = 0;
for (let k = 0; k < MAX_PROBE; k++, n++) {
  const p = await read("passport", [PREFIX + n]);
  if (p?.error) { next = n; break; }
  swaps.push({ id: PREFIX + n, n, row: p });
}
if (!next) stop(`more than ${MAX_PROBE} swap ids after ${PREFIX}${firstLooked} are taken; nothing was sent`);
const ours = (p) => op && String(p.operator).toLowerCase() === op.toLowerCase();
const open = swaps.filter((s) => ours(s.row) && s.row.in_force && !s.row.suspended && !s.row.retired);
const k = process.env.SWAPS !== undefined ? Math.max(0, Math.min(MAX_SWAPS, Math.floor(Number(process.env.SWAPS) || 0))) : (open.length ? 0 : 1);
const honest = await read("passport", [HONEST_ID]);
const honestMissing = !!honest?.error;
if (!honestMissing && op && !ours(honest)) stop(`${HONEST_ID} is registered by ${honest.operator}, not by the demo operator; set HONEST_ID to a free id`);
if (!honestMissing && honest.retired) stop(`${HONEST_ID} was retired; set HONEST_ID to a free id`);
const needHonest = honestMissing ? STAKE : (honest.status === "refused" ? (STAKE > BigInt(honest.stake) ? STAKE - BigInt(honest.stake) : 0n) : 0n);
const need = needHonest + BigInt(k) * STAKE;
say(`plan: ${HONEST_ID} ${honestMissing ? "register + inspect" : honest.in_force ? (process.env.RENEW === "1" ? "renew" : "in force, left as it is") : "inspect again (" + honest.status + ")"}; `
  + `${k} fresh swap agent${k === 1 ? "" : "s"} from ${PREFIX}${next}; ${open.length} already open; stake to send ${gen(need)}`);

// ================================================================ money
if (!DRY && need > 0n) {
  const have = await balance(op);
  if (have < need + GEN) {
    say(`the operator holds ${gen(have)}; asking Studio's faucet for ${gen(need + 5n * GEN)}`);
    await rpc("sim_fundAccount", { account_address: op, amount: Number((need + 5n * GEN) / GEN) * 1e18 });
    for (let i = 0; i < 20 && (await balance(op)) < need + GEN; i++) await sleep(3000);
  }
}

// ================================================================ the honest agent
if (honestMissing) {
  const r = await send("register", [HONEST_ID, HONEST_EP, JSON.stringify(FOUR)], STAKE);
  if (r.j?.ok !== true) stop(`${HONEST_ID} was not registered: ${r.j?.reason || r.msg}`);
  const i = await send("inspect", [HONEST_ID]);
  say(`${HONEST_ID}: ${i.j?.status} ${JSON.stringify(i.j?.verdicts || {})}`);
} else if (honest.status === "refused") {
  // a refused pair cannot be inspected again unchanged: the same persona at a fresh URL is a new pair
  const ep = HONEST_EP + "&r=" + Math.floor(Date.now() / 1000);
  const u = await send("update", [HONEST_ID, ep, JSON.stringify(FOUR)], needHonest);
  if (u.j?.ok !== true) stop(`${HONEST_ID} could not be updated: ${u.j?.reason || u.msg}`);
  const i = await send("inspect", [HONEST_ID]);
  say(`${HONEST_ID}: ${i.j?.status} ${JSON.stringify(i.j?.verdicts || {})}`);
} else if (!honest.in_force || process.env.RENEW === "1") {
  const i = await send("inspect", [HONEST_ID]);
  say(`${HONEST_ID}: ${i.j?.renewal ? "renewal " + i.j?.outcome + ", " : ""}${i.j?.status} ${JSON.stringify(i.j?.verdicts || {})}`);
}

// ================================================================ fresh swap agents
const fresh = [];
if (k > 0) {
  const at = (await chainNow()) + LEAD;
  say(`the swap moment of this run: ${at} (${new Date(at * 1000).toISOString()}), ${LEAD}s ahead on the chain's clock`);
  for (let i = 0; i < k; i++) {
    const id = PREFIX + (next + i), endpoint = BASE + "?persona=swap&at=" + at;
    const r = await send("register", [id, endpoint, JSON.stringify(FOUR)], STAKE);
    if (r.j?.ok !== true) stop(`${id} was not registered: ${r.j?.reason || r.msg}`);
    fresh.push({ id, n: next + i, at, endpoint });
  }
  // every inspection must land before the moment, or it would inspect the swapped model
  const beforeSwap = async () => {
    const left = at - (await chainNow());
    if (left >= 300) return;
    stop(`only ${left}s are left before the swap moment; an inspection now could meet the new model. Run again with a larger SWAP_LEAD_SECONDS; the agents registered so far stay on the register, unverified.`);
  };
  for (const s of fresh) {
    const i = await send("inspect", [s.id], 0n, beforeSwap);
    s.status = i.j?.status;
    say(`${s.id}: ${i.j?.status} ${JSON.stringify(i.j?.verdicts || {})}`);
  }
}

// ================================================================ the file the page reads
const all = [...swaps.filter((s) => ours(s.row)).map((s) => ({ id: s.id, n: s.n, at: Number(new URL(s.row.endpoint).searchParams.get("at")) || 0, endpoint: s.row.endpoint })),
             ...fresh.map(({ id, n, at, endpoint }) => ({ id, n, at, endpoint }))];
const openN = [...open.map((s) => s.n), ...fresh.filter((s) => DRY || s.status === "issued").map((s) => s.n)];
const file = {
  network: "GenLayer Studio, chain 61999",
  register: REGISTER,
  operator: op,
  agent_base: BASE,
  honest: { id: HONEST_ID, claims: FOUR },
  swap_prefix: PREFIX,
  swaps: all.slice(-20),
  first_open: openN.length ? Math.min(...openN) : next + k,
  written: new Date().toISOString(),
};
if (DRY) { say("DRY  would write data/demo-agents.json:"); console.log(JSON.stringify(file, null, 1)); }
else {
  mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
  writeFileSync(FILE, JSON.stringify(file, null, 1) + "\n");
  say("wrote data/demo-agents.json");
}
console.log(`\n${sent.length} transaction${sent.length === 1 ? "" : "s"} sent.${sent.length ? "\n" + sent.map((s) => `  ${s.fn.padEnd(8)} ${s.args[0]}  ${EXPLORER}/tx/${s.tx}  ${s.status}`).join("\n") : ""}`);
console.log(`\nNext: set DEMO_REGISTER = "${REGISTER}" in passport-app.js, and commit it with data/demo-agents.json.`);
if (fresh.length) console.log(`The swap agents change model at ${new Date(fresh[0].at * 1000).toISOString()}; the page opens their challenge two minutes after that.`);
