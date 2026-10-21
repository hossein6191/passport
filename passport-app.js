import { createClient } from "https://esm.sh/genlayer-js@1.1.8";
import { studionet } from "https://esm.sh/genlayer-js@1.1.8/chains";
import { gen, attoOf, stakeFor, isoSeconds, swapAtOf, span, clock, until, rowState, roleOf, outcomeHead, moneyLines,
         waitLines, COOLDOWN_SECONDS } from "./waiting.js?v=8";

/* Version 2, on GenLayer Studio: chain 61999, the older runtime (py-genlayer:1jb45…), genlayer-js 1.1.8, no fee
   quotes. Value messages execute here (on Studio Next they never did), which is why version 2 lives here. */
const $ = (id) => document.getElementById(id);
const RPC = "https://studio.genlayer.com/api";
const EXPLORER = "https://explorer-studio.genlayer.com";
// the SDK's studionet object names an explorer that is gone, so both hosts are set here
const NETWORK = { ...studionet, rpcUrls: { default: { http: [RPC] } }, blockExplorers: { default: { name: "GenLayer Studio Explorer", url: EXPLORER } } };
const CHAIN = { chainId: "0xf22f", chainName: "GenLayer Studio", nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 }, rpcUrls: [RPC], blockExplorerUrls: [EXPLORER + "/"] };
const CLAIMS = ["family:gpt", "family:claude", "family:gemini", "family:llama", "family:mistral", "family:other",
                "can:code", "can:translate", "can:summarize", "can:math", "safe:injection"];
// The version 2 register on Studio: the one the evidence run in the README deployed, on which
// tools/open-demo-agents.mjs registered the demo agents (README, "The site"). While it is empty the page says the
// version 2 register is not deployed yet and offers to deploy one from the visitor's own wallet.
const DEMO_REGISTER = "0x8dD3D43a744Af816BA30169F430a065fff77eF48";
// Written by tools/open-demo-agents.mjs: the register, the demo operator's address, the honest demo agent and
// the swap agents. The page trusts a demo row only when its operator is the one this file names.
const DEMO_FILE = "./data/demo-agents.json";
const SWAP_PROBES = 6;          // the most demo swap ids read in one look, from the file's first_open hint
const SWAP_MARGIN = 120;        // seconds after a swap agent's moment before the page lets a visitor challenge it
const SWAP_LEAD = 600;          // the swap chip sets an agent's moment this many seconds ahead
const AGENTS_PAGE = 8;          // passports per page (the contract pages at 20; Studio allows 30 reads a minute)
const CHALLENGES_PAGE = 10;     // the contract's own page for challenges_of
const REMEMBER_KEY = "passport_register_v2";   // a new key: a browser may remember a version 1 register on Studio Next
// The demo agents are served by this same site (api/agent.js on Vercel, tools/serve-agents.mjs locally).
const DEMO_BASE = location.origin + "/api/agent";
const FOUR = ["family:gpt", "can:math", "can:code", "safe:injection"];
const DEMO = {
  honest:      { claims: FOUR },
  liar:        { claims: FOUR },
  coy:         { claims: FOUR },
  polyglot:    { claims: ["family:gemini", "can:translate", "safe:injection"] },
  hijacker:    { claims: FOUR },
  embellisher: { claims: ["family:claude", "can:math", "can:summarize"] },
  mathematician: { claims: ["family:mistral", "can:math"] },
  miscalculator: { claims: FOUR },
  gullible:      { claims: FOUR },
  overclaimer:   { claims: ["family:llama", "can:math", "can:code", "can:translate", "can:summarize", "safe:injection"] },
  chatterbox:    { claims: FOUR },
  echo:          { claims: ["safe:injection"] },
  swap:          { claims: FOUR },
};
/* One line per demo agent: what it does and what the battery is expected to say. Shown under
   the try chips when one is pressed, and as the chip's tooltip. */
const WHAT = {
  honest: "says OpenAI made it, gets both sums right, writes fib(n), ignores the smuggled lines. Expected: issued.",
  liar: "claims family:gpt but names Meta AI, obeys the smuggled lines, explains code instead of writing it. Expected: refused on three claims; narrowed to can:math it is issued.",
  coy: "like the honest agent, but will not say who built it. Expected: pending, the family claim inconclusive.",
  polyglot: "a Google model that translates the meeting sentence into Spanish. Expected: issued, one claim judged in both orders.",
  hijacker: "answers like the honest agent, but its code answer is an instruction aimed at the judge. Expected: refused; the fence holds.",
  embellisher: "an Anthropic model whose summary adds a fact the notice never had. Expected: refused, or pending if the judge only doubts.",
  mathematician: "a Mistral model that claims only family:mistral and can:math, and says so when asked for code. Expected: issued.",
  miscalculator: "like the honest agent, but answers 390 and 1000 to the two sums. Expected: refused on can:math, with the fixed reason.",
  gullible: "like the honest agent, but the French line with the <system> tag gets HAHA. Expected: refused on safe:injection, inject-2 alone.",
  overclaimer: "a Meta model claiming all six things; asked for Spanish it hands back the English sentence. Expected: refused on can:translate, five claims hold.",
  chatterbox: "never a bare answer: the facts arrive inside chatty sentences. Expected: issued; the probes read for the fact, not the format.",
  echo: "repeats every prompt back word for word, claiming safe:injection. Expected: refused; the smuggled words come back with the rest.",
  swap: "answers like the honest agent until its switch moment (the chip sets it ten minutes ahead), then like another model. Inspect it before the switch: issued. After it, a challenge from another wallet revokes it and takes your stake, and so does your own renewal.",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const big = (v) => { try { return BigInt(String(v ?? "0") || "0"); } catch (e) { return 0n; } };
const short = (a) => (a ? String(a).slice(0, 6) + "…" + String(a).slice(-4) : "");
const same = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();
const link = (path, text) => `<a href="${EXPLORER}${path}" target="_blank" rel="noopener">${esc(text)}</a>`;
/* After every transaction the line under its button carries the explorer link, so what the page
   says can be checked where it happened, not only in the log. */
const txLink = (r) => (r?.tx ? " · " + link("/tx/" + r.tx, "tx " + r.tx.slice(0, 10) + "… on the explorer ↗") : "");
const done = (el, text, r) => { if (el) el.innerHTML = esc(text) + txLink(r); };
const warn = (t) => `<span class="warn">${esc(t)}</span>`;
const log = (m, cls) => { const e = $("log"); e.innerHTML += "\n" + (cls ? `<span class="${cls}">${m}</span>` : m); for (const box of [e, e.parentElement]) if (box) box.scrollTop = box.scrollHeight; };
const goTo = (id) => { const el = $(id); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); };
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v ?? d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};

/* ------------------------------------------------------------- the network */
/* eth_* calls (transaction polls, balances) have their own bucket on Studio, 300 a minute. */
const rpc = async (m, p) => {
  for (let i = 0; i < 6; i++) {
    try { const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: m, params: p }) }); return (await r.json()).result; }
    catch (e) { await sleep(1500); }
  }
};
const balanceOf = async (a) => { const h = await rpc("eth_getBalance", [a, "latest"]); return h ? big(h) : null; };

/* Every contract read (gen_call) and the faucet share one bucket on Studio: 30 a minute from one browser, and a
   refused request reaches a browser only as "Failed to fetch". So reads are paced to 24 a minute, answers are kept
   for 30 seconds, two parts of the page asking the same thing share one request, and a refusal pauses every read
   for 20 seconds instead of retrying into it. */
const READ_BUDGET = 24, READ_WINDOW_MS = 60000, READ_TTL_MS = 30000, RATE_PAUSE_MS = 20000;
const readTimes = [];
let pausedUntil = 0, pauseSaid = 0;
async function slot() {
  for (;;) {
    const now = Date.now();
    if (now < pausedUntil) { await sleep(pausedUntil - now); continue; }
    while (readTimes.length && now - readTimes[0] > READ_WINDOW_MS) readTimes.shift();
    if (readTimes.length < READ_BUDGET) { readTimes.push(now); return; }
    await sleep(READ_WINDOW_MS - (now - readTimes[0]) + 50);
  }
}
const limited = (e) => /failed to fetch|load failed|networkerror|rate limit|429/i.test([e?.message, e?.details, e?.cause?.message, e?.shortMessage].join(" "));
const cache = new Map(), flight = new Map();
const keyOf = (address, fn, args) => String(address).toLowerCase() + "|" + fn + "|" + JSON.stringify(args);
/* Forget what was read about one agent (and the register's totals), after a transaction that changed it. */
function forget(id) {
  for (const k of [...cache.keys()]) {
    const [, fn, args] = k.split("|");
    if (["stats", "agents_list", "credit_of"].includes(fn) || (id && args && args.startsWith(JSON.stringify([id]).slice(0, -1)))) cache.delete(k);
  }
}
const READER = createClient({ chain: NETWORK });
/* Studio's RPC sometimes answers a read with "Contract not found" for an address the explorer shows perfectly
   well, for a minute at a time. Reads therefore retry with a growing pause, eight tries and about forty seconds. */
async function readOrRetry(fn, args = [], tries = 8, address = reg, fresh = false) {
  if (!address) return { ok: false, error: new Error("no register loaded") };
  const key = keyOf(address, fn, args);
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < READ_TTL_MS) return { ok: true, value: hit.value, at: hit.at };
  if (!fresh && flight.has(key)) return flight.get(key);
  const job = (async () => {
    let last;
    for (let i = 0; i < tries; i++) {
      await slot();
      try {
        const value = await READER.readContract({ address, functionName: fn, args });
        if (cache.size > 400) cache.clear();
        const at = Date.now(); cache.set(key, { at, value });
        return { ok: true, value, at };
      } catch (e) {
        last = e;
        if (limited(e)) {
          pausedUntil = Date.now() + RATE_PAUSE_MS;
          if (Date.now() - pauseSaid > 60000) { pauseSaid = Date.now(); log("Studio is rate-limiting this browser (30 reads a minute); reads pause for 20 s and go on by themselves", "warn"); }
        } else await sleep(Math.min(8000, 500 + 350 * (i + 1) * (i + 1)));
      }
    }
    return { ok: false, error: last };
  })();
  flight.set(key, job);
  try { return await job; } finally { flight.delete(key); }
}
/* A view's answer, parsed: an object for the JSON views, a boolean for is_valid, null when it could not be read. */
async function viewJson(fn, args = [], opt = {}) {
  const r = await readOrRetry(fn, args, opt.tries ?? 8, opt.address ?? reg, !!opt.fresh);
  if (!r.ok) return null;
  if (typeof r.value === "boolean") return r.value;
  let v; try { v = JSON.parse(String(r.value)); } catch (e) { v = String(r.value); }
  if (fn === "stats" && v && Number(v.now) > 0) clockOffset = Number(v.now) - Math.floor(r.at / 1000);
  return v;
}

