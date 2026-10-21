/* Passport version 2 against GenLayer Studio (chain 61999). Deploys its own register and two escrow jobs.
 *
 *   npm ci                                                   # genlayer-js 1.1.8 and viem, pinned
 *   node tests/on_chain/smoke.mjs                            # the whole run, about half an hour
 *   RESUME=1 node tests/on_chain/smoke.mjs                   # continue a run that was cut off, from the saved state
 *
 * Four accounts. OPERATOR_KEY, BUYER_KEY, CHALLENGER_KEY and STRANGER_KEY are used when they are set (they are
 * never written to disk); any that is not set is generated, kept in the state file, and funded from the faucet.
 * AGENT_BASE is the demo agents' function (default https://passport-two-taupe.vercel.app/api/agent); it must
 * serve the `swap` persona with `to=coy`. SWAP_LEAD_SECONDS (default 1200) is how far ahead the swap moment is set.
 *
 * A four-claim passport holds 2 GEN of stake, so a challenge of it is bonded with 0.2 GEN (a tenth) and an
 * inconclusive one costs 0.1 GEN (a twentieth); a revoke pays the challenger 1 GEN.
 *
 * Phases:
 *   A  deploy the register; a registration claiming can:fly is refused and its 0.5 GEN comes back in the same
 *      transaction; a registration that sends the wrong stake is refused and refunded; `honest` registers four
 *      claims with 2 GEN of stake; a stranger cannot update it; the operator adds a fifth claim with exactly the
 *      0.5 GEN it lacks and removes it again, the excess 0.5 GEN coming back in that transaction; the challenger
 *      deposits 0.5 GEN of credit.
 *   B  the operator inspects `honest`: issued. A stranger with no credit cannot challenge it, nor can the operator;
 *      the challenger challenges it: every claim holds, and the 0.2 GEN bond goes to the operator in that
 *      transaction; the same challenger cannot challenge it again inside the cooldown.
 *   C  `swap` and `drift` register the same four claims with 2 GEN each, at endpoints that answer like `honest`
 *      until a moment `at` about twenty minutes ahead; after it, `swap` answers like another model and `drift`
 *      will not say who made it. Both are inspected before `at` (each send is refused by this script unless five
 *      minutes are left): issued. The buyer funds an escrow job on `swap` (3 GEN) and one on `honest` (2 GEN),
 *      each bound to the operator and endpoint.
 *   D  after `at` on the chain's clock, and once the agent itself answers from the far side of it, the challenger
 *      challenges `swap`: the claims are contradicted, the passport is revoked, the 2 GEN stake is slashed, 1 GEN to
 *      the challenger in that transaction and 1 GEN kept by the register; the operator cannot inspect the same pair
 *      again. The challenger challenges `drift`: the family claim is inconclusive, the passport stands, and the
 *      0.1 GEN fee goes from the challenger's credit to the operator. The job on `swap` settles: the buyer gets the
 *      3 GEN back. The job on `honest` settles: the operator is paid 2 GEN on chain.
 *   E  the operator retires `honest`: it stays in force through the one-day hold, and unstake is refused until
 *      the hold ends (RESUME=1 after the hold takes the 2 GEN back, and phase F then reads the views afresh); the
 *      challenger takes back what is left of its credit.
 *   F  the deployed code of the register and both jobs is read back and compared with these files byte for byte,
 *      the views are checked against what the run did, and every balance against the money table.
 *
 * Every refusal is a signed transaction. Payments are read from balances after finalisation. Transactions are
 * polled with eth_getTransactionByHash, never with views. A round the validators do not carry stores nothing; it
 * is sent again and both transactions are kept. Every step is saved as it is made, so a run that is cut off
 * continues without sending twice. Contract addresses and challenge numbers are read from the receipts, and every
 * wait is on the chain's own clock.
 */
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { generatePrivateKey } from "viem/accounts";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RPC = "https://studio.genlayer.com/api";
const EXPLORER = "https://explorer-studio.genlayer.com";
const BASE = (process.env.AGENT_BASE || "https://passport-two-taupe.vercel.app/api/agent").replace(/\/$/, "");
const LEAD = Number(process.env.SWAP_LEAD_SECONDS || 1200);
const STATE = process.env.STATE || join(tmpdir(), "passport-v2-smoke-state.json");
const RECORD = process.env.RECORD || STATE.replace(/\.json$/, "") + "-record.json";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(11, 19);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const rpc = async (m, p) => {
  let last;
  for (let i = 0; i < 90; i++) {
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
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? "  - " + d : ""}`); return !!c; };
const GEN = 10n ** 18n;
const STAKE = GEN / 2n, BOND = (4n * STAKE) / 10n, FEE = (4n * STAKE) / 20n;   // the bond and fee of a four-claim passport
const tally = (v) => `${v.agree} agree, ${v.disagree} disagree, ${v.idle} idle`;
const FOUR = JSON.stringify(["family:gpt", "can:math", "can:code", "safe:injection"]);
const HONEST_EP = BASE + "?persona=honest";

// ---------- state: accounts, addresses and every step already made survive a cut-off run ----------
if (existsSync(STATE) && !process.env.RESUME && !process.env.FRESH) {
  console.log(`A saved run exists at ${STATE}.\nRESUME=1 continues it; FRESH=1 starts over; STATE=<path> keeps another.`);
  process.exit(2);
}
const st = existsSync(STATE) && process.env.RESUME && !process.env.FRESH ? JSON.parse(readFileSync(STATE, "utf8")) : {};
st.keys = st.keys || {}; st.steps = st.steps || {}; st.views = st.views || {}; st.order = st.order || [];
const save = () => {
  writeFileSync(STATE, JSON.stringify(st, null, 1));
  const { keys, ...shown } = st;       // the record carries no key
  writeFileSync(RECORD, JSON.stringify(shown, null, 1));
};
const ROLES = { operator: "OPERATOR_KEY", buyer: "BUYER_KEY", challenger: "CHALLENGER_KEY", stranger: "STRANGER_KEY" };
const NEED = { operator: 9, buyer: 6, challenger: 1, stranger: 1 };      // whole GEN each account needs for the run
const acct = {}, client = {};
st.accounts = st.accounts || {};
for (const [k, env] of Object.entries(ROLES)) {
  const key = process.env[env] || st.keys[k] || (st.keys[k] = generatePrivateKey());
  acct[k] = createAccount(key);
  if (st.accounts[k] && st.accounts[k].toLowerCase() !== acct[k].address.toLowerCase()) {
    console.log(`This saved run used ${st.accounts[k]} as ${k}; set ${env} to that account's key or start over with FRESH=1.`);
    process.exit(2);
  }
  st.accounts[k] = acct[k].address;
  client[k] = createClient({ chain: studionet, account: acct[k] });
}
const rd = createClient({ chain: studionet });
const low = (k) => acct[k].address.toLowerCase();
save();

const balance = async (a) => BigInt(await rpc("eth_getBalance", [a, "latest"]) || "0x0");
const nonceOf = async (a) => Number(BigInt(await rpc("eth_getTransactionCount", [a, "latest"]) || "0x0"));
const fundIfShort = async (k) => {
  st.funded = st.funded || {};
  if (st.funded[k]) return;
  if ((await balance(acct[k].address)) < BigInt(NEED[k]) * GEN) {
    await rpc("sim_fundAccount", { account_address: acct[k].address, amount: (NEED[k] + 4) * 1e18 });
    for (let i = 0; i < 20 && (await balance(acct[k].address)) < BigInt(NEED[k]) * GEN; i++) await sleep(3000);
  }
  st.funded[k] = String(await balance(acct[k].address)); save();
};

// ---------- transactions ----------
const errText = (e) => String(e?.details || e?.shortMessage || e?.cause?.message || e?.message || e);
// A request the network refused or never received is made again. When the failure is ambiguous the sender's
// nonce says whether the transaction landed after all, and its hash is read back, so nothing is sent twice.
const sendRaw = async (who, what, make) => {
  const addr = acct[who].address;
  for (let i = 0; ; i++) {
    const n0 = await nonceOf(addr);
    try { return await make(); } catch (e) {
      if (i >= 8) throw e;
      console.log(`      ${what} was not taken (${errText(e).slice(0, 70)}); looking again in 20s`);
      await sleep(20000);
      if ((await nonceOf(addr)) > n0) {
        const list = await rpc("sim_getTransactionsForAddress", [addr]);
        const hit = (list || []).find((t) => String(t.from_address).toLowerCase() === addr.toLowerCase() && Number(t.nonce) === n0);
        if (hit?.hash) return hit.hash;
        throw new Error(what + " landed but its hash could not be read back");
      }
    }
  }
};
const votesOf = (t) => {
  let a = 0, d = 0, idl = 0;
  for (const k in (t.consensus_data?.votes || {})) { const v = t.consensus_data.votes[k]; if (v === "agree") a++; else if (v === "disagree") d++; else idl++; }
  return { agree: a, disagree: d, idle: idl };
};
const wait = async (tx) => {
  let stuck = 0;
  for (let i = 0; i < 900; i++) {
    await sleep(4000);
    const t = await rpc("eth_getTransactionByHash", [tx]);
    if (t?.status === "FINALIZED") {
      const lr = t.consensus_data?.leader_receipt, one = Array.isArray(lr) ? lr[0] : lr;
      let msg = "";
      try { msg = Buffer.from(one.result, "base64").toString("utf8").replace(/[^\x20-\x7e]/g, " ").trim(); } catch (e) {}
      const votes = votesOf(t);
      return { tx, msg, exec: one?.execution_result || "", votes, applied: votes.agree * 2 > votes.agree + votes.disagree + votes.idle, address: t.data?.contract_address || t.to_address || "" };
    }
    // a round no majority carried is final as it stands once it has been left alone for ten minutes
    if (t?.status === "UNDETERMINED" && (stuck = stuck + 1) > 150) return { tx, msg: "UNDETERMINED", exec: "", votes: votesOf(t), applied: false, address: "" };
    if (t?.status === "CANCELED") return { tx, msg: "CANCELED", exec: "", votes: { agree: 0, disagree: 0, idle: 0 }, applied: false, address: "" };
    if (i > 0 && i % 75 === 0) console.log(`      [${stamp()}] still ${t?.status || "unknown"} after ${Math.round(i * 4 / 60)} minutes: ${tx}`);
  }
  return { tx, msg: "TIMEOUT", exec: "", votes: { agree: 0, disagree: 0, idle: 0 }, applied: false, address: "" };
};
const jsonOf = (msg) => { const b = String(msg).indexOf("{"); if (b === -1) return null; try { return JSON.parse(String(msg).slice(b)); } catch (e) { return null; } };
const settle = async (a, before, want) => { for (let i = 0; i < 45; i++) { const b = await balance(a); if (b - before === want) return b; await sleep(4000); } return await balance(a); };