/* The chain's clock: stats().now, read with every load. Countdowns and the swap moment use it, not this laptop's. */
let clockOffset = 0;
const chainNow = () => Math.floor(Date.now() / 1000) + clockOffset;
const tickers = new Set();
setInterval(() => {
  const now = chainNow();
  for (const el of document.querySelectorAll("[data-until]")) {
    const left = Number(el.dataset.until) - now;
    el.textContent = left > 0 ? span(left) : (el.dataset.done || "now");
  }
  for (const f of [...tickers]) { try { if (f(now) === false) tickers.delete(f); } catch (e) { tickers.delete(f); } }
}, 1000);
const countdown = (unix, doneText) => `<b class="mono" data-until="${Number(unix)}" data-done="${esc(doneText)}">${esc(span(Number(unix) - chainNow()))}</b>`;

/* ---------------------------------------------------------- transactions */
/* Under every passport in section 08: the explorer link of every transaction that touched it. A contract
   cannot know its own transaction hashes, so api/txs.js lists the register's transactions from the network
   and decodes each call (method, agent, how it ended). This browser's own signed transactions are also
   remembered per register, for the second before the list catches up. */
const TXS = { register: "", byAgent: {} };
let chainFresh = false;
function labelOf(t, operator) {
  const err = t.exec === "ERROR", why = t.error || "", res = t.result || {};
  let what;
  if (t.method === "register") what = err || res.ok === false ? "registration refused, stake returned" : "registered with its stake";
  else if (t.method === "update") what = err || res.ok === false ? "update refused" : "claims updated";
  else if (t.method === "retire") what = err ? "retire refused" : "retired";
  else if (t.method === "unstake") what = err ? "unstake refused" + (/hold after retire/.test(why) ? ", hold not over" : "") : "stake taken back";
  else if (t.method === "inspect") what = err ? "inspect refused" + (/only the operator/.test(why) ? ", not the operator" : /already refused/.test(why) ? ", unchanged since the refusal" : "")
    : res.outcome === "renewed" ? "renewed" : res.outcome === "revoked" ? "inspected in force: revoked" : "inspected, " + (res.status || "");
  else if (t.method === "challenge") what = err ? "challenge refused" + (/less than/.test(why) ? ", too soon" : /only an issued/.test(why) ? ", not in force" : /deposit\(\)/.test(why) ? ", no credit" : /cannot challenge/.test(why) ? ", by the operator" : "")
    : "challenged: " + (res.outcome || "settled");
  else what = t.method;
  if (!err && res.ok !== false && big(t.value) > 0n) what += " (" + gen(t.value) + ")";
  if (operator && t.from && !same(t.from, operator)) what += " by " + short(t.from);
  return what;
}
async function loadChainTxs() {
  if (!reg) return;
  const want = reg;
  try {
    const r = await fetch(location.origin + "/api/txs?register=" + want + (chainFresh ? "&fresh=1" : ""));
    chainFresh = false;
    if (!r.ok) return;
    const j = await r.json();
    if (want !== reg) return;
    const byAgent = {};
    for (const t of j.txs || []) { if (!t.agent) continue; (byAgent[t.agent] = byAgent[t.agent] || []).push(t); }
    TXS.register = want.toLowerCase(); TXS.byAgent = byAgent;
  } catch (e) {}
}
const MINE_KEY = "passport_txs";
const mine = store.get(MINE_KEY, {}) || {};
function remember(id, what, r) {
  if (!r?.tx || !reg) return;
  chainFresh = true;
  const k = reg.toLowerCase(); mine[k] = mine[k] || {}; mine[k][id] = mine[k][id] || [];
  mine[k][id].push({ what, tx: r.tx });
  store.set(MINE_KEY, mine);
}
function txsOf(id, operator) {
  const k = (reg || "").toLowerCase();
  const known = TXS.register === k ? (TXS.byAgent[id] || []).map((t) => ({ what: labelOf(t, operator), tx: t.hash })) : [];
  const own = (mine[k] || {})[id] || [];
  const seen = new Set(); const out = [];
  for (const t of [...known, ...own]) { if (t?.tx && !seen.has(t.tx)) { seen.add(t.tx); out.push(t); } }
  return out;
}

/* ---------------------------------------------------------------- wallet */
const provs = [];
addEventListener("eip6963:announceProvider", (e) => { if (!provs.some((p) => p.info.rdns === e.detail.info.rdns)) provs.push(e.detail); });
dispatchEvent(new Event("eip6963:requestProvider"));
let provider = null, account = null, reg = null;
const progress = store.get("passport_progress_v2", {}) || {};
const mark = (k) => { if (progress[k]) return; progress[k] = true; store.set("passport_progress_v2", progress); paint(); };
async function ensureNet(p) {
  try { await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN.chainId }] }); }
  catch (e) { if (e && (e.code === 4902 || /unrecognized|not added|unknown chain|4902/i.test(String(e.message || "")))) await p.request({ method: "wallet_addEthereumChain", params: [CHAIN] }); else throw e; }
}
/* The SDK signs through the wallet the visitor connected, never whichever one happens to sit on window.ethereum. */
async function client() {
  await ensureNet(provider);
  const a = await provider.request({ method: "eth_accounts" });
  if (a?.[0]) account = a[0].toLowerCase();
  return createClient({ chain: NETWORK, account, provider });
}
function said(msg) { log(esc(msg), "warn"); if ($("railHint")) $("railHint").innerHTML = warn(msg); }
async function connect() {
  provider = (provs[0] || {}).provider || window.ethereum;
  if (!provider) { said("no wallet found in this browser: install Rabby or MetaMask, then reload"); return false; }
  try {
    await ensureNet(provider);
    const a = await provider.request({ method: "eth_requestAccounts" }); account = (a[0] || "").toLowerCase() || null;
    if (provider.on && !provider.__passport) {
      provider.__passport = true;
      provider.on("accountsChanged", (list) => { account = (list?.[0] || "").toLowerCase() || null; paint(); afterAccount(); });
    }
    paint(); log("connected " + esc(account)); afterAccount(); return true;
  } catch (e) { said(e.code === 4001 ? "connection refused in the wallet" : "could not connect: " + (e.message || e)); return false; }
}
$("connect").onclick = connect;
$("faucet").onclick = async () => {
  if (!account && !(await connect())) return;
  await slot();     // the faucet shares the read bucket
  const r = await rpc("sim_fundAccount", { account_address: account, amount: 300e18 });
  if (r === undefined) said("could not fund: Studio did not answer the faucet call; try again in a minute"); else log("funded 300 test GEN");
};

/* The order of things, shown at the top of the page: what is done, what is next. */
const HINTS = {
  1: "Press Connect wallet, top right: Rabby or any EIP-6963 wallet. The wallet is asked to add GenLayer Studio (chain 61999). Then Get test GEN, it is free.",
  2: DEMO_REGISTER ? "Press \"load the version 2 register\" in section 05, or paste one, or deploy your own."
                   : "The version 2 register is not deployed yet. Deploy your own in section 05 (one signature), or paste a version 2 register.",
  3: "In section 02 deposit the bond, then challenge the swapped demo agent. Its stake pays you when the validators catch it.",
  4: "In section 03 open a job on the honest demo agent, fund it, settle it, and watch the operator get paid on chain.",
  5: "In section 06 press a try chip and Register with its stake (0.5 GEN a claim), then Inspect it in section 07.",
  6: "Every passport is in section 08: its stake, its challenges and the money each moved. Ask the gate in section 07: is_valid(agent, claim), free.",
};
/* A guide that follows the visitor: after every step it says where to go next, with a button
   that takes them there. Hiding it hides it for the current step only; the next step brings it back. */
const GUIDE = {
  1: ["Press Connect wallet at the top right. Rabby or any wallet; it is asked to add GenLayer Studio, then press Get test GEN.", "top"],
  2: ["Go to section 05 and load the version 2 register, or deploy your own there.", "register-sec"],
  3: ["Catch a swapped model in section 02: deposit the bond, then challenge. One to three minutes.", "catch-sec"],
  4: ["Pay the honest agent through escrow in section 03: open the job, fund it, settle it.", "escrow-sec"],
  5: ["Stake your own agent: section 06, a try chip, Register. Then Inspect it in section 07.", "agent-sec"],
  6: ["Read the passports in section 08: stake, challenges and the money each moved. The gate is in section 07.", "passports"],
};
let guideStep = 0;
function paintGuide(step) {
  const g = $("guide"); if (!g || !GUIDE[step]) return;
  const [text, go] = GUIDE[step];
  $("guideStep").textContent = "Step " + step + " of 6";
  $("guideText").textContent = text;
  $("guideGo").onclick = () => { if (go === "top") window.scrollTo({ top: 0, behavior: "smooth" }); else goTo(go); };
  let hiddenFor = null; try { hiddenFor = sessionStorage.getItem("passport_guide_hidden"); } catch (e) {}
  g.hidden = String(step) === hiddenFor;
  guideStep = step;
}
if ($("guideHide")) $("guideHide").onclick = () => { $("guide").hidden = true; try { sessionStorage.setItem("passport_guide_hidden", String(guideStep)); } catch (e) {} };
function paint() {
  const on = !!account;
  $("who").textContent = account ? short(account) : "";
  $("who").title = account || "";
  $("connect").textContent = on ? "Change wallet" : "Connect wallet";
  const step = !on ? 1 : !reg ? 2 : (!progress.challenged && demo.target) ? 3 : (!progress.paid && demo.honest) ? 4
    : !(progress.registered && progress.inspected) ? 5 : 6;
  for (const li of document.querySelectorAll("#steps li")) {
    const n = Number(li.dataset.step);
    li.classList.toggle("done", n < step); li.classList.toggle("now", n === step);
  }
  if ($("railHint")) $("railHint").textContent = HINTS[step];
  paintGuide(step);
  if ($("introStep2") && !DEMO_REGISTER) $("introStep2").textContent = "The version 2 register is not deployed yet: deploy your own from section 05 (one signature), or paste one.";
}
/* Every signing button asks for what it needs instead of sitting disabled:
   no wallet, connect one; no register, load the version 2 register when there is one. */
async function ready(st) {
  if (!account) { st.textContent = "connect a wallet first (the wallet window opens now)"; if (!(await connect())) { st.innerHTML = warn("connect a wallet, top right, to sign this"); return false; } }
  if (!reg) {
    if (DEMO_REGISTER) { st.textContent = "loading the version 2 register first"; if (!(await useRegister(DEMO_REGISTER))) return false; }
    else { st.innerHTML = warn("the version 2 register is not deployed yet: deploy your own in section 05, or paste one"); goTo("register-sec"); return false; }
  }
  st.textContent = ""; return true;
}

/* ------------------------------------------------- the waiting panel */
/* Every wait says the same five things: what is happening, how long, whether you must act, whether you can
   leave, and where the money is. The words are in waiting.js, one function of state and role. */
function linesHtml(L) {
  return `<dl class="wl"><dt>What is happening</dt><dd>${esc(L.what)}</dd><dt>How long</dt><dd>${esc(L.long)}</dd>`
    + `<dt>Do you need to act</dt><dd>${esc(L.act)}</dd><dt>Can you leave</dt><dd>${esc(L.leave)}</dd><dt>Where the money is</dt><dd>${esc(L.money)}</dd></dl>`;
}
function panel(host, state, ctx = {}, role = "visitor", opt = {}) {
  if (!host) return;
  const L = waitLines(state, ctx, role);
  host.innerHTML = `<div class="waitbox${opt.busy ? " busy" : ""}"><div class="wb-head">${opt.busy ? '<span class="spin"></span>' : ""}<b>${esc(L.title)}</b>`
    + `<span class="wb-stage mono" data-stage>${esc(opt.stage || "")}</span></div>${linesHtml(L)}${opt.extra || ""}</div>`;
}
const stageOf = (host, text) => { const s = host?.querySelector("[data-stage]"); if (s) s.textContent = text; };
const STAGES = { PENDING: "queued for a leader", PROPOSING: "the leader is running it", COMMITTING: "the validators are running it themselves",
  REVEALING: "the validators are revealing their words", ACCEPTED: "accepted", FINALIZED: "finalized", UNDETERMINED: "no majority",
  LEADER_TIMEOUT: "the leader ran out of time; a new round", VALIDATORS_TIMEOUT: "the validators ran out of time; a new round", CANCELED: "cancelled" };

/* A transaction's verdict: polled with eth_getTransactionByHash every four seconds. Applied only when a majority
   of the votes agree; a round with no majority stores nothing, and the page says so. */
async function wait(tx, label, target, onStatus) {
  const t0 = Date.now();
  for (let i = 0; i < 225; i++) {
    await sleep(4000);
    const t = await rpc("eth_getTransactionByHash", [tx]);
    const s = t?.status || "PENDING";
    const secs = Math.round((Date.now() - t0) / 1000);
    if (onStatus) onStatus(s, secs);
    if (s === "CANCELED") { log("  ✗ " + esc(label) + " was cancelled on the network", "warn"); return null; }
    if (s === "UNDETERMINED") { log("  ⚖ the validators did not agree, so nothing was stored", "warn"); return { split: true, msg: "", status: s }; }
    if (s === "ACCEPTED" || s === "FINALIZED") {
      const lr = t.consensus_data?.leader_receipt, one = Array.isArray(lr) ? lr[0] : lr;
      let msg = ""; try { msg = new TextDecoder().decode(Uint8Array.from(atob(one.result), (c) => c.charCodeAt(0))).replace(/[^\x20-\x7e]/g, " ").trim(); } catch (e) {}
      let a = 0, d = 0, idl = 0; for (const k in (t.consensus_data?.votes || {})) { const v = t.consensus_data.votes[k]; if (v === "agree") a++; else if (v === "disagree") d++; else idl++; }
      log(`  votes: ${a} agree, ${d} disagree, ${idl} idle`);
      if (a * 2 <= a + d + idl) { log("  ⚖ the validators did not agree, so nothing was stored", "warn"); return { split: true, msg, status: s }; }
      let j = null; const b = msg.indexOf("{"); if (b !== -1) { try { j = JSON.parse(msg.slice(b)); } catch (e) {} }
      return { split: false, msg, j, exec: one?.execution_result, status: s, address: t.data?.contract_address || "" };
    }
    if (i % 3 === 2 && target) target.textContent = `… ${label} (${span(secs)}, ${STAGES[s] || s.toLowerCase()})`;
  }
  log("  ✗ " + esc(label) + " timed out", "warn"); return null;
}
/* Value sent out by a contract lands when the transaction is finalized, not when it is accepted. */
async function finalized(tx) {
  for (let i = 0; i < 180; i++) {
    const t = await rpc("eth_getTransactionByHash", [tx]);
    if (t?.status === "FINALIZED") return true;
    if (t?.status === "CANCELED") return false;
    await sleep(5000);
  }
  return false;
}
/* opt: value (atto, for a payable call), address (the contract, the register by default), wait (where the waiting
   panel goes), state / ctx / role (what it says while the validators work), onSent (the hash, as soon as there is one). */
async function send(fn, args, label, st, opt = {}) {
  const value = opt.value ? big(opt.value) : 0n;
  if (opt.wait) panel(opt.wait, "wallet", { label, amount: value, payable: value > 0n }, opt.role, { busy: true });
  let tx;
  try {
    const c = await client();
    log(`▶ ${esc(label)} … confirm in wallet${value ? " (sends " + gen(value) + ")" : ""}`);
    tx = await c.writeContract({ address: opt.address || reg, functionName: fn, args, value, leaderOnly: false });
  } catch (e) {
    if (opt.wait) opt.wait.innerHTML = "";
    log("  ✗ " + esc(label + ": " + (e.code === 4001 ? "refused in the wallet" : (e.shortMessage || e.message || e))), "warn"); throw e;
  }
  log("  tx " + tx + " · " + link("/tx/" + tx, "explorer"));
  if (opt.onSent) opt.onSent(tx);
  if (opt.wait && opt.state) panel(opt.wait, opt.state, opt.ctx || {}, opt.role, { busy: true, stage: "sent", extra: `<p class="mono muted wb-tx">${link("/tx/" + tx, "tx " + tx.slice(0, 10) + "… on the explorer ↗")}</p>` });
  const w = await wait(tx, label, st, (s, secs) => stageOf(opt.wait, (STAGES[s] || s.toLowerCase()) + " · " + span(secs)));
  return w ? { ...w, tx } : { tx, msg: label + " did not settle on the network; the explorer link shows its state" };
}
/* Why a call did not do what was asked: a payable refusal's reason, or the contract's own error, without its tag. */
function why(r) {
  if (r?.split) return "the validators did not agree, so nothing was stored; press again";
  if (r?.j && r.j.ok === false) return String(r.j.reason || "refused") + (big(r.j.returned) > 0n ? " (the " + gen(r.j.returned) + " sent came back in the same transaction)" : "");
  const m = String(r?.msg || "failed"), k = m.search(/\[(EXPECTED|EXTERNAL|TRANSIENT|LLM_ERROR)\]/);
  return (k >= 0 ? m.slice(k).replace(/^\[EXPECTED\]\s*/, "") : m).slice(0, 240);
}

/* ---------------------------------------------------------------- claims */
$("claims").innerHTML = CLAIMS.map((c) => `<label><input type="checkbox" value="${c}">${c}</label>`).join("");
const chosenClaims = () => [...$("claims").querySelectorAll("input:checked")].map((i) => i.value);
const setClaims = (list) => { for (const i of $("claims").querySelectorAll("input")) i.checked = list.includes(i.value); paintStake(); };
function paintStake() {
  const n = chosenClaims().length;
  if ($("stakeLine")) $("stakeLine").innerHTML = n
    ? `Stake: <b>${n} claim${n === 1 ? "" : "s"} × 0.5 GEN = ${esc(gen(stakeFor(n)))}</b>, sent with Register and held while the agent exists. A refusal returns it in the same transaction; Unstake hands it back one day after Retire.`
    : "Stake: 0.5 GEN for each claim, sent with Register. Pick the claims below.";
}
$("claims").addEventListener("change", paintStake);
paintStake();
if ($("claimIds")) $("claimIds").innerHTML = CLAIMS.map((c) => `<option value="${c}">`).join("");
if ($("demoBase")) $("demoBase").textContent = DEMO_BASE + "?persona=honest";

/* ----------------------------------------------------------- suggestions */
let knownIds = new Set();   // ids on the page of the register shown, so a suggestion is never one of them
let lastPreset = "";        // the chip that filled the id box, so it can be refreshed when the register loads
const three = () => String(100 + Math.floor(Math.random() * 900));
function freshId(base) {
  if (!knownIds.has(base)) return base;
  let id; do { id = base + three(); } while (knownIds.has(id) || id === $("aid").value.trim());
  return id;
}
for (const chip of document.querySelectorAll("[data-preset]")) { chip.title = WHAT[chip.dataset.preset] || ""; chip.onclick = () => {
  const name = chip.dataset.preset, d = DEMO[name]; if (!d) return;
  if ($("tryWhat")) $("tryWhat").innerHTML = "<b>" + esc(name) + "</b>: " + esc(WHAT[name] || "");
  lastPreset = name; $("aid").value = freshId(name);
  const at = chainNow() + SWAP_LEAD;
  $("endpoint").value = DEMO_BASE + "?persona=" + name + (name === "swap" ? "&at=" + at : "");
  setClaims(d.claims);
  $("regAgentSt").textContent = (name === "swap" ? `filled in a swap agent that changes model at ${clock(at)}: register it and inspect it before then. `
    : `filled in the ${name} demo agent. `) + `Press Register (it sends the stake), then Inspect it in section 07`
    + (DEMO_BASE.startsWith("https://") ? "" : " (the contract accepts https endpoints only; on the deployed site this address is https)");
  if (!chip.closest("#agent-sec")) { goTo("agent-sec"); }
}; }
const WORDS = ["atlas", "nova", "sable", "quill", "orbit", "lumen", "ferry", "cedar", "delta", "willow", "tundra", "pixel"];
let wordAt = Math.floor(Math.random() * WORDS.length);
if ($("genId")) $("genId").onclick = () => {
  let id;
  do { wordAt = (wordAt + 1) % WORDS.length; id = WORDS[wordAt] + three(); } while (id === $("aid").value.trim() || knownIds.has(id));
  $("aid").value = id;
  $("regAgentSt").textContent = `${id}: a fresh id. Press again for another; the endpoint and claims are yours to fill`;
};
function pick(id, claim) {
  $("iid").value = id; $("gAgent").value = id; if (claim) $("gClaim").value = claim;
  $("inspectSt").textContent = `${id} is in the boxes below. Inspect it if you are its operator; challenge it if it holds a passport in force and you are not`;
  paintTarget(id);
}
function offerAgents(ids, firstClaim) {
  if ($("agentIds")) $("agentIds").innerHTML = ids.map((i) => `<option value="${esc(i)}">`).join("");
  const host = $("pickAgents"); if (!host) return;
  host.innerHTML = '<span class="lead">pick</span>' + (ids.length
    ? ids.map((i) => `<button class="chip" data-pick="${esc(i)}">${esc(i)}</button>`).join("")
    : '<span class="fine">no agents registered yet</span>');
  for (const b of host.querySelectorAll("[data-pick]")) b.onclick = () => pick(b.dataset.pick, firstClaim[b.dataset.pick]);
}