// One step of the run: a signed transaction, its tally, what it returned, and the balances it moved. opt.value is
// what is sent with it; opt.watch names accounts whose balances are read before and after, and opt.expect the
// change each should show once the transfers have landed; opt.guard runs before every send, a resend included,
// and stops the run when sending is no longer safe. A step already in the saved state is not sent again.
const call = async (id, who, target, fn, args = [], opt = {}) => {
  if (!st.steps[id]) { st.steps[id] = { id, who, target, fn, args: args.map(String), value: String(opt.value || 0n), tries: [] }; st.order.push(id); }
  const rec = st.steps[id];
  if (!rec.done) {
    const watch = opt.watch || {};
    if (!rec.before) { rec.before = {}; for (const [k, a] of Object.entries(watch)) rec.before[k] = String(await balance(a)); save(); }
    for (;;) {
      if (!rec.pending) {
        if (opt.guard) await opt.guard();
        rec.pending = await sendRaw(who, fn, () => client[who].writeContract({ address: st[target], functionName: fn, args, ...(opt.value ? { value: opt.value } : {}) }));
        save();
      }
      const r = await wait(rec.pending);
      rec.tries.push({ tx: r.tx, votes: r.votes, exec: r.exec, applied: r.applied, msg: r.msg });
      rec.pending = null; save();
      console.log(`      [${stamp()}] ${who.toUpperCase()} ${fn}(${args.map((x) => String(x).slice(0, 24)).join(", ")})${opt.value ? " +" + Number(opt.value * 1000n / GEN) / 1000 + " GEN" : ""}  ${r.tx}  ${tally(r.votes)}  ${r.exec}`);
      if (r.msg === "TIMEOUT" || rec.tries.length >= 4) break;
      if (!r.applied) { console.log("      the validators did not carry that round (" + tally(r.votes) + "), so nothing was stored; sending it again"); continue; }
      break;
    }
    rec.after = {}; rec.delta = {};
    for (const [k, a] of Object.entries(watch)) {
      const before = BigInt(rec.before[k]);
      const want = opt.expect && opt.expect[k] !== undefined ? BigInt(opt.expect[k]) : null;
      const now = want === null ? await balance(a) : await settle(a, before, want);
      rec.after[k] = String(now); rec.delta[k] = String(now - before);
    }
    rec.done = true; save();
  }
  const last = rec.tries[rec.tries.length - 1];
  return { ...last, j: jsonOf(last.msg), tries: rec.tries, delta: rec.delta || {} };
};
const refused = (r, words) => r.exec === "ERROR" && r.msg.includes(words);
const moved = (r, k, want) => r.delta[k] === String(want);
const votes = (r) => r.tries.map((t) => tally(t.votes)).join(", then ");

const deploy = async (id, who, path, args) => {
  if (!st.steps[id]) { st.steps[id] = { id, who, target: "", fn: "deploy " + path.split("/").pop(), args: args.map(String), value: "0", tries: [] }; st.order.push(id); }
  const rec = st.steps[id];
  if (!rec.done) {
    const code = readFileSync(new URL(path, import.meta.url));
    for (;;) {
      if (!rec.pending) { rec.pending = await sendRaw(who, "deploy", () => client[who].deployContract({ code, args, leaderOnly: false })); save(); }
      const r = await wait(rec.pending);
      rec.tries.push({ tx: r.tx, votes: r.votes, exec: r.exec, applied: r.applied, msg: r.msg.slice(0, 300) });
      rec.address = r.address; rec.pending = null; save();
      console.log(`      [${stamp()}] ${who.toUpperCase()} deploy ${path.split("/").pop()}  ${r.tx}  ${tally(r.votes)}  ${r.exec}  ${r.address}`);
      if (r.applied || r.msg === "TIMEOUT" || rec.tries.length >= 3) break;
    }
    rec.done = true; save();
  }
  return rec.address;
};