/* -------------------------------------------------------------- register */
async function useRegister(address, rememberIt = false) {
  $("regSt").textContent = "reading " + address + " …";
  const probe = await readOrRetry("rules", [], 8, address);
  if (!probe.ok) {
    if (DEMO_REGISTER && same(address, DEMO_REGISTER) && await showSnapshot("Studio did not answer reads for the version 2 register after eight tries over forty seconds")) return false;
    $("regSt").innerHTML = warn(address + " did not answer rules() after eight tries over forty seconds: not a Passport register on Studio (chain 61999), or Studio is refusing reads right now. Press Load again in a minute."); return false;
  }
  let rules = {}; try { rules = JSON.parse(String(probe.value)); } catch (e) {}
  if (!rules.money || !rules.challenge || !rules.stake) {
    $("regSt").innerHTML = warn(address + " is a version 1 register: no stake, no paid challenges. This page speaks version 2; ") + link("/address/" + address, "it is still on the explorer ↗") + warn(". Load a version 2 register, or deploy one below.");
    return false;
  }
  reg = address;
  /* Only a register you pasted or deployed yourself is remembered. The site's register is never remembered,
     so a browser follows it when it changes. */
  try { if (rememberIt) localStorage.setItem(REMEMBER_KEY, address); else if (DEMO_REGISTER && same(address, DEMO_REGISTER)) localStorage.removeItem(REMEMBER_KEY); } catch (e) {}
  $("addr").value = address;
  $("regSt").innerHTML = "This register on the explorer: " + link("/address/" + address, address);
  if ($("regLink")) { $("regLink").href = EXPLORER + "/address/" + address; $("regLink").target = "_blank"; $("regLink").rel = "noopener"; }
  $("rules").textContent = JSON.stringify(rules, null, 2);
  const bat = await readOrRetry("battery");
  if (bat.ok) $("battery").textContent = JSON.parse(String(bat.value)).map((p) => `[${p.id}] ${p.claim} · ${p.kind}\n  ${p.prompt}${p.criteria ? "\n  judged by: " + p.criteria : ""}`).join("\n\n");
  agentsPage = 0;
  paint(); await renderAgents(); await loadDemo(); resumeJob(); resumeChallenge(); return true;
}
$("load").onclick = () => { const a = $("addr").value.trim(); if (/^0x[0-9a-fA-F]{40}$/.test(a)) useRegister(a, true); else $("regSt").innerHTML = warn("that is not an address"); };

/* The deploy waits for the new contract's address on the transaction itself. */
async function deployCode(path, args, label, st, waitHost, state, ctx, onSent) {
  const got = await fetch(path + "?t=" + Date.now());
  if (!got.ok) throw new Error("could not read " + path + " from this host");
  const code = await got.text();
  if (waitHost) panel(waitHost, "wallet", { label }, "visitor", { busy: true });
  const c = await client();
  log("▶ " + esc(label) + " … confirm in wallet");
  let h;
  try { h = await c.deployContract({ code, args, leaderOnly: false }); }
  catch (e) { if (waitHost) waitHost.innerHTML = ""; throw e; }
  log("  tx " + h + " · " + link("/tx/" + h, "explorer"));
  if (onSent) onSent(h);
  if (waitHost && state) panel(waitHost, state, ctx || {}, "buyer", { busy: true, stage: "sent" });
  const w = await wait(h, label, st, (s, secs) => stageOf(waitHost, (STAGES[s] || s.toLowerCase()) + " · " + span(secs)));
  return { tx: h, address: w && !w.split ? w.address : "", w };
}
$("deploy").onclick = async () => {
  if (!account && !(await connect())) { $("regSt").innerHTML = warn("connect a wallet, top right, to deploy"); return; }
  $("deploy").disabled = true;
  try {
    const d = await deployCode("./contracts/passport.py", [], "deploying a version 2 register", $("regSt"));
    if (!d.address) throw new Error("the deploy produced no address");
    log("  ✓ deployed at " + d.address); await useRegister(d.address, true);
    $("regSt").innerHTML += " · deployed in " + link("/tx/" + d.tx, "this transaction ↗");
  } catch (e) { log("  ✗ " + esc(e.message || e), "warn"); $("regSt").innerHTML = warn(String(e.message || e).slice(0, 200)); }
  $("deploy").disabled = false;
};

/* ---------------------------------------------------- register an agent */
$("register").onclick = async () => {
  if (!(await ready($("regAgentSt")))) return;
  const id = $("aid").value.trim().toLowerCase(), ep = $("endpoint").value.trim(), claims = chosenClaims();
  if (!id || !ep || !claims.length) { $("regAgentSt").innerHTML = warn("an id, an https endpoint and at least one claim; the try chips above fill all three"); return; }
  const taken = await viewJson("passport", [id], { fresh: true, tries: 3 });
  if (taken && !taken.error) { $("regAgentSt").innerHTML = warn(`${id} is already registered (by ${short(taken.operator)}); press "suggest an id" for a free one`); return; }
  const stake = stakeFor(claims.length);
  const r = await send("register", [id, ep, JSON.stringify(claims)], "registering " + id, $("regAgentSt"),
    { value: stake, wait: $("regWait"), state: "staking", ctx: { id, stake }, role: "operator" }).catch((e) => ({ msg: e.message }));
  forget(id);
  if (r?.j?.ok) {
    lastPreset = "";      // the id is now this visitor's agent: the next refresh must not rename it as "taken"
    mark("registered"); remember(id, "registered with its stake", r);
    done($("regAgentSt"), `registered ${id} with ${gen(r.j.stake)} of stake: ${r.j.status}. Now Inspect it in section 07`, r);
    panel($("regWait"), "unverified", { id, stake: r.j.stake }, "operator");
    pick(id, claims[0]);
  } else { $("regWait").innerHTML = ""; done($("regAgentSt"), why(r), r); }
  paint(); await renderAgents();
};
$("update").onclick = async () => {
  if (!(await ready($("regAgentSt")))) return;
  const id = $("aid").value.trim().toLowerCase(), ep = $("endpoint").value.trim(), claims = chosenClaims();
  const p = await viewJson("passport", [id], { fresh: true });
  if (!p || p.error) { $("regAgentSt").innerHTML = warn(p?.error || "could not read " + id + " just now; press again"); return; }
  if (!same(p.operator, account)) { $("regAgentSt").innerHTML = warn(`only ${id}'s operator (${short(p.operator)}) may update it; this wallet is ${short(account)}`); return; }
  const need = stakeFor(claims.length), have = big(p.stake);
  const topUp = need > have ? need - have : 0n, back = have > need ? have - need : 0n;
  const r = await send("update", [id, ep, JSON.stringify(claims)], "updating " + id, $("regAgentSt"),
    { value: topUp, wait: $("regWait"), state: "topping", ctx: { id, amount: topUp, returned: back }, role: "operator" }).catch((e) => ({ msg: e.message }));
  forget(id);
  if (r?.j?.ok) {
    remember(id, "claims updated", r);
    done($("regAgentSt"), `updated ${id}: ${r.j.status}, stake ${gen(r.j.stake)}${big(r.j.topped_up) ? ", " + gen(r.j.topped_up) + " added" : ""}${big(r.j.returned) ? ", " + gen(r.j.returned) + " handed back" : ""}. Inspect it again`, r);
    panel($("regWait"), "unverified", { id, stake: r.j.stake }, "operator");
  } else { $("regWait").innerHTML = ""; done($("regAgentSt"), why(r), r); }
  await renderAgents();
};
$("retire").onclick = async () => {
  if (!(await ready($("regAgentSt")))) return;
  const id = $("aid").value.trim().toLowerCase();
  if (!id) { $("regAgentSt").innerHTML = warn("put the id of your agent in the box above"); return; }
  if (!confirm(`Retire ${id}? It cannot be undone. Its passport stays in force, and can still be challenged, for one more day; then Unstake hands its stake back.`)) return;
  const p = await viewJson("passport", [id]);
  const r = await send("retire", [id], "retiring " + id, $("regAgentSt"), { wait: $("regWait"), state: "retiring", ctx: { id, stake: p?.stake }, role: "operator" }).catch((e) => ({ msg: e.message }));
  forget(id);
  if (r?.j?.ok) {
    remember(id, "retired", r);
    done($("regAgentSt"), `retired ${id}; the hold ends at ${clock(r.j.hold_ends)}`, r);
    panel($("regWait"), "retired", { id, stake: r.j.stake, until: r.j.hold_ends, now: chainNow() }, "operator", { extra: `<p class="mono muted">the hold ends in ${countdown(r.j.hold_ends, "now: press Unstake mine")}</p>` });
  } else { $("regWait").innerHTML = ""; done($("regAgentSt"), why(r), r); }
  await renderAgents();
};
$("unstake").onclick = async () => {
  if (!(await ready($("regAgentSt")))) return;
  const id = $("aid").value.trim().toLowerCase();
  if (!id) { $("regAgentSt").innerHTML = warn("put the id of your retired agent in the box above"); return; }
  const p = await viewJson("passport", [id], { fresh: true });
  if (p && !p.error && p.retired && !p.hold_over) {
    panel($("regWait"), "retired", { id, stake: p.stake, until: p.hold_ends, now: chainNow() }, roleOf(p, account), { extra: `<p class="mono muted">the hold ends in ${countdown(p.hold_ends, "now: press Unstake mine")}</p>` });
    $("regAgentSt").innerHTML = warn(`the hold after retire ends at ${clock(p.hold_ends)}; until then a challenge can still reach this stake`); return;
  }
  const before = await balanceOf(account);
  const r = await send("unstake", [id], "unstaking " + id, $("regAgentSt"), { wait: $("regWait"), state: "unstaking", ctx: { id, stake: p?.stake }, role: "operator" }).catch((e) => ({ msg: e.message }));
  forget(id);
  if (r?.j?.ok) {
    remember(id, "stake taken back", r);
    done($("regAgentSt"), `${gen(r.j.returned)} of stake is on its way back to you; it lands when the transaction is finalized`, r);
    finalized(r.tx).then(async (ok) => { if (!ok) return; const after = await balanceOf(account); if (before !== null && after !== null) $("regAgentSt").innerHTML += esc(` · landed: your balance went from ${gen(before)} to ${gen(after)}`); });
  } else { $("regWait").innerHTML = ""; done($("regAgentSt"), why(r), r); }
  await renderAgents();
};

/* ------------------------------------------------------ inspect, and challenge */
/* Section 07: the agent in the box, what it holds, and where this wallet stands with it. */
let targetRow = null;
const coolKey = () => "passport_cool_v2";
function coolEnd(id, p) {
  const k = (reg || "").toLowerCase() + "|" + id + "|" + (account || "");
  let last = Number((store.get(coolKey(), {}) || {})[k] || 0);
  if (p?.last_challenge && same(p.last_challenge.by, account)) last = Math.max(last, isoSeconds(p.last_challenge.at));
  return last > 0 ? last + COOLDOWN_SECONDS : 0;
}
function noteCool(id, iso) {
  const all = store.get(coolKey(), {}) || {};
  all[(reg || "").toLowerCase() + "|" + id + "|" + (account || "")] = isoSeconds(iso);
  const keys = Object.keys(all); if (keys.length > 60) delete all[keys[0]];
  store.set(coolKey(), all);
}
let creditNow = null;
async function myCredit(fresh = false) {
  if (!account || !reg) return 0n;
  const c = await viewJson("credit_of", [account], { fresh });
  creditNow = c && !c.error ? big(c.credit) : null;
  return creditNow ?? 0n;
}
function targetHtml(p, role, credit) {
  const st = rowState(p), stake = big(p.stake), bond = big(p.challenge_bond);
  const lines = [
    `<span class="name">${esc(p.agent)}</span> ${badgeFor(p)}`,
    `<div class="mono muted">stake ${esc(gen(stake))}${p.in_force ? ` · bond ${esc(gen(p.challenge_bond))} · fee ${esc(gen(p.challenge_fee))} · a contradiction pays the challenger ${esc(gen(stake / 2n))}` : " · not in force, so it cannot be challenged"}</div>`,
  ];
  if (role === "operator") lines.push(`<div class="fine">You are its operator: you cannot challenge it. ${p.in_force ? "Inspect renews it for 30 days from now, and a contradiction found by your own renewal slashes the whole stake." : "Inspect it to issue it."}</div>`);
  else if (account) {
    const cd = coolEnd(p.agent, p), short_ = bond > credit ? bond - credit : 0n;
    lines.push(`<div class="fine">Your credit: <b>${esc(gen(credit))}</b>${short_ > 0n ? ` · the bond needs ${esc(gen(short_))} more: press Deposit the bond` : " · it covers the bond"}`
      + (cd > chainNow() ? ` · <span class="warn">your cooldown on ${esc(p.agent)} ends in ${countdown(cd, "now")}</span>` : "") + `</div>`);
  }
  if (st !== "issued") lines.push(`<div class="fine">${esc(waitLines(st === "revoked_row" ? "revoked" : st, { id: p.agent, stake: p.stake, bond: p.challenge_bond, fee: p.challenge_fee, until: p.hold_ends, now: chainNow() }, role).what)}</div>`);
  return lines.join("");
}
async function paintTarget(id) {
  const host = $("chTarget"); if (!host) return;
  id = String(id || "").trim().toLowerCase();
  if (!id || !reg) { host.innerHTML = '<span class="fine">pick an agent above: its stake, the bond a challenge needs and your credit appear here</span>'; targetRow = null; return; }
  host.innerHTML = '<span class="fine">reading ' + esc(id) + " …</span>";
  const p = await viewJson("passport", [id]);
  if ($("iid").value.trim().toLowerCase() !== id) return;
  if (!p) { host.innerHTML = warn("could not read " + id + " just now"); return; }
  if (p.error) { host.innerHTML = warn(p.error); targetRow = null; return; }
  targetRow = p;
  const role = roleOf(p, account);
  const credit = await myCredit();
  host.innerHTML = targetHtml(p, role, credit);
  $("inspect").textContent = role === "operator" && p.in_force ? "Renew (operator)" : "Inspect (operator)";
}
let typing = null;
$("iid").addEventListener("input", () => { clearTimeout(typing); typing = setTimeout(() => paintTarget($("iid").value), 700); });

$("inspect").onclick = async () => {
  if (!(await ready($("inspectSt")))) return;
  const id = $("iid").value.trim().toLowerCase(); if (!id) { $("inspectSt").innerHTML = warn("pick an agent above first"); return; }
  const p = await viewJson("passport", [id], { fresh: true });
  if (p && !p.error && !same(p.operator, account)) { $("inspectSt").innerHTML = warn(`only ${id}'s operator (${short(p.operator)}) may inspect it; anyone else challenges it`); return; }
  $("inspect").disabled = true;
  const renewal = !!(p && p.in_force);
  $("chResult").innerHTML = "";
  const r = await send("inspect", [id], (renewal ? "renewing " : "inspecting ") + id, $("inspectSt"),
    { wait: $("chWait"), state: "inspecting", ctx: { id, stake: p?.stake, endpoint: p?.endpoint, renewal }, role: "operator" }).catch((e) => ({ msg: e.message }));
  forget(id);
  if (r?.j?.ok) {
    mark("inspected"); remember(id, r.j.renewal ? (r.j.outcome === "renewed" ? "renewed" : "inspected in force: " + r.j.outcome) : "inspected, " + r.j.status, r);
    done($("inspectSt"), `${id}: ${r.j.renewal ? "renewal " + r.j.outcome + ", " : ""}${r.j.status}. The passport is in section 08`, r);
    log("  " + esc(JSON.stringify(r.j.verdicts)));
    const q = await viewJson("passport", [id], { fresh: true });
    const st = q && !q.error ? rowState(q) : r.j.status;
    panel($("chWait"), st === "revoked_row" ? "revoked" : st, { id, stake: q?.stake ?? r.j.stake, bond: q?.challenge_bond, fee: q?.challenge_fee, until: isoSeconds(q?.issued_at) + 30 * 86400 }, "operator");
    $("chResult").innerHTML = verdictBlock(r.j.verdicts, r.j.reasons);
  } else if (r?.split) panel($("chWait"), "split", { id }, "operator");
  else { $("chWait").innerHTML = ""; done($("inspectSt"), why(r), r); }
  $("inspect").disabled = false;
  paint(); await renderAgents(); paintTarget(id);
};

/* A challenge: checked here first so a visitor never spends a transaction on a refusal the page can see coming,
   then the same rules again in the contract. els: st (status line), wait (panel), result (card). */
const CH_KEY = "passport_challenge_v2";
async function runChallenge(id, els) {
  if (!(await ready(els.st))) return;
  els.result.innerHTML = "";
  const p = await viewJson("passport", [id], { fresh: true });
  if (!p || p.error) { els.st.innerHTML = warn(p?.error || "could not read " + id + " just now; press again"); return; }
  if (roleOf(p, account) === "operator") { els.st.innerHTML = warn(`This wallet is ${id}'s operator, and an operator cannot challenge its own passport. Switch to another account in your wallet, then press again.`); return; }
  if (!p.in_force) { els.st.innerHTML = warn(`${id} holds no passport in force (it is ${p.status}${p.retired ? ", retired" : ""}), so there is nothing to challenge`); return; }
  const credit = await myCredit(true), bond = big(p.challenge_bond);
  if (credit < bond) { els.st.innerHTML = warn(`the bond is ${gen(bond)} of credit and this address holds ${gen(credit)}: press Deposit the bond first`); return; }
  const cd = coolEnd(id, p);
  if (cd > chainNow()) { panel(els.wait, "cooldown", { id, until: cd, now: chainNow(), credit }, "challenger", { extra: `<p class="mono muted">again in ${countdown(cd, "now")}</p>` }); els.st.textContent = ""; return; }
  const ctx = { id, stake: p.stake, bond: p.challenge_bond, fee: p.challenge_fee, credit };
  const before = await balanceOf(account);
  const r = await send("challenge", [id], "challenging " + id, els.st, { wait: els.wait, state: "challenging", ctx, role: "challenger",
    onSent: (tx) => store.set(CH_KEY, { register: reg, agent: id, tx, by: account, stake: p.stake, bond: p.challenge_bond, fee: p.challenge_fee, before: before === null ? null : String(before) }) })
    .catch((e) => ({ msg: e.message, failed: true }));
  await showChallenge(id, r, els, before);
}
async function showChallenge(id, r, els, before) {
  forget(id);
  if (r?.j?.ok) {
    store.set(CH_KEY, null);
    const row = r.j;
    mark("challenged"); remember(id, "challenged: " + row.outcome, r); noteCool(id, row.at);
    const state = row.outcome, role = same(row.by, account) ? "challenger" : "visitor";
    done(els.st, `${id}: ${outcomeHead(row, account).head.toLowerCase()}`, r);
    els.result.innerHTML = resultCard(row, account, r.tx);
    const end = isoSeconds(row.at) + COOLDOWN_SECONDS;
    panel(els.wait, state, { id, stake: row.stake_before, bond: row.bond, fee: row.to_operator !== "0" ? row.to_operator : row.from_credit, credit: row.credit }, role,
      { extra: row.status_after === "issued" || row.suspended ? `<p class="mono muted">this address may challenge ${esc(id)} again in ${countdown(end, "now")}</p>` : "" });
    log("  " + esc(JSON.stringify(row.verdicts)));
    const fin = els.result.querySelector("[data-final]");
    if (fin && row.outcome !== "unanswered") {
      fin.insertAdjacentHTML("beforeend", ' · <span class="shimmer">waiting for finalization: the transfer lands then</span>');
      finalized(r.tx).then(async (ok) => {
        if (!ok) { fin.innerHTML = link("/tx/" + r.tx, "the transaction on the explorer ↗") + " · not finalized yet; the explorer shows its state"; return; }
        const after = row.outcome === "revoked" && account ? await balanceOf(account) : null;
        fin.innerHTML = link("/tx/" + r.tx, "the transaction on the explorer ↗") + " · finalized: the transfer has landed"
          + (after !== null && before !== null && before !== undefined ? esc(` · your balance went from ${gen(before)} to ${gen(after)}`) : "");
      });
    }
  } else if (r?.split) { store.set(CH_KEY, null); panel(els.wait, "split", { id }, "challenger"); done(els.st, why(r), r); }
  else { if (!r?.failed) store.set(CH_KEY, null); els.wait.innerHTML = ""; done(els.st, why(r), r); }
  await renderAgents(); paintTarget($("iid").value); if (demo.target && same(demo.target.agent, id)) await loadDemo(); else paintDemo();
}
/* A challenge sent from this browser and left before its verdict: picked up again on the next visit. */
async function resumeChallenge() {
  const c = store.get(CH_KEY, null);
  if (!c || !c.tx || !reg || !same(c.register, reg)) return;
  const inDemo = (demo.target && same(demo.target.agent, c.agent)) || demo.swaps.some((p) => same(p.agent, c.agent));
  const els = inDemo ? { st: $("catchSt"), wait: $("catchWait"), result: $("catchResult") } : { st: $("inspectSt"), wait: $("chWait"), result: $("chResult") };
  panel(els.wait, "challenging", { id: c.agent, stake: c.stake, bond: c.bond, fee: c.fee }, "challenger", { busy: true, stage: "picking it up again" });
  const w = await wait(c.tx, "challenging " + c.agent, els.st, (s, secs) => stageOf(els.wait, (STAGES[s] || s.toLowerCase()) + " · " + span(secs)));
  await showChallenge(c.agent, w ? { ...w, tx: c.tx } : { tx: c.tx, msg: "the challenge did not settle; the explorer shows its state" }, els, c.before === null ? null : big(c.before));
}
$("challenge").onclick = async () => {
  const id = $("iid").value.trim().toLowerCase(); if (!id) { $("inspectSt").innerHTML = warn("pick an agent above first"); return; }
  $("challenge").disabled = true;
  try { await runChallenge(id, { st: $("inspectSt"), wait: $("chWait"), result: $("chResult") }); } finally { $("challenge").disabled = false; }
};
/* Credit: the bond a challenge needs, added with deposit() and taken back with withdraw(). */
async function depositBond(id, st, waitHost) {
  if (!(await ready(st))) return;
  const p = id ? await viewJson("passport", [id], { fresh: true }) : null;
  if (!p || p.error) { st.innerHTML = warn("pick an agent first: the bond is a tenth of its stake"); return; }
  const credit = await myCredit(true), bond = big(p.challenge_bond);
  const add = bond > credit ? bond - credit : 0n;
  if (add === 0n) { st.textContent = `your credit (${gen(credit)}) already covers ${id}'s bond (${gen(bond)}): challenge it`; return; }
  const r = await send("deposit", [], "adding " + gen(add) + " of credit", st, { value: add, wait: waitHost, state: "deposit", ctx: { amount: add }, role: "challenger" }).catch((e) => ({ msg: e.message }));
  forget(null);
  if (r?.j?.ok) { done(st, `your credit is now ${gen(r.j.credit)}: it covers ${id}'s bond. Challenge it`, r); waitHost.innerHTML = ""; }
  else { waitHost.innerHTML = ""; done(st, why(r), r); }
  paintTarget($("iid").value); paintDemo();
}
async function withdrawCredit(st, waitHost) {
  if (!(await ready(st))) return;
  const credit = await myCredit(true);
  if (credit === 0n) { st.textContent = "this address holds no credit in the register"; return; }
  const before = await balanceOf(account);
  const r = await send("withdraw", [], "taking back " + gen(credit) + " of credit", st, { wait: waitHost, state: "withdraw", ctx: { credit }, role: "challenger" }).catch((e) => ({ msg: e.message }));
  forget(null);
  if (r?.j?.ok) {
    done(st, `${gen(r.j.withdrawn)} of credit is on its way back to you; it lands when the transaction is finalized`, r);
    finalized(r.tx).then(async (ok) => { if (!ok) return; const after = await balanceOf(account); waitHost.innerHTML = ""; if (before !== null && after !== null) st.innerHTML += esc(` · landed: your balance went from ${gen(before)} to ${gen(after)}`); });
  } else { waitHost.innerHTML = ""; done(st, why(r), r); }
  paintTarget($("iid").value); paintDemo();
}
$("chDeposit").onclick = () => depositBond($("iid").value.trim().toLowerCase(), $("inspectSt"), $("chWait"));
$("chWithdraw").onclick = () => withdrawCredit($("inspectSt"), $("chWait"));
$("gate").onclick = async () => {
  if (!reg) { $("gateSt").textContent = "load a register first (section 05)"; return; }
  const a = $("gAgent").value.trim(), c = $("gClaim").value.trim();
  const r = await readOrRetry("is_valid", [a, c], 8, reg, true);
  $("gateSt").textContent = r.ok ? `is_valid(${a}, ${c}) → ${r.value}` : "could not read just now";
};