// ---------- reads: paced, and made again on a 429 or on "Contract not found" instead of failing ----------
let lastRead = 0;
const read = async (target, fn, args = []) => {
  for (let i = 0; i < 30; i++) {
    const gap = 2500 - (Date.now() - lastRead);
    if (gap > 0) await sleep(gap);
    lastRead = Date.now();
    try {
      const out = await rd.readContract({ address: st[target], functionName: fn, args });
      if (typeof out === "boolean") return out;
      try { return JSON.parse(String(out)); } catch (e) { return String(out); }
    } catch (e) {
      if (i === 29) return { error: "VIEW ERROR " + fn + ": " + errText(e).slice(0, 100) };
      await sleep(/rate|429|limit/i.test(errText(e)) ? 25000 : 10000);
    }
  }
};
// a view read once for a check is kept with the run, so a continued run checks what was seen then
const seen = async (id, target, fn, args = []) => { if (!st.views[id]) { st.views[id] = { target, fn, args, at: stamp(), out: await read(target, fn, args) }; save(); } return st.views[id].out; };
// the chain's own clock, as the register's views read it
const chainNow = async () => {
  const s = await read("passport", "stats");
  return Number(s?.now) > 0 ? Number(s.now) : Math.floor(Date.now() / 1000);
};
const untilChain = async (when, what) => {
  for (;;) {
    const left = when - (await chainNow());
    if (left <= 0) return;
    console.log(`      [${stamp()}] waiting ${left}s on the chain's clock for ${what}`);
    await sleep(Math.min(left + 5, 120) * 1000);
  }
};
const askAgent = async (endpoint) => {
  try {
    const r = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "Which company created you? Answer with the company name only." }) });
    return r.ok ? await r.json() : { error: r.status + " " + (await r.text()).slice(0, 120) };
  } catch (e) { return { error: errText(e) }; }
};

// ================================================================ start
console.log(`[${stamp()}] Passport v2 smoke on Studio ${RPC}, agents at ${BASE}, state ${STATE}`);
for (const k of Object.keys(ROLES)) await fundIfShort(k);
if (!st.start) { st.start = {}; for (const k of Object.keys(ROLES)) st.start[k] = String(await balance(acct[k].address)); save(); }
for (const k of Object.keys(ROLES)) console.log(`      ${k.padEnd(10)} ${acct[k].address}  ${process.env[ROLES[k]] ? "(from " + ROLES[k] + ")" : "(generated)"}`);
const probe = await askAgent(HONEST_EP);
if (!probe?.answer) { console.log(`The demo agents do not answer at ${HONEST_EP}: ${JSON.stringify(probe).slice(0, 160)}`); process.exit(2); }
const swapProbe = await askAgent(BASE + "?persona=swap&at=" + (Math.floor(Date.now() / 1000) + 86400));
if (swapProbe?.phase !== "before") { console.log(`${BASE} does not serve the swap persona yet (${JSON.stringify(swapProbe).slice(0, 160)}). Deploy api/agent.js first; nothing was sent.`); process.exit(2); }
const coyProbe = await askAgent(BASE + "?persona=swap&at=1&to=coy");
if (coyProbe?.phase !== "after" || coyProbe?.to !== "coy") { console.log(`${BASE} does not serve swap&to=coy yet (${JSON.stringify(coyProbe).slice(0, 160)}). Deploy api/agent.js first; nothing was sent.`); process.exit(2); }

// ================================================================ phase A
console.log(`\n[${stamp()}] ---- phase A: the register, the door, the stake`);
st.passport = await deploy("a1", "operator", "../../contracts/passport.py", []);
ok("the register is deployed", /^0x[0-9a-fA-F]{40}$/.test(st.passport || ""), `${st.passport}  ${EXPLORER}/address/${st.passport}`);
save();
const W = () => ({ operator: acct.operator.address, buyer: acct.buyer.address, challenger: acct.challenger.address, stranger: acct.stranger.address });
{
  const fly = await call("a2", "operator", "passport", "register", ["icarus", HONEST_EP, JSON.stringify(["can:fly"])], { value: STAKE, watch: { operator: W().operator }, expect: { operator: 0n } });
  ok("a claim outside the closed set is refused before any validator is asked, and the 0.5 GEN comes back in the same transaction", fly.j?.ok === false && String(fly.j?.reason).includes("unknown claim can:fly") && fly.j?.returned === String(STAKE) && moved(fly, "operator", 0n), String(fly.j?.reason).slice(0, 70));
  const short = await call("a3", "operator", "passport", "register", ["honest", HONEST_EP, FOUR], { value: GEN, watch: { operator: W().operator }, expect: { operator: 0n } });
  ok("a registration that sends 1 GEN for four claims is refused and refunded: the stake is 0.5 GEN a claim", short.j?.ok === false && String(short.j?.reason).includes("send exactly " + String(4n * STAKE)) && moved(short, "operator", 0n), String(short.j?.reason).slice(0, 90));
  const reg = await call("a4", "operator", "passport", "register", ["honest", HONEST_EP, FOUR], { value: 4n * STAKE, watch: { operator: W().operator }, expect: { operator: -4n * STAKE } });
  ok("honest registers four claims with 2 GEN of stake, unverified", reg.j?.ok === true && reg.j?.status === "unverified" && reg.j?.stake === String(4n * STAKE) && moved(reg, "operator", -4n * STAKE), `${votes(reg)}`);
  const intrude = await call("a5", "stranger", "passport", "update", ["honest", BASE + "?persona=liar", FOUR]);
  ok("a stranger cannot update honest's endpoint", intrude.j?.ok === false && String(intrude.j?.reason).includes("only the operator"), String(intrude.j?.reason).slice(0, 60));
  const FIVE = JSON.stringify([...JSON.parse(FOUR), "can:translate"]);
  const up = await call("a5b", "operator", "passport", "update", ["honest", HONEST_EP, FIVE], { value: STAKE, watch: { operator: W().operator }, expect: { operator: -STAKE } });
  ok("the operator adds a fifth claim with exactly the 0.5 GEN it lacks", up.j?.ok === true && up.j?.topped_up === String(STAKE) && up.j?.stake === String(5n * STAKE) && moved(up, "operator", -STAKE), JSON.stringify(up.j).slice(0, 120));
  const down = await call("a5c", "operator", "passport", "update", ["honest", HONEST_EP, FOUR], { watch: { operator: W().operator }, expect: { operator: STAKE } });
  ok("and removes it again: the excess 0.5 GEN comes back in the same transaction", down.j?.ok === true && down.j?.returned === String(STAKE) && down.j?.stake === String(4n * STAKE) && moved(down, "operator", STAKE), JSON.stringify(down.j).slice(0, 120));
  ok("is_valid is false before any inspection", (await seen("A_valid0", "passport", "is_valid", ["honest", "can:code"])) === false);
  const dep = await call("a6", "challenger", "passport", "deposit", [], { value: STAKE, watch: { challenger: W().challenger }, expect: { challenger: -STAKE } });
  ok("the challenger deposits 0.5 GEN of credit", dep.j?.ok === true && dep.j?.credit === String(STAKE) && moved(dep, "challenger", -STAKE), JSON.stringify(dep.j));
}

// ================================================================ phase B
console.log(`\n[${stamp()}] ---- phase B: an honest passport, and a challenge that finds nothing`);
{
  const h = await call("b1", "operator", "passport", "inspect", ["honest"]);
  ok("the operator inspects honest and the validators agree: issued", h.applied && h.j?.status === "issued", `${votes(h)}  ${JSON.stringify(h.j?.verdicts)}`);
  const broke = await call("b2", "stranger", "passport", "challenge", ["honest"]);
  ok("a stranger with no credit cannot challenge: the bond comes from deposit()", refused(broke, "deposit() adds credit"), broke.msg.slice(0, 110));
  const self = await call("b3", "operator", "passport", "challenge", ["honest"]);
  ok("the operator cannot challenge its own passport", refused(self, "cannot challenge"), self.msg.slice(0, 90));
  const held = await call("b4", "challenger", "passport", "challenge", ["honest"], { watch: { operator: W().operator, challenger: W().challenger }, expect: { operator: BOND, challenger: 0n } });
  ok("the challenger challenges honest: every claim holds, the passport stands", held.applied && held.j?.outcome === "held" && held.j?.status_after === "issued", `${votes(held)}  ${JSON.stringify(held.j?.verdicts)}`);
  ok("the 0.2 GEN bond, a tenth of the stake, went from the challenger's credit to the operator in that transaction", held.j?.to_operator === String(BOND) && held.j?.credit === String(STAKE - BOND) && moved(held, "operator", BOND) && moved(held, "challenger", 0n), `operator +${held.delta.operator}`);
  const again = await call("b5", "challenger", "passport", "challenge", ["honest"]);
  ok("the same challenger cannot challenge honest again inside the ten-minute cooldown", refused(again, "less than 600 seconds"), again.msg.slice(0, 90));
}