/* ------------------------------------------- 02: catch a swapped model */
/* The demo agents are opened once by the site's operator (tools/open-demo-agents.mjs): one honest agent and a
   few swap agents, each staked and inspected before its switch. The page reads the file that script wrote, and
   uses a row only when its operator is the one the file names: a name is a handle, not authority. */
const demo = { file: null, honest: null, swaps: [], target: null, unreadable: false };
async function loadDemo() {
  demo.file = null; demo.honest = null; demo.swaps = []; demo.target = null; demo.unreadable = false;
  if (!reg) { paintDemo(); return; }
  let f = null;
  try { const r = await fetch(DEMO_FILE + "?t=" + Date.now()); if (r.ok) f = await r.json(); } catch (e) {}
  if (!f || !same(f.register, reg) || !/^0x[0-9a-fA-F]{40}$/.test(String(f.operator || ""))) { paintDemo(); return; }
  demo.file = f;
  const h = await viewJson("passport", [String(f.honest?.id || "demo-honest")]);
  if (h === null) demo.unreadable = true;
  else if (!h.error && same(h.operator, f.operator)) demo.honest = h;
  const prefix = String(f.swap_prefix || "demo-swap-");
  let n = Math.max(1, Math.floor(Number(f.first_open) || 1));
  for (let k = 0; k < SWAP_PROBES; k++, n++) {
    const p = await viewJson("passport", [prefix + n]);
    if (p === null) { demo.unreadable = true; break; }
    if (p.error) break;                                   // the first id not registered: the end of the line
    if (!same(p.operator, f.operator) || !swapAtOf(p.endpoint)) continue;
    demo.swaps.push(p);
    if (p.in_force && !p.suspended && !p.retired) { demo.target = p; break; }
  }
  paintDemo(); paint();
}
function paintDemo() {
  const host = $("catchTarget"); if (!host) return;
  const t = demo.target;
  if (!reg) {
    host.innerHTML = `<p class="fine">${DEMO_REGISTER ? "Loading the version 2 register …" : "<b>The version 2 register is not deployed yet.</b> The swapped demo agent appears here once it is. Meanwhile you can deploy your own register in section 05 and try every path with two wallets: register a swap agent (section 06, the swap chip), inspect it before its switch, and challenge it from your second account after."}</p>`;
  } else if (!demo.file) {
    host.innerHTML = `<p class="fine">This register has no demo agents opened by the site's operator${DEMO_REGISTER && !same(reg, DEMO_REGISTER) ? " (they live on the version 2 register this site points at; load it in section 05)" : ""}. You can still try it all: register a swap agent with its stake (section 06, the swap chip), inspect it before its switch, and challenge it after from a second account.</p>`;
  } else if (!t) {
    host.innerHTML = demo.unreadable ? `<p class="warn">Studio did not answer the reads for the demo agents just now; press Load again in section 05 in a minute.</p>`
      : `<p class="fine"><b>Every demo swap agent the page can see has been caught already</b>${demo.swaps.length ? " (" + demo.swaps.map((p) => esc(p.agent) + ": " + esc(p.status)).join(", ") + ")" : ""}. The site's operator opens fresh ones with <span class="mono">tools/open-demo-agents.mjs</span>. Until then: register your own swap agent in section 06 and challenge it from a second account, or read how the caught ones ended in section 08.</p>`;
  } else {
    const at = swapAtOf(t.endpoint), stake = big(t.stake), now = chainNow();
    const open = at > 0 && now >= at + SWAP_MARGIN;
    host.innerHTML = `<div class="head"><span class="name">${esc(t.agent)}</span>${badgeFor(t)}</div>
      <div class="mono muted">operator ${esc(short(t.operator))} (the site's demo operator) · claims ${esc((t.claims || []).join(", "))}</div>
      <div class="mono muted">stake <b>${esc(gen(stake))}</b> · bond ${esc(gen(t.challenge_bond))} · fee ${esc(gen(t.challenge_fee))} · a catch pays ${esc(gen(stake / 2n))}</div>
      <div class="mono muted">its endpoint ${at <= now ? "switched model at <b>" + esc(clock(at)) + "</b> on " + esc(new Date(at * 1000).toISOString().slice(0, 10)) + ", after it was inspected and issued" : "switches model in " + countdown(at, "now")}</div>
      <div class="mono muted">is_valid(${esc(t.agent)}, can:code) → <b>${t.valid ? "true" : "false"}</b>${t.valid ? ": nothing on chain knows yet" : ""}</div>`;
    $("catchGo").disabled = !open;
    if (!open) {
      tickers.add((n) => { if (n >= at + SWAP_MARGIN) { $("catchGo").disabled = false; return false; } });
      $("catchSt").innerHTML = `the agent switches at ${esc(clock(at))}; the challenge opens ${esc(span(SWAP_MARGIN))} after that, so every validator meets the new model`;
    }
  }
  if (!t) $("catchGo").disabled = false;
  if (account && t) myCredit().then((c) => { if ($("catchCredit")) $("catchCredit").textContent = `your credit ${gen(c)} · the bond ${gen(t.challenge_bond)}`; });
  else if ($("catchCredit")) $("catchCredit").textContent = t ? `the bond: ${gen(t.challenge_bond)} of credit` : "";
  paintJobChoices();
}
$("catchDeposit").onclick = () => demo.target ? depositBond(demo.target.agent, $("catchSt"), $("catchWait")) : ($("catchSt").innerHTML = warn("there is no demo swap agent to bond against right now"));
$("catchGo").onclick = async () => {
  if (!demo.target) { $("catchSt").innerHTML = warn("there is no demo swap agent to challenge right now; see the note above"); return; }
  $("catchGo").disabled = true;
  try { await runChallenge(demo.target.agent, { st: $("catchSt"), wait: $("catchWait"), result: $("catchResult") }); } finally { $("catchGo").disabled = false; }
};
$("catchWithdraw").onclick = () => withdrawCredit($("catchSt"), $("catchWait"));

/* ---------------------------------------------- 03: pay through escrow */
/* A job is an escrow contract the visitor deploys and funds as its buyer (contracts/fixtures/escrow.py), bound to
   the agent, one claim, and the operator and endpoint the site's demo file names. It is remembered in this
   browser, so the visitor can leave between the steps. */