// ================================================================ phase C
console.log(`\n[${stamp()}] ---- phase C: two agents that will change at a moment, issued before it, and two jobs in escrow`);
// every inspection that must land before the swap is refused by this script unless five minutes are left
const beforeSwap = async () => {
  const left = st.swapAt - (await chainNow());
  if (left >= 300) { console.log(`      [${stamp()}] ${left}s are left before the swap; sending`); return; }
  ok("at least five minutes are left before the swap when an inspection is sent", false, `${left}s left`);
  console.log("The swap moment is too close for an inspection to land before it. Start again with FRESH=1 and a larger SWAP_LEAD_SECONDS.");
  st.checks = { pass, fail }; save(); process.exit(1);
};
{
  if (!st.swapAt) { st.swapAt = (await chainNow()) + LEAD; save(); }
  st.swapEp = BASE + "?persona=swap&at=" + st.swapAt; st.driftEp = st.swapEp + "&to=coy"; save();
  const before = await seen("C_clock", "passport", "stats");
  const side = await askAgent(st.swapEp);
  if (!st.steps.c1) {
    if (side?.phase !== "before") { console.log(`The swap agent at ${st.swapEp} did not answer as "before" (${JSON.stringify(side).slice(0, 160)}). Deploy api/agent.js with the swap persona, then start again with FRESH=1.`); process.exit(2); }
  }
  ok("the swap agent answers like honest before its moment", st.steps.c1 ? true : side?.phase === "before" && side?.answer === "OpenAI", `at ${st.swapAt} (${new Date(st.swapAt * 1000).toISOString()}), chain now ${before?.now}`);
  const reg = await call("c1", "operator", "passport", "register", ["swap", st.swapEp, FOUR], { value: 4n * STAKE, watch: { operator: W().operator }, expect: { operator: -4n * STAKE } });
  ok("swap registers the same four claims with 2 GEN of stake", reg.j?.ok === true && reg.j?.stake === String(4n * STAKE) && moved(reg, "operator", -4n * STAKE), `${votes(reg)}`);
  const ins = await call("c2", "operator", "passport", "inspect", ["swap"], { guard: beforeSwap });
  ok("swap is inspected before its moment and issued, like honest", ins.applied && ins.j?.status === "issued", `${votes(ins)}  ${JSON.stringify(ins.j?.verdicts)}`);
  const dreg = await call("c2b", "operator", "passport", "register", ["drift", st.driftEp, FOUR], { value: 4n * STAKE, watch: { operator: W().operator }, expect: { operator: -4n * STAKE } });
  ok("drift registers the same four claims with 2 GEN, at an endpoint that will stop saying who made it", dreg.j?.ok === true && dreg.j?.stake === String(4n * STAKE) && moved(dreg, "operator", -4n * STAKE), `${votes(dreg)}`);
  const dins = await call("c2c", "operator", "passport", "inspect", ["drift"], { guard: beforeSwap });
  ok("drift is inspected before its moment and issued, like honest", dins.applied && dins.j?.status === "issued", `${votes(dins)}  ${JSON.stringify(dins.j?.verdicts)}`);
  st.escrowSwap = await deploy("c3", "buyer", "../../contracts/fixtures/escrow.py", [st.passport, "swap", "can:code", acct.operator.address, st.swapEp]);
  save();
  const f1 = await call("c4", "buyer", "escrowSwap", "fund", [], { value: 3n * GEN, watch: { buyer: W().buyer }, expect: { buyer: -3n * GEN } });
  ok("the buyer funds a 3 GEN job on swap, bound to its operator and endpoint", f1.j?.ok === true && f1.j?.pool === String(3n * GEN) && moved(f1, "buyer", -3n * GEN), `${st.escrowSwap}`);
  st.escrowHonest = await deploy("c5", "buyer", "../../contracts/fixtures/escrow.py", [st.passport, "honest", "can:code", acct.operator.address, HONEST_EP]);
  save();
  const f2 = await call("c6", "buyer", "escrowHonest", "fund", [], { value: 2n * GEN, watch: { buyer: W().buyer }, expect: { buyer: -2n * GEN } });
  ok("and a 2 GEN job on honest", f2.j?.ok === true && f2.j?.pool === String(2n * GEN) && moved(f2, "buyer", -2n * GEN), `${st.escrowHonest}`);
  ok("both jobs would pay the operator now", (await seen("C_would_swap", "escrowSwap", "would_pay")) === "operator" && (await seen("C_would_honest", "escrowHonest", "would_pay")) === "operator");
}

// ================================================================ phase D
console.log(`\n[${stamp()}] ---- phase D: the model is swapped; a challenge catches it, and the money follows`);
{
  if (!st.steps.d1) {
    await untilChain(st.swapAt + 120, "two minutes past the swap");
    // the chain's clock is not the agent's: wait until the agent itself answers from the far side, then a margin
    for (let i = 0; i < 60 && (await askAgent(st.swapEp))?.phase !== "after"; i++) await sleep(10000);
    await sleep(60000);
  }
  const side = st.steps.d1 ? { phase: "after" } : await askAgent(st.swapEp);
  ok("the same endpoint now answers like another model", side?.phase === "after", JSON.stringify(side).slice(0, 120));
  const caught = await call("d1", "challenger", "passport", "challenge", ["swap"], { watch: { challenger: W().challenger, operator: W().operator }, expect: { challenger: 2n * STAKE, operator: 0n } });
  const v = caught.j?.verdicts || {};
  ok("the challenger challenges swap and the validators agree: revoked", caught.applied && caught.j?.outcome === "revoked" && caught.j?.status_after === "refused", `${votes(caught)}  ${JSON.stringify(v)}`);
  ok("the swapped claims are what contradicted: the family, the code, the smuggled words", v["family:gpt"] === "contradicts" && v["can:code"] === "contradicts" && v["safe:injection"] === "contradicts", JSON.stringify(caught.j?.reasons || {}).slice(0, 200));
  ok("the whole 2 GEN stake is slashed: 1 GEN to the challenger in that transaction, 1 GEN kept, the bond back in credit", caught.j?.slashed === String(4n * STAKE) && caught.j?.to_challenger === String(2n * STAKE) && caught.j?.kept === String(2n * STAKE) && caught.j?.credit === String(STAKE - BOND) && moved(caught, "challenger", 2n * STAKE) && moved(caught, "operator", 0n), `challenger +${caught.delta.challenger}`);
  st.swapChallengeN = caught.j?.n; save();
  const coy = await call("d1b", "challenger", "passport", "challenge", ["drift"], { watch: { challenger: W().challenger, operator: W().operator }, expect: { challenger: 0n, operator: FEE } });
  const dv = coy.j?.verdicts || {};
  ok("the challenger challenges drift: it no longer says who made it, which settles nothing, and the passport stands", coy.applied && coy.j?.outcome === "inconclusive" && coy.j?.status_after === "issued" && dv["family:gpt"] === "inconclusive", `${votes(coy)}  ${JSON.stringify(dv)}`);
  ok("an inconclusive challenge is not free: the 0.1 GEN fee, a twentieth of the stake, went from the challenger's credit to the operator", coy.j?.to_operator === String(FEE) && coy.j?.credit === String(STAKE - BOND - FEE) && moved(coy, "operator", FEE) && moved(coy, "challenger", 0n), `operator +${coy.delta.operator}`);
  const reask = await call("d2", "operator", "passport", "inspect", ["swap"]);
  ok("the operator cannot inspect the refused pair again", refused(reask, "already refused"), reask.msg.slice(0, 90));
  ok("is_valid(swap, can:code) is false, read for free", (await seen("D_valid_swap", "passport", "is_valid", ["swap", "can:code"])) === false);
  const p = await seen("D_passport_swap", "passport", "passport", ["swap"]);
  ok("passport(swap): refused, no stake left, 2 GEN slashed, the challenger on the row", p.status === "refused" && p.stake === "0" && p.slashed === String(4n * STAKE) && String(p.last_inspector).toLowerCase() === low("challenger"), JSON.stringify({ status: p.status, stake: p.stake, slashed: p.slashed }));
  const r1 = await call("d3", "buyer", "escrowSwap", "release", [], { watch: { buyer: W().buyer, operator: W().operator }, expect: { buyer: 3n * GEN, operator: 0n } });
  ok("the job on the revoked passport settles: the buyer gets the 3 GEN back", r1.j?.paid === "buyer" && r1.j?.valid === false && moved(r1, "buyer", 3n * GEN) && moved(r1, "operator", 0n), `${r1.j?.passport} -> ${r1.j?.paid}`);
  const r2 = await call("d4", "buyer", "escrowHonest", "release", [], { watch: { operator: W().operator }, expect: { operator: 2n * GEN } });
  ok("the job on honest settles: the operator is paid 2 GEN, and the value moves on chain", r2.j?.paid === "operator" && r2.j?.bound === true && moved(r2, "operator", 2n * GEN), `${r2.j?.passport} -> ${r2.j?.paid}, operator +${r2.delta.operator}`);
}

// ================================================================ phase E
console.log(`\n[${stamp()}] ---- phase E: retiring, the hold, and every route out`);
let unstaked = false;
{
  const ret = await call("e1", "operator", "passport", "retire", ["honest"]);
  ok("the operator retires honest; it stays in force through a one-day hold", ret.j?.ok === true && ret.j?.in_force_until_hold_ends === true && Number(ret.j?.hold_ends) > 0, JSON.stringify(ret.j));
  st.holdEnds = Number(ret.j?.hold_ends) || st.holdEnds; save();
  ok("is_valid(honest, can:code) is still true during the hold", (await seen("E_valid_hold", "passport", "is_valid", ["honest", "can:code"])) === true);
  const over = (await chainNow()) >= st.holdEnds;
  if (!over) {
    const early = await call("e2", "operator", "passport", "unstake", ["honest"], { watch: { operator: W().operator }, expect: { operator: 0n } });
    ok("unstake is refused until the hold ends: a challenge can still reach the stake", refused(early, "the hold after retire ends at") && moved(early, "operator", 0n), early.msg.slice(0, 110));
    note(`the stake comes back once the hold ends at ${new Date(st.holdEnds * 1000).toISOString()}: RESUME=1 after that sends unstake`);
  } else {
    const back = await call("e2b", "operator", "passport", "unstake", ["honest"], { watch: { operator: W().operator }, expect: { operator: 4n * STAKE } });
    unstaked = ok("after the hold, unstake hands the 2 GEN back to the operator", back.j?.returned === String(4n * STAKE) && moved(back, "operator", 4n * STAKE), JSON.stringify(back.j));
  }
  const wd = await call("e3", "challenger", "passport", "withdraw", [], { watch: { challenger: W().challenger }, expect: { challenger: STAKE - BOND - FEE } });
  ok("the challenger takes back its credit: 0.2 GEN, the 0.5 it put in less the bond and the fee paid to the operator", wd.j?.withdrawn === String(STAKE - BOND - FEE) && moved(wd, "challenger", STAKE - BOND - FEE), JSON.stringify(wd.j));
}
function note(text) { console.log("      note: " + text); }