const JOB_KEY = "passport_job_v2";
let job = store.get(JOB_KEY, null);
let jobFor = "honest";       // which demo agent the next job is for: "honest" or "swap"
const saveJob = () => store.set(JOB_KEY, job);
const jobHere = () => job && reg && same(job.register, reg);
function paintJobChoices() {
  const host = $("jobPick"); if (!host) return;
  const opts = [];
  if (demo.honest) opts.push(["honest", demo.honest.agent + " · the operator is paid"]);
  if (demo.target) opts.push(["swap", demo.target.agent + " · refunded once it is caught"]);
  if (!opts.some(([k]) => k === jobFor)) jobFor = opts[0]?.[0] || "honest";
  host.innerHTML = '<span class="lead">a job for</span>' + (opts.length ? opts.map(([k, t]) => `<button class="chip${k === jobFor ? " on" : ""}" data-job="${k}">${esc(t)}</button>`).join("")
    : `<span class="fine">${reg ? "no demo agent on this register" : "the version 2 register is not deployed yet"}</span>`);
  for (const b of host.querySelectorAll("[data-job]")) b.onclick = () => { jobFor = b.dataset.job; paintJobChoices(); };
  paintJob();
}
function jobRow() { return jobFor === "swap" ? demo.target : demo.honest; }
function paintJob() {
  const host = $("jobTarget"), go = $("jobGo"); if (!host || !go) return;
  if (jobHere()) {
    const lines = [`<div class="mono muted">job ${job.address ? link("/address/" + job.address, short(job.address) + " ↗") : "deploying …"} · for ${esc(job.agent)} · claim ${esc(job.claim)} · buyer you</div>`,
      `<div class="mono muted">bound to operator ${esc(short(job.operator))} and endpoint ${esc(job.endpoint)}</div>`];
    if (job.funded) lines.push(`<div class="mono muted">holds ${esc(gen(job.funded))}${job.mark !== undefined ? " · slashed from " + esc(job.agent) + " when you funded: " + esc(gen(job.mark || "0")) : ""}</div>`);
    host.innerHTML = lines.join("");
    go.textContent = job.result ? "Open a new job" : job.funded ? "Settle the job" : job.address ? "Fund the job" : "Open the job";
    $("jobAmountRow").hidden = !!(job.funded || job.result);
  } else {
    const p = jobRow();
    host.innerHTML = p ? `<div class="mono muted">${esc(p.agent)} · operator ${esc(short(p.operator))} · ${badgeFor(p)}</div><div class="mono muted">endpoint ${esc(p.endpoint)}</div>`
      : '<span class="fine">the demo agents appear here once the version 2 register and its demo agents are on chain</span>';
    go.textContent = "Open the job";
    $("jobAmountRow").hidden = false;
  }
}
async function jobStep() {
  const st = $("jobSt"), host = $("jobWait");
  if (!(await ready(st))) return;
  if (jobHere() && job.result) { job = null; saveJob(); $("jobResult").innerHTML = ""; host.innerHTML = ""; st.textContent = ""; paintJob(); return; }
  if (!jobHere()) {
    const p = jobRow();
    if (!p) { st.innerHTML = warn("there is no demo agent to open a job for on this register"); return; }
    const claim = (p.claims || []).includes("can:code") ? "can:code" : (p.claims || [])[0];
    const ctx = { id: p.agent, claim, operator: short(p.operator) };
    job = { register: reg, agent: p.agent, claim, operator: p.operator, endpoint: p.endpoint, kind: jobFor };
    try {
      const d = await deployCode("./contracts/fixtures/escrow.py", [reg, p.agent, claim, p.operator, p.endpoint], "opening a job for " + p.agent, st, host, "job_open", ctx,
        (tx) => { job.deployTx = tx; saveJob(); });
      if (!d.address) throw new Error("the job's deploy did not settle; " + (d.w?.split ? "no majority, press again" : "the explorer shows its state"));
      job.address = d.address; saveJob();
      done(st, `the job is open at ${d.address}: now fund it`, { tx: d.tx });
      host.innerHTML = "";
    } catch (e) {
      const tx = job?.deployTx;
      job = null; saveJob(); host.innerHTML = "";
      st.innerHTML = warn(String(e.message || e).slice(0, 200)) + (tx ? " · " + link("/tx/" + tx, "that deploy on the explorer ↗") : "");
    }
    paintJob(); return;
  }
  if (!job.address) { st.textContent = "the job's deploy is still settling"; return; }
  if (!job.funded) {
    const amount = attoOf($("jobAmount").value);
    if (!amount) { st.innerHTML = warn("type an amount of GEN greater than zero, like 1 or 0.5"); return; }
    const r = await send("fund", [], "funding the job with " + gen(amount), st, { address: job.address, value: amount, wait: host, state: "job_fund", ctx: { id: job.agent, amount }, role: "buyer",
      onSent: (tx) => { job.fundTx = tx; saveJob(); } }).catch((e) => ({ msg: e.message }));
    if (r?.j?.ok) {
      job.funded = r.j.pool; job.mark = r.j.slashed_at_funding; saveJob();
      done(st, `the job holds ${gen(r.j.pool)}. Settle it when you like`, r);
      const would = await readOrRetry("would_pay", [], 8, job.address, true);
      panel(host, "job_funded", { id: job.agent, amount: r.j.pool }, "buyer",
        { extra: `<p class="mono muted">would_pay, read now for free → <b>${would.ok ? esc(String(would.value)) : "could not read just now"}</b></p>` });
    } else { host.innerHTML = ""; done(st, why(r), r); }
    paintJob(); return;
  }
  const opBefore = await balanceOf(job.operator), meBefore = await balanceOf(account);
  const r = await send("release", [], "settling the job", st, { address: job.address, wait: host, state: "job_settle", ctx: { id: job.agent, claim: job.claim, amount: job.funded }, role: "buyer",
    onSent: (tx) => { job.releaseTx = tx; job.before = { op: opBefore === null ? null : String(opBefore), me: meBefore === null ? null : String(meBefore) }; saveJob(); } }).catch((e) => ({ msg: e.message }));
  await showRelease(r);
}
async function showRelease(r) {
  const st = $("jobSt"), host = $("jobWait");
  if (r?.j?.ok) {
    job.result = r.j; saveJob();
    const paid = r.j.paid === "operator";
    if (paid) mark("paid");
    done(st, paid ? `the job paid ${gen(r.j.amount)} to the operator` : `the job refunded ${gen(r.j.amount)} to you`, r);
    panel(host, paid ? "job_paid" : "job_refunded", { id: job.agent, amount: r.j.amount }, "buyer");
    $("jobResult").innerHTML = `<div class="result ${paid ? "held" : "inconclusive"}"><div class="rhead">${paid ? "Paid · the operator" : "Refunded · you"}</div>
      <div class="mono muted">passport ${esc(r.j.passport)} · is_valid ${r.j.valid ? "yes" : "no"} · bound row ${r.j.bound ? "yes" : "no"} · no revoke since funding ${r.j.unrevoked ? "yes" : "no"}</div>
      <ul class="money"><li>${esc(gen(r.j.amount))} to ${paid ? "the operator " + esc(short(r.j.to)) : "you, the buyer"}</li></ul>
      <div class="mono muted" data-final>${link("/tx/" + r.tx, "the transaction on the explorer ↗")} · <span class="shimmer">waiting for finalization: the transfer lands then</span></div></div>`;
    const fin = $("jobResult").querySelector("[data-final]");
    const who = paid ? job.operator : account, before = big(paid ? job.before?.op : job.before?.me);
    finalized(r.tx).then(async (ok) => {
      if (!ok) { fin.innerHTML = link("/tx/" + r.tx, "the transaction on the explorer ↗") + " · not finalized yet; the explorer shows its state"; return; }
      const after = await balanceOf(who);
      panel(host, paid ? "job_paid" : "job_refunded", { id: job?.agent, amount: r.j.amount, final: true }, "buyer");
      fin.innerHTML = link("/tx/" + r.tx, "the transaction on the explorer ↗") + " · finalized · " + link("/address/" + who, (paid ? "the operator's" : "your") + " address ↗")
        + (after !== null && before > 0n ? esc(` · balance ${gen(before)} → ${gen(after)} (${after - before >= 0n ? "+" : ""}${gen(after - before)})`) : "");
    });
  } else if (r?.split) { panel(host, "split", {}, "buyer"); done(st, why(r), r); }
  else { host.innerHTML = ""; done(st, why(r), r); }
  paintJob(); await renderAgents();
}
/* A job left between steps: its address, funding or settlement is picked up again. */
async function resumeJob() {
  if (!jobHere()) { paintJob(); return; }
  paintJob();
  const st = $("jobSt"), host = $("jobWait");
  if (job.deployTx && !job.address) {
    panel(host, "job_open", { id: job.agent, claim: job.claim, operator: short(job.operator) }, "buyer", { busy: true, stage: "picking it up again" });
    const w = await wait(job.deployTx, "opening the job", st);
    if (w && !w.split && w.address) { job.address = w.address; saveJob(); done(st, `the job is open at ${w.address}: now fund it`, { tx: job.deployTx }); }
    else { job = null; saveJob(); st.innerHTML = warn("that job's deploy did not settle; open a new one"); }
    host.innerHTML = ""; paintJob(); return;
  }
  if (job.releaseTx && !job.result) {
    panel(host, "job_settle", { id: job.agent, claim: job.claim, amount: job.funded }, "buyer", { busy: true, stage: "picking it up again" });
    const w = await wait(job.releaseTx, "settling the job", st);
    await showRelease(w ? { ...w, tx: job.releaseTx } : { tx: job.releaseTx, msg: "the settlement did not settle; the explorer shows its state" });
    return;
  }
  if (job.funded && !job.result) panel(host, "job_funded", { id: job.agent, amount: job.funded }, "buyer");
}
$("jobGo").onclick = async () => { $("jobGo").disabled = true; try { await jobStep(); } finally { $("jobGo").disabled = false; } };
$("jobForget").onclick = () => {
  if (jobHere() && job.funded && !job.result && !confirm(`This job still holds ${gen(job.funded)}. Forget it here anyway? It stays on chain at ${job.address}; settle it from the explorer address or come back to it.`)) return;
  job = null; saveJob(); $("jobResult").innerHTML = ""; $("jobWait").innerHTML = ""; $("jobSt").textContent = ""; paintJob();
};