// ================================================================ phase F
console.log(`\n[${stamp()}] ---- phase F: what is on the chain, read back`);
{
  st.code = st.code || {};
  for (const [name, target, path] of [["passport.py", "passport", "../../contracts/passport.py"], ["escrow.py (swap job)", "escrowSwap", "../../contracts/fixtures/escrow.py"], ["escrow.py (honest job)", "escrowHonest", "../../contracts/fixtures/escrow.py"]]) {
    const file = readFileSync(new URL(path, import.meta.url));
    const chain = Buffer.from(String(await rpc("gen_getContractCode", [st[target]])), "base64");
    st.code[name] = { address: st[target], bytes: chain.length, sha256: sha(chain), file_sha256: sha(file), identical: Buffer.compare(chain, file) === 0 };
    save();
    ok(`the code deployed at ${st[target]} is byte for byte ${path.replace("../../", "")}`, st.code[name].identical, `${chain.length} bytes, sha256 ${st.code[name].sha256}`);
  }
  const get = (id, target, fn, args = []) => seen("F_" + id, target, fn, args);
  const ch = await get("challenges_honest", "passport", "challenges_of", ["honest", 0, 10]);
  ok("challenges_of(honest): one challenge, held, the bond to the operator", ch.count === 1 && ch.rows?.[0]?.outcome === "held" && ch.rows[0].to_operator === String(BOND) && ch.rows[0].by === low("challenger"), JSON.stringify(ch.rows?.map((r) => [r.n, r.outcome, r.to_operator])));
  const cs = await get("challenges_swap", "passport", "challenges_of", ["swap", 0, 10]);
  ok("challenges_of(swap): one challenge, revoked, 2 GEN slashed, 1 GEN to the challenger, 1 GEN kept", cs.count === 1 && cs.rows?.[0]?.outcome === "revoked" && cs.rows[0].slashed === String(4n * STAKE) && cs.rows[0].to_challenger === String(2n * STAKE) && cs.rows[0].kept === String(2n * STAKE) && cs.rows[0].n === st.swapChallengeN, JSON.stringify(cs.rows?.map((r) => [r.n, r.outcome, r.slashed])));
  const cd = await get("challenges_drift", "passport", "challenges_of", ["drift", 0, 10]);
  ok("challenges_of(drift): one challenge, inconclusive, the 0.1 GEN fee to the operator, nothing slashed", cd.count === 1 && cd.rows?.[0]?.outcome === "inconclusive" && cd.rows[0].to_operator === String(FEE) && cd.rows[0].slashed === "0", JSON.stringify(cd.rows?.map((r) => [r.n, r.outcome, r.to_operator])));
  // stats change when a resumed run unstakes after the hold, so that read is kept apart from the first run's
  const s = await get(unstaked ? "stats_unstaked" : "stats", "passport", "stats");
  const honestStake = unstaked ? 0n : 4n * STAKE, stakedNow = honestStake + 4n * STAKE;
  ok(`stats(): three agents, three challenges (held, revoked, inconclusive), 1 GEN to a challenger, 1 GEN kept, 0.3 GEN to the operator, ${Number(stakedNow / (GEN / 10n)) / 10} GEN staked, no credit`, s.agents === 3 && s.challenges === 3 && s.revoked === 1 && s.held === 1 && s.inconclusive === 1 && s.unanswered === 0 && s.to_challengers === String(2n * STAKE) && s.kept === String(2n * STAKE) && s.to_operators === String(BOND + FEE) && s.credit === "0" && s.staked === String(stakedNow) && s.stake_returned === String(STAKE + (unstaked ? 4n * STAKE : 0n)), JSON.stringify(s));
  const rules = await get("rules", "passport", "rules");
  ok("rules(): the challenge money table, the bond and fee shares, the cooldown, the silence grace, the stake per claim", ["revoked", "held", "inconclusive", "unanswered"].every((k) => typeof rules.money?.[k] === "string") && rules.challenge?.bond_share === 10 && rules.challenge?.fee_share === 20 && rules.challenge?.cooldown_seconds === 600 && rules.challenge?.silence_grace_seconds === 3600 && rules.stake?.per_claim === String(STAKE), Object.keys(rules.money || {}).join(","));
  const list = await get("agents", "passport", "agents_list", [0, 20]);
  ok("agents_list: honest, swap and drift, the refused icarus never registered", list.count === 3 && list.rows?.join() === "honest,swap,drift", JSON.stringify(list));
  st.end = {}; for (const k of Object.keys(ROLES)) st.end[k] = String(await balance(acct[k].address));
  st.endContracts = { passport: String(await balance(st.passport)), escrowSwap: String(await balance(st.escrowSwap)), escrowHonest: String(await balance(st.escrowHonest)) };
  st.ended = new Date().toISOString();
  save();
  const net = (k) => BigInt(st.end[k]) - BigInt(st.start[k]);
  const want = { operator: -12n * STAKE + BOND + FEE + 2n * GEN + (unstaked ? 4n * STAKE : 0n), buyer: -2n * GEN, challenger: 2n * STAKE - BOND - FEE, stranger: 0n };
  const fmt = (x) => (Number(x * 1000n / GEN) / 1000).toString();
  ok(`every account ends where the money table says: operator ${fmt(want.operator)}, buyer ${fmt(want.buyer)}, challenger +${fmt(want.challenger)}, stranger 0 GEN`, Object.entries(want).every(([k, v]) => net(k) === v), Object.keys(want).map((k) => k + " " + fmt(net(k))).join("  "));
  ok(`the register holds the stakes still behind honest and drift and the half it kept: ${fmt(stakedNow + 2n * STAKE)} GEN; both jobs hold nothing`, BigInt(st.endContracts.passport) === stakedNow + 2n * STAKE && BigInt(st.endContracts.escrowSwap) === 0n && BigInt(st.endContracts.escrowHonest) === 0n, JSON.stringify(st.endContracts));
}

st.checks = { pass, fail }; save();
console.log(`\n${pass} passed, ${fail} failed`);
console.log("register:", st.passport, `${EXPLORER}/address/${st.passport}`);
console.log("escrow jobs:", st.escrowSwap, "(swap),", st.escrowHonest, "(honest)");
console.log("transactions:", st.order.reduce((n, id) => n + st.steps[id].tries.length, 0), "in", st.order.length, "steps; sent a second time:", st.order.filter((id) => st.steps[id].tries.length > 1).join(", ") || "none");
console.log("record:", RECORD);
process.exit(fail ? 1 : 0);