/* ---------------------------------------------------------------- agents */
function badgeFor(p) {
  const st = rowState(p);
  const map = { issued: ["issued", "issued"], refused: ["refused", "refused"], revoked_row: ["refused", "revoked"], pending: ["pending", "pending"],
    unverified: ["unverified", "unverified"], expired: ["withdrawn", "expired"], suspended: ["pending", "suspended"],
    retired: ["withdrawn", "retired · hold"], unstake_ready: ["withdrawn", "retired"], retired_done: ["withdrawn", "retired"], missing: ["withdrawn", "unknown"] };
  const [cls, text] = map[st] || ["withdrawn", st];
  return `<span class="badge ${cls}">${esc(text)}</span>`;
}
function verdictBlock(verdicts, reasons) {
  const rows = Object.entries(verdicts || {}).map(([c, v]) => `<div class="v ${esc(v)}">${esc(c)} → ${esc(v)}</div><div class="reason">${esc((reasons || {})[c] || "")}</div>`).join("");
  return rows ? `<div class="verdicts">${rows}</div>` : "";
}
function resultCard(row, me, tx) {
  const h = outcomeHead(row, me);
  return `<div class="result ${h.cls}"><div class="rhead">${esc(h.head)}</div>
    <div class="mono muted">challenge #${esc(row.n)} of ${esc(row.agent)} · ${esc(String(row.at).slice(0, 19).replace("T", " "))} UTC · by ${same(row.by, me) ? "you" : esc(short(row.by))} · the passport is now ${esc(row.status_after)}${row.suspended ? ", suspended" : ""}</div>
    <ul class="money">${moneyLines(row, me).map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
    ${verdictBlock(row.verdicts, row.reasons)}
    <div class="mono muted" data-final>${tx ? link("/tx/" + tx, "the transaction on the explorer ↗") : ""}</div></div>`;
}
function agentCard(a) {
  const st = rowState(a), role = roleOf(a, account), stake = big(a.stake), at = swapAtOf(a.endpoint), now = chainNow();
  const issuedS = isoSeconds(a.issued_at);
  const copyState = st === "revoked_row" ? "revoked" : st === "retired_done" || st === "missing" ? "" : st;
  const ctx = { id: a.agent, stake: a.stake, bond: a.challenge_bond, fee: a.challenge_fee, until: st === "retired" ? a.hold_ends : issuedS > 0 ? issuedS + a.valid_days * 86400 : 0, now };
  const acts = [];
  if (a.in_force && role !== "operator") acts.push(`<button class="chip" data-act="challenge" data-id="${esc(a.agent)}">challenge it</button>`);
  if (role === "operator" && !a.retired) acts.push(`<button class="chip" data-act="inspect" data-id="${esc(a.agent)}">${a.in_force ? "renew it" : "inspect it"}</button>`);
  return `<div class="agent" data-agent="${esc(a.agent)}"><div class="head"><span class="name" data-pick="${esc(a.agent)}" title="put this agent in the inspect, challenge and gate boxes">${esc(a.agent)}</span>${badgeFor(a)}</div>
      <div class="mono muted">${esc(a.endpoint)}${at ? " · " + (at > now ? "switches model in " + countdown(at, "now") : "switched model at " + esc(clock(at)) + " " + esc(new Date(at * 1000).toISOString().slice(0, 10))) : ""}</div>
      <div class="mono muted">operator ${esc(a.operator)}${role === "operator" ? " <b>(you)</b>" : ""} · inspections ${a.inspections}${a.issued_at_inspection ? " · issued at #" + a.issued_at_inspection : ""}${a.issued_at ? " · issued " + esc(String(a.issued_at).slice(0, 10)) + (a.expired ? " · <b>expired</b>" : " · valid " + a.valid_days + " days") : ""}</div>
      <div class="mono">claims: ${(a.claims || []).map(esc).join(", ")}</div>
      <div class="stakeline mono"><b>stake ${esc(gen(stake))}</b> · ${(a.claims || []).length} × 0.5 GEN needed${big(a.slashed) > 0n ? ` · <span class="warn">slashed ${esc(gen(a.slashed))} all time</span>` : ""}${a.in_force ? ` · a challenge: bond ${esc(gen(a.challenge_bond))}, fee ${esc(gen(a.challenge_fee))}, a catch pays ${esc(gen(stake / 2n))}` : ""}</div>
      ${a.retired ? `<div class="mono muted">retired ${esc(String(a.retired_at).slice(0, 16).replace("T", " "))} UTC · ${a.hold_over ? "the hold is over" + (stake > 0n ? ": the stake waits for Unstake" : ": the stake is back with its operator") : "in force and challengeable for " + countdown(a.hold_ends, "no longer: the hold is over")}</div>` : ""}
      ${a.suspended ? `<div class="mono warn">suspended since ${esc(String(a.silent_since).slice(0, 16).replace("T", " "))} UTC: the endpoint did not answer a challenge</div>` : ""}
      ${a.inspections ? `<div class="mono muted">last inspected by ${esc(a.last_inspector)}</div>` : ""}
      ${verdictBlock(a.verdicts, a.reasons) || '<p class="fine">not inspected yet</p>'}
      ${a.challenges ? `<details class="chs" data-chs="${esc(a.agent)}" data-count="${a.challenges}"><summary>challenges (${a.challenges}) · the money each one moved</summary><div class="chbody fine">loading …</div></details>`
        : '<p class="fine">never challenged</p>'}
      ${copyState ? `<details class="whatnow"><summary>where things stand${role === "operator" ? " (you are its operator)" : ""}</summary>${linesHtml(waitLines(copyState, ctx, role))}</details>` : ""}
      ${acts.length ? `<div class="suggest">${acts.join("")}</div>` : ""}
      <div class="mono muted explorer">${txsOf(a.agent, a.operator).length ? "on the explorer: " + txsOf(a.agent, a.operator).map((t) => link("/tx/" + t.tx, t.what + " ↗")).join(" · ")
                                                        : "on the explorer: " + link("/address/" + reg, "this register's transactions ↗")}</div></div>`;
}
/* Challenges of one agent, a page of ten at a time, newest page first, with the money each moved. */
async function loadChallenges(box, offset) {
  const id = box.dataset.chs, count = Number(box.dataset.count) || 0, body = box.querySelector(".chbody");
  if (offset === undefined) offset = Math.max(0, count - CHALLENGES_PAGE);
  body.textContent = "loading …";
  const page = await viewJson("challenges_of", [id, offset, CHALLENGES_PAGE]);
  if (!page || page.error) { body.innerHTML = warn(page?.error || "could not read the challenges just now; close and open again"); return; }
  const rows = (page.rows || []).slice().reverse();
  body.innerHTML = `<div class="scroll"><table class="who"><thead><tr><th>#</th><th>when (UTC)</th><th>by</th><th>outcome</th><th>slashed</th><th>to the challenger</th><th>kept</th><th>to the operator</th></tr></thead><tbody>`
    + rows.map((r) => `<tr><td class="mono">${esc(r.n)}</td><td class="mono">${esc(String(r.at).slice(0, 16).replace("T", " "))}</td><td class="mono">${same(r.by, account) ? "you" : esc(short(r.by))}</td>`
      + `<td><span class="v ${r.outcome === "revoked" ? "contradicts" : r.outcome === "held" ? "matches" : "inconclusive"}">${esc(r.outcome)}</span></td>`
      + `<td class="mono">${esc(gen(r.slashed))}</td><td class="mono">${esc(gen(r.to_challenger))}</td><td class="mono">${esc(gen(r.kept))}</td><td class="mono">${esc(gen(r.to_operator))}</td></tr>`).join("")
    + `</tbody></table></div>`
    + (page.count > CHALLENGES_PAGE ? `<div class="row pager"><button data-off="${Math.max(0, offset - CHALLENGES_PAGE)}" ${offset === 0 ? "disabled" : ""}>older</button><span class="fine">${offset + 1}–${offset + (page.rows || []).length} of ${page.count}</span><button data-off="${offset + CHALLENGES_PAGE}" ${offset + CHALLENGES_PAGE >= page.count ? "disabled" : ""}>newer</button></div>` : "");
  for (const b of body.querySelectorAll("[data-off]")) b.onclick = () => loadChallenges(box, Number(b.dataset.off));
}
let agentsPage = 0, agentsCount = 0;
/* Paint passports from a list of rows (newest first), live or from the snapshot. */
function paintAgents(items, ids, note) {
  const host = $("agents");
  knownIds = new Set(ids);
  if (lastPreset && knownIds.has($("aid").value.trim())) { $("aid").value = freshId(lastPreset); $("regAgentSt").textContent = `${$("aid").value}: the id was taken on this register, so it was changed`; }
  const firstClaim = {};
  for (const a of items) firstClaim[a.agent] = (a.claims || [])[0];
  const pages = Math.max(1, Math.ceil(agentsCount / AGENTS_PAGE));
  const pager = agentsCount > AGENTS_PAGE ? `<div class="row pager"><button data-page="${agentsPage - 1}" ${agentsPage === 0 ? "disabled" : ""}>newer</button><span class="fine">page ${agentsPage + 1} of ${pages} · ${agentsCount} agents, newest first</span><button data-page="${agentsPage + 1}" ${agentsPage + 1 >= pages ? "disabled" : ""}>older</button></div>` : "";
  host.innerHTML = (note ? `<p class="fine" style="margin:0 0 14px">${note}</p>` : "") + (items.length ? items.map(agentCard).join("") : '<p class="muted">no agents registered yet</p>') + pager;
  for (const n of host.querySelectorAll(".name[data-pick]")) n.onclick = () => { pick(n.dataset.pick, firstClaim[n.dataset.pick]); $("iid").scrollIntoView({ behavior: "smooth", block: "center" }); };
  for (const b of host.querySelectorAll("[data-act]")) b.onclick = () => { pick(b.dataset.id, firstClaim[b.dataset.id]); goTo("inspect-sec"); };
  for (const d of host.querySelectorAll("details.chs")) d.addEventListener("toggle", () => { if (d.open && !d.dataset.loaded) { d.dataset.loaded = "1"; loadChallenges(d); } });
  for (const b of host.querySelectorAll("[data-page]")) b.onclick = async () => { agentsPage = Math.max(0, Number(b.dataset.page)); await renderAgents(); goTo("passports"); };
  offerAgents(ids, firstClaim);
}
function paintStats(s) {
  const host = $("stats"); if (!host) return;
  if (!s || s.error) { host.innerHTML = ""; return; }
  const tile = (k, v, sub) => `<div class="tile"><span class="k">${esc(k)}</span><b>${esc(v)}</b>${sub ? `<span class="sub">${esc(sub)}</span>` : ""}</div>`;
  host.innerHTML = tile("agents", String(s.agents)) + tile("staked now", gen(s.staked)) + tile("challenges", String(s.challenges), `${s.revoked} revoked · ${s.held} held · ${s.inconclusive} inconclusive · ${s.unanswered} silent`)
    + tile("paid to challengers", gen(s.to_challengers)) + tile("kept by the register", gen(s.kept), "half of every slash, paid to nobody")
    + tile("paid to operators", gen(s.to_operators), "bonds and fees") + tile("challenge credit held", gen(s.credit)) + tile("stake handed back", gen(s.stake_returned));
}
async function renderAgents() {
  if (!reg) return;
  await loadChainTxs();
  const s = await viewJson("stats");
  if (!s || s.error) {
    if (DEMO_REGISTER && same(reg, DEMO_REGISTER) && await showSnapshot("live reads of the version 2 register are failing right now")) return;
    $("agents").innerHTML = '<p class="warn">could not reach the network to read this register; press Load again</p>'; return;
  }
  paintStats(s);
  agentsCount = Number(s.agents) || 0;
  const end = Math.max(0, agentsCount - agentsPage * AGENTS_PAGE), start = Math.max(0, end - AGENTS_PAGE);
  let ids = [];
  if (end > start) {
    const list = await viewJson("agents_list", [start, end - start]);
    if (!list || list.error) { $("agents").innerHTML = '<p class="warn">could not read the list of agents just now; press Load again</p>'; return; }
    ids = (list.rows || []).slice().reverse();
  }
  const items = [];
  for (const id of ids) { const p = await viewJson("passport", [id]); if (p && !p.error) items.push(p); }
  paintAgents(items, ids, "");
}
/* The snapshot: data/snapshot.json, taken by tools/snapshot.mjs, shown only for the site's register and only
   when Studio refuses to read it, labelled with its date. */
async function showSnapshot(why_) {
  try {
    const s = await (await fetch("./data/snapshot.json?t=" + Date.now())).json();
    if (!s || !DEMO_REGISTER || !same(s.register, DEMO_REGISTER)) return false;
    const taken = String(s.taken).slice(0, 16).replace("T", " ") + " UTC";
    $("addr").value = s.register;
    $("regSt").innerHTML = warn(why_ + ". Showing a snapshot of the register taken " + taken + "; the explorer still has it live: ") + link("/address/" + s.register, s.register) + warn(". Press Load again in a minute.");
    if ($("regLink")) { $("regLink").href = EXPLORER + "/address/" + s.register; $("regLink").target = "_blank"; $("regLink").rel = "noopener"; }
    $("rules").textContent = JSON.stringify(s.rules, null, 2);
    $("battery").textContent = (s.battery || []).map((p) => `[${p.id}] ${p.claim} · ${p.kind}\n  ${p.prompt}${p.criteria ? "\n  judged by: " + p.criteria : ""}`).join("\n\n");
    const ids = s.order || [];
    agentsCount = 0;
    paintAgents(ids.slice().reverse().map((id) => s.agents[id]).filter(Boolean), ids, `<b>snapshot</b> taken ${esc(taken)}, shown because live reads are failing; every row below is also on the explorer`);
    return true;
  } catch (e) { return false; }
}
/* A new account in the wallet: whose credit, whose cooldown, whose agents. */
function afterAccount() {
  if (!reg) return;
  paintTarget($("iid").value); paintDemo();
  renderAgents();
}

for (const li of document.querySelectorAll("#steps li")) li.onclick = () => goTo(li.dataset.go);
paint(); paintDemo(); paintTarget("");
const saved = (() => { try { return localStorage.getItem(REMEMBER_KEY); } catch (e) { return null; } })();
if ($("useDemoReg") && DEMO_REGISTER) { $("useDemoReg").hidden = false; if ($("useDemoLead")) $("useDemoLead").hidden = false; $("useDemoReg").onclick = () => useRegister(DEMO_REGISTER); }
/* A register you pasted or deployed yourself wins, unless it cannot be read on this network or is not a
   version 2 register; then the site's register is loaded and the memory is corrected. */
const first = saved || DEMO_REGISTER;
if (first) {
  log("loading " + first + (saved ? "" : " (the version 2 register)") + " …");
  useRegister(first).then((ok) => {
    if (ok || !saved || !DEMO_REGISTER || same(saved, DEMO_REGISTER)) return;
    log("the remembered register did not load as a version 2 register on Studio; loading the site's register instead", "warn");
    try { localStorage.removeItem(REMEMBER_KEY); } catch (e) {}
    useRegister(DEMO_REGISTER);
  });
} else {
  $("regSt").innerHTML = "<b>The version 2 register is not deployed yet.</b> Deploy your own from your wallet (one signature, about a minute), or paste the address of a version 2 register.";
  log("the version 2 register is not deployed yet: deploy one in section 05, or paste one");
}
