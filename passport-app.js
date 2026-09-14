import { createClient } from "https://esm.sh/genlayer-js@2.0.0-rc.1";
import { studioDevnet } from "https://esm.sh/genlayer-js@2.0.0-rc.1/chains";

/* Studio Next: consensus v0.6, chain 61997, every write carries a quoted fee. The SDK's
   studioDevnet definition is the same chain; only the RPC host differs. */
const $ = (id) => document.getElementById(id);
const RPC = "https://studio-next.genlayer.com/api";
const EXPLORER = "https://explorer-studio-dev.genlayer.com";
const NETWORK = { ...studioDevnet, rpcUrls: { default: { http: [RPC] } } };
const CHAIN = { chainId: "0xf22d", chainName: "GenLayer Studio Next", nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 }, rpcUrls: [RPC], blockExplorerUrls: [EXPLORER + "/"] };
const CLAIMS = ["family:gpt", "family:claude", "family:gemini", "family:llama", "family:mistral", "family:other",
                "can:code", "can:translate", "can:summarize", "can:math", "safe:injection"];
// The register deployed from the author's wallet on Studio Next on 14 September 2026 (see the README's evidence table).
// Empty would mean "none yet".
const DEMO_REGISTER = "0xeecB3c18F54Fb1D453Fa428e6Cd87F40Bbf3b3f8";
const REMEMBER_KEY = "passport_register2";   // a new key: older browsers remembered whichever demo register they last loaded
// The six demo agents are served by this same site (api/agent.js on Vercel, tools/serve-agents.mjs locally).
const DEMO_BASE = location.origin + "/api/agent";
const DEMO = {
  honest:      { claims: ["family:gpt", "can:math", "can:code", "safe:injection"] },
  liar:        { claims: ["family:gpt", "can:math", "can:code", "safe:injection"] },
  coy:         { claims: ["family:gpt", "can:math", "can:code", "safe:injection"] },
  polyglot:    { claims: ["family:gemini", "can:translate", "safe:injection"] },
  hijacker:    { claims: ["family:gpt", "can:math", "can:code", "safe:injection"] },
  embellisher: { claims: ["family:claude", "can:math", "can:summarize"] },
};

const rpc = async (m, p) => {
  for (let i = 0; i < 6; i++) {
    try { const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: m, params: p }) }); return (await r.json()).result; }
    catch (e) { await new Promise((x) => setTimeout(x, 1500)); }
  }
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const link = (path, text) => `<a href="${EXPLORER}${path}" target="_blank" rel="noopener">${esc(text)}</a>`;
const warn = (t) => `<span class="warn">${esc(t)}</span>`;
const log = (m, cls) => { const e = $("log"); e.innerHTML += "\n" + (cls ? `<span class="${cls}">${m}</span>` : m); for (const box of [e, e.parentElement]) if (box) box.scrollTop = box.scrollHeight; };
const goTo = (id) => { const el = $(id); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); };

/* ---------------------------------------------------------------- wallet */
const provs = [];
addEventListener("eip6963:announceProvider", (e) => { if (!provs.some((p) => p.info.rdns === e.detail.info.rdns)) provs.push(e.detail); });
dispatchEvent(new Event("eip6963:requestProvider"));
let provider = null, account = null, reg = null;
const progress = { registered: false, inspected: false };
async function ensureNet(p) {
  try { await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN.chainId }] }); }
  catch (e) { if (e && (e.code === 4902 || String(e.message || "").includes("Unrecognized"))) await p.request({ method: "wallet_addEthereumChain", params: [CHAIN] }); else throw e; }
}
async function client() { await ensureNet(provider); const a = await provider.request({ method: "eth_accounts" }); account = a[0]; return createClient({ chain: NETWORK, account }); }
const reader = () => createClient({ chain: NETWORK });
/* Every write on Studio Next carries a fee quote. The SDK simulates the call first and
   quotes what it saw; a call the contract refuses cannot be simulated, so the default
   quote is used and the refusal lands on chain with its reason. Unused fee is refunded. */
async function feesFor(c, fn, args, target) {
  if (target) target.textContent = "quoting the fee: the validators' work is simulated first …";
  try { const e = await c.estimateTransactionFeesForWrite({ address: reg, functionName: fn, args }); return { distribution: e.distribution, messageAllocations: e.messageAllocations, feeValue: e.feeValue }; }
  catch (e) { const d = await c.estimateTransactionFees({}); return { distribution: d.distribution, feeValue: d.feeValue }; }
}
function said(msg) { log(esc(msg), "warn"); if ($("railHint")) $("railHint").innerHTML = warn(msg); }
async function connect() {
  provider = (provs[0] || {}).provider || window.ethereum;
  if (!provider) { said("no wallet found in this browser: install Rabby or MetaMask, then reload"); return false; }
  try { await ensureNet(provider); const a = await provider.request({ method: "eth_requestAccounts" }); account = a[0]; paint(); log("connected " + esc(account)); return true; }
  catch (e) { said(e.code === 4001 ? "connection refused in the wallet" : "could not connect: " + (e.message || e)); return false; }
}
$("connect").onclick = connect;
$("faucet").onclick = async () => {
  if (!account && !(await connect())) return;
  const r = await rpc("sim_fundAccount", { account_address: account, amount: 300e18 });
  if (r === undefined) said("could not fund: Studio did not answer the faucet call; try again in a minute"); else log("funded 300 test GEN");
};

/* The order of things, shown at the top of the page: what is done, what is next. */
const HINTS = {
  1: "Press Connect wallet, top right: Rabby or any EIP-6963 wallet. The wallet is asked to add GenLayer Studio Next (chain 61997). Then Get test GEN, it is free.",
  2: DEMO_REGISTER ? "Press \"load the demo register\" in section 03, or paste any Passport register, or deploy your own."
                   : "Paste a Passport register in section 03, or deploy your own from there (one signature).",
  3: "In section 04 press one of the six \"try\" chips, then Register. One signature; the agent is on the record, unverified.",
  4: "In section 05 press Inspect on your agent. Every validator sends the battery to the agent itself; about a minute.",
  5: "Your passport is in section 06, one word per claim with the validators' reasons. Ask the gate in section 05: is_valid(agent, claim), free.",
};
/* A guide that follows the visitor: after every step it says where to go next, with a button
   that takes them there. Hiding it hides it for the current step only; the next step brings it back. */
const GUIDE = {
  1: ["Press Connect wallet at the top right. Rabby or any wallet; it is asked to add GenLayer Studio Next, then press Get test GEN.", "top"],
  2: ["Go to section 03 and press Load the demo register. One click, no signature.", "register-sec"],
  3: ["Go to section 04, press one of the try chips, then Register. One signature.", "agent-sec"],
  4: ["Go to section 05 and press Inspect. The validators send the battery to your agent; about a minute.", "inspect-sec"],
  5: ["Your passport is in section 06, one word per claim. Then ask the gate in section 05: is_valid(agent, claim), free.", "passports"],
};
let guideStep = 0;
function paintGuide(step) {
  const g = $("guide"); if (!g || !GUIDE[step]) return;
  const [text, go] = GUIDE[step];
  $("guideStep").textContent = "Step " + step + " of 5";
  $("guideText").textContent = text;
  $("guideGo").onclick = () => { if (go === "top") window.scrollTo({ top: 0, behavior: "smooth" }); else goTo(go); };
  let hiddenFor = null; try { hiddenFor = sessionStorage.getItem("passport_guide_hidden"); } catch (e) {}
  g.hidden = String(step) === hiddenFor;
  guideStep = step;
}
if ($("guideHide")) $("guideHide").onclick = () => { $("guide").hidden = true; try { sessionStorage.setItem("passport_guide_hidden", String(guideStep)); } catch (e) {} };
function paint() {
  const on = !!account;
  $("who").textContent = account ? account.slice(0, 6) + "…" + account.slice(-4) : "";
  $("who").title = account || "";
  $("connect").textContent = on ? "Change wallet" : "Connect wallet";
  const step = !on ? 1 : !reg ? 2 : !progress.registered ? 3 : !progress.inspected ? 4 : 5;
  for (const li of document.querySelectorAll("#steps li")) {
    const n = Number(li.dataset.step);
    li.classList.toggle("done", n < step); li.classList.toggle("now", n === step);
  }
  if ($("railHint")) $("railHint").textContent = HINTS[step];
  paintGuide(step);
  if ($("introStep2") && !DEMO_REGISTER) $("introStep2").textContent = "Paste a Passport register in section 03, or deploy your own from there. One signature.";
}
/* Every signing button asks for what it needs instead of sitting disabled:
   no wallet, connect one; no register, load the demo one when there is one. */
async function ready(st) {
  if (!account) { st.textContent = "connect a wallet first (the wallet window opens now)"; if (!(await connect())) { st.innerHTML = warn("connect a wallet, top right, to sign this"); return false; } }
  if (!reg) {
    if (DEMO_REGISTER) { st.textContent = "loading the demo register first"; if (!(await useRegister(DEMO_REGISTER))) return false; }
    else { st.innerHTML = warn("load a register first: section 03, paste an address or deploy one"); goTo("register-sec"); return false; }
  }
  st.textContent = ""; return true;
}

/* ---------------------------------------------------------------- claims */
$("claims").innerHTML = CLAIMS.map((c) => `<label><input type="checkbox" value="${c}">${c}</label>`).join("");
const chosenClaims = () => [...$("claims").querySelectorAll("input:checked")].map((i) => i.value);
const setClaims = (list) => { for (const i of $("claims").querySelectorAll("input")) i.checked = list.includes(i.value); };
if ($("claimIds")) $("claimIds").innerHTML = CLAIMS.map((c) => `<option value="${c}">`).join("");
if ($("demoBase")) $("demoBase").textContent = DEMO_BASE + "?persona=honest";

/* ----------------------------------------------------------- suggestions */
let knownIds = new Set();   // ids on the loaded register, so a suggestion is never one that is taken
let lastPreset = "";        // the chip that filled the id box, so it can be refreshed when the register loads
const three = () => String(100 + Math.floor(Math.random() * 900));
function freshId(base) {
  if (!knownIds.has(base)) return base;
  let id; do { id = base + three(); } while (knownIds.has(id) || id === $("aid").value.trim());
  return id;
}
for (const chip of document.querySelectorAll("[data-preset]")) chip.onclick = () => {
  const name = chip.dataset.preset, d = DEMO[name]; if (!d) return;
  lastPreset = name; $("aid").value = freshId(name); $("endpoint").value = DEMO_BASE + "?persona=" + name; setClaims(d.claims);
  $("regAgentSt").textContent = `filled in the ${name} demo agent. Press Register, then Inspect it in section 05`
    + (DEMO_BASE.startsWith("https://") ? "" : " (the contract accepts https endpoints only; on the deployed site this address is https)");
  if (!chip.closest("#agent-sec")) { goTo("agent-sec"); }
};
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
  $("inspectSt").textContent = `${id} is in the boxes below. Inspect if you are its operator; Challenge if it holds an issued passport and you are not`;
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
/* Studio's RPC sometimes answers a read with "Contract not found" for an address the
   explorer shows perfectly well, for a minute at a time. Reads therefore retry with a
   growing pause, eight tries and about forty seconds in all, before giving up. */
async function readOrRetry(fn, args = [], tries = 8, address = reg) {
  let last;
  if (!address) return { ok: false, error: new Error("no register loaded") };
  for (let i = 0; i < tries; i++) {
    try { return { ok: true, value: await reader().readContract({ address, functionName: fn, args }) }; }
    catch (e) { last = e; await new Promise((r) => setTimeout(r, Math.min(8000, 500 + 350 * (i + 1) * (i + 1)))); }
  }
  return { ok: false, error: last };
}
async function useRegister(address, remember = false) {
  $("regSt").textContent = "reading " + address + " …";
  const probe = await readOrRetry("rules", [], 8, address);
  if (!probe.ok) {
    if (address.toLowerCase() === DEMO_REGISTER.toLowerCase() && await showSnapshot("Studio did not answer reads for the demo register after eight tries over forty seconds")) return false;
    $("regSt").innerHTML = warn(address + " did not answer rules() after eight tries over forty seconds: not a Passport register, or Studio is refusing reads right now. The explorer still shows it, so press Load again in a minute."); return false;
  }
  reg = address;
  /* Only a register you pasted or deployed yourself is remembered. The demo register is never
     remembered, so a browser follows it when it changes. */
  try { if (remember) localStorage.setItem(REMEMBER_KEY, address); else if (DEMO_REGISTER && address.toLowerCase() === DEMO_REGISTER.toLowerCase()) localStorage.removeItem(REMEMBER_KEY); } catch (e) {}
  $("addr").value = address;
  $("regSt").innerHTML = "This register on the explorer: " + link("/address/" + address, address);
  if ($("regLink")) { $("regLink").href = EXPLORER + "/address/" + address; $("regLink").target = "_blank"; $("regLink").rel = "noopener"; }
  $("rules").textContent = JSON.stringify(JSON.parse(String(probe.value)), null, 2);
  const bat = await readOrRetry("battery");
  if (bat.ok) $("battery").textContent = JSON.parse(String(bat.value)).map((p) => `[${p.id}] ${p.claim} · ${p.kind}\n  ${p.prompt}${p.criteria ? "\n  judged by: " + p.criteria : ""}`).join("\n\n");
  paint(); await renderAgents(); return true;
}
$("load").onclick = () => { const a = $("addr").value.trim(); if (/^0x[0-9a-fA-F]{40}$/.test(a)) useRegister(a, true); else $("regSt").innerHTML = warn("that is not an address"); };

async function wait(tx, label, target) {
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const t = await rpc("eth_getTransactionByHash", [tx]);
    if (t?.status === "CANCELED" || t?.status === "UNDETERMINED") { log("  ✗ " + label + " ended " + String(t.status).toLowerCase() + " on the network", "warn"); return null; }
    if (t?.status === "ACCEPTED" || t?.status === "FINALIZED") {
      const lr = t.consensus_data?.leader_receipt, one = Array.isArray(lr) ? lr[0] : lr;
      let msg = ""; try { msg = new TextDecoder().decode(Uint8Array.from(atob(one.result), (c) => c.charCodeAt(0))).replace(/[^\x20-\x7e]/g, " ").trim(); } catch (e) {}
      let a = 0, d = 0, idl = 0; for (const k in (t.consensus_data?.votes || {})) { const v = t.consensus_data.votes[k]; if (v === "agree") a++; else if (v === "disagree") d++; else idl++; }
      log(`  votes: ${a} agree, ${d} disagree, ${idl} idle`);
      if (a * 2 <= a + d + idl) { log("  ⚖ the validators did not agree, so nothing was stored", "warn"); return { split: true, msg }; }
      let j = null; const b = msg.indexOf("{"); if (b !== -1) { try { j = JSON.parse(msg.slice(b)); } catch (e) {} }
      return { split: false, msg, j, exec: one?.execution_result };
    }
    if (i % 3 === 2 && target) target.textContent = `… ${label} (${(i + 1) * 4}s)`;
  }
  log("  ✗ " + label + " timed out", "warn"); return null;
}
async function send(fn, args, label, target) {
  const c = await client();
  const fees = await feesFor(c, fn, args, target);
  log(`▶ ${label} … confirm in wallet (fee quoted: ${(Number(fees.feeValue) / 1e18).toFixed(4)} GEN, the unused part comes back)`);
  let tx;
  try { tx = await c.writeContract({ address: reg, functionName: fn, args, fees }); }
  catch (e) { log("  ✗ " + esc(label + ": " + (e.code === 4001 ? "refused in the wallet" : (e.message || e))), "warn"); throw e; }
  log("  tx " + tx + " · " + link("/tx/" + tx, "explorer"));
  return await wait(tx, label, target);
}

$("deploy").onclick = async () => {
  if (!account && !(await connect())) { $("regSt").innerHTML = warn("connect a wallet, top right, to deploy"); return; }
  $("deploy").disabled = true;
  try {
    const got = await fetch("./contracts/passport.py?t=" + Date.now());
    if (!got.ok) throw new Error("could not read contracts/passport.py from this host");
    const src = await got.text();
    const c = await client();
    const d = await c.estimateTransactionFees({});
    log("▶ deploying a register … confirm in wallet");
    const h = await c.deployContract({ code: src, args: [], fees: { distribution: d.distribution, feeValue: d.feeValue } });
    log("  tx " + h + " · " + link("/tx/" + h, "explorer"));
    const r = await c.waitForTransactionReceipt({ hash: h, waitUntil: "decided", retries: 60, interval: 4000, fullTransaction: true }).catch(() => null);
    const A = r?.data?.contract_address; if (!A) throw new Error("the deploy produced no address");
    log("  ✓ deployed at " + A); await useRegister(A, true);
  } catch (e) { log("  ✗ " + esc(e.message || e), "warn"); }
  $("deploy").disabled = false;
};

$("register").onclick = async () => {
  if (!(await ready($("regAgentSt")))) return;
  const id = $("aid").value.trim(), ep = $("endpoint").value.trim(), claims = chosenClaims();
  if (!id || !ep || !claims.length) { $("regAgentSt").innerHTML = warn("an id, an https endpoint and at least one claim; the try chips above fill all three"); return; }
  const r = await send("register", [id, ep, JSON.stringify(claims)], "registering " + id, $("regAgentSt")).catch((e) => ({ msg: e.message }));
  if (r?.j?.ok) { progress.registered = true; $("regAgentSt").textContent = `registered ${id}: ${r.j.status}. Now Inspect it in section 05`; pick(id, claims[0]); }
  else $("regAgentSt").textContent = (r?.msg || "failed").slice(0, 200);
  paint(); await renderAgents();
};
$("update").onclick = async () => {
  if (!(await ready($("regAgentSt")))) return;
  const id = $("aid").value.trim(), ep = $("endpoint").value.trim(), claims = chosenClaims();
  const r = await send("update", [id, ep, JSON.stringify(claims)], "updating " + id, $("regAgentSt")).catch((e) => ({ msg: e.message }));
  $("regAgentSt").textContent = r?.j?.ok ? `updated ${id}: ${r.j.status}. Ask for a new inspection` : (r?.msg || "failed").slice(0, 200);
  await renderAgents();
};
$("withdraw").onclick = async () => {
  if (!(await ready($("regAgentSt")))) return;
  const id = $("aid").value.trim();
  const r = await send("withdraw", [id], "withdrawing " + id, $("regAgentSt")).catch((e) => ({ msg: e.message }));
  $("regAgentSt").textContent = r?.j?.ok ? `withdrew ${id}` : (r?.msg || "failed").slice(0, 200);
  await renderAgents();
};
$("inspect").onclick = async () => {
  if (!(await ready($("inspectSt")))) return;
  const id = $("iid").value.trim(); if (!id) { $("inspectSt").innerHTML = warn("pick an agent above first"); return; }
  $("inspect").disabled = true;
  const r = await send("inspect", [id], "inspecting " + id, $("inspectSt")).catch((e) => ({ msg: e.message }));
  if (r?.j?.ok) { progress.inspected = true; $("inspectSt").textContent = `${id}: ${r.j.status}. The passport is in section 06`; log("  " + JSON.stringify(r.j.verdicts)); }
  else $("inspectSt").textContent = r?.split ? "no consensus, so nothing was stored; press again" : (r?.msg || "failed").slice(0, 160);
  $("inspect").disabled = false;
  paint(); await renderAgents();
};
$("challenge").onclick = async () => {
  if (!(await ready($("inspectSt")))) return;
  const id = $("iid").value.trim(); if (!id) { $("inspectSt").innerHTML = warn("pick an agent above first"); return; }
  $("challenge").disabled = true;
  const r = await send("challenge", [id], "challenging " + id, $("inspectSt")).catch((e) => ({ msg: e.message }));
  if (r?.j?.ok) { $("inspectSt").textContent = `${id}: the passport ${r.j.outcome === "stands" ? "stands" : "was refused"} (${r.j.status})`; log("  " + JSON.stringify(r.j.verdicts)); }
  else $("inspectSt").textContent = r?.split ? "no consensus, so nothing was stored; press again" : (r?.msg || "failed").slice(0, 160);
  $("challenge").disabled = false;
  await renderAgents();
};
$("gate").onclick = async () => {
  if (!reg) { $("gateSt").textContent = "load a register first (section 03)"; return; }
  const a = $("gAgent").value.trim(), c = $("gClaim").value.trim();
  const r = await readOrRetry("is_valid", [a, c]);
  $("gateSt").textContent = r.ok ? `is_valid(${a}, ${c}) → ${r.value}` : "could not read just now";
};

/* ---------------------------------------------------------------- agents */
function agentCard(a) {
  const rows = Object.entries(a.verdicts || {}).map(([c, v]) => `<div class="v ${esc(v)}">${esc(c)} → ${esc(v)}</div><div class="reason">${esc((a.reasons || {})[c] || "")}</div>`).join("");
  return `<div class="agent"><div class="head"><span class="name" data-pick="${esc(a.agent)}" title="put this agent in the inspect and gate boxes">${esc(a.agent)}</span><span class="badge ${esc(a.status)}">${esc(a.status)}</span></div>
      <div class="mono muted">${esc(a.endpoint)}</div>
      <div class="mono muted">operator ${esc(a.operator)} · inspections ${a.inspections}${a.issued_at_inspection ? " · issued at #" + a.issued_at_inspection : ""}${a.issued_at ? " · issued " + esc(String(a.issued_at).slice(0, 10)) + (a.expired ? " · <b>expired</b>" : " · valid " + a.valid_days + " days") : ""}</div>
      <div class="mono">claims: ${(a.claims || []).map(esc).join(", ")}</div>
      ${a.inspections ? `<div class="mono muted">last inspected by ${esc(a.last_inspector)}</div>` : ""}
      ${a.challenges ? `<div class="mono muted">challenged ${a.challenges}× · last by ${esc(a.last_challenge?.by || "")} on ${esc(String(a.last_challenge?.at || "").slice(0, 10))} → <b>${esc(a.last_challenge?.outcome || "")}</b></div>` : ""}
      ${rows ? `<div class="verdicts">${rows}</div>` : '<p class="fine">not inspected yet</p>'}</div>`;
}
/* Paint passports from a list of rows (newest first), live or from the snapshot. */
function paintAgents(items, ids, note) {
  const host = $("agents");
  knownIds = new Set(ids);
  if (lastPreset && knownIds.has($("aid").value.trim())) { $("aid").value = freshId(lastPreset); $("regAgentSt").textContent = `${$("aid").value}: the id was taken on this register, so it was changed`; }
  const firstClaim = {};
  for (const a of items) firstClaim[a.agent] = (a.claims || [])[0];
  host.innerHTML = (note ? `<p class="fine" style="margin:0 0 14px">${note}</p>` : "") + (items.length ? items.map(agentCard).join("") : '<p class="muted">no agents registered yet</p>');
  for (const n of host.querySelectorAll(".name[data-pick]")) n.onclick = () => { pick(n.dataset.pick, firstClaim[n.dataset.pick]); $("iid").scrollIntoView({ behavior: "smooth", block: "center" }); };
  offerAgents(ids, firstClaim);
}
async function renderAgents() {
  if (!reg) return;
  const list = await readOrRetry("agents_list");
  if (!list.ok) {
    if (reg.toLowerCase() === DEMO_REGISTER.toLowerCase() && await showSnapshot("live reads of the demo register are failing right now")) return;
    $("agents").innerHTML = '<p class="warn">could not reach the network to read this register; press Load again</p>'; return;
  }
  const ids = JSON.parse(String(list.value));
  const items = [];
  for (const id of ids.slice().reverse()) { const p = await readOrRetry("passport", [id]); if (p.ok) items.push(JSON.parse(String(p.value))); }
  paintAgents(items, ids, "");
}
/* The snapshot: data/snapshot.json, taken by tools/snapshot.mjs, shown only for the
   demo register and only when Studio refuses to read it, labelled with its date. */
async function showSnapshot(why) {
  try {
    const s = await (await fetch("./data/snapshot.json?t=" + Date.now())).json();
    if (!s || String(s.register).toLowerCase() !== DEMO_REGISTER.toLowerCase()) return false;
    const taken = String(s.taken).slice(0, 16).replace("T", " ") + " UTC";
    $("addr").value = s.register;
    $("regSt").innerHTML = warn(why + ". Showing a snapshot of the register taken " + taken + "; the explorer still has it live: ") + link("/address/" + s.register, s.register) + warn(". Press Load again in a minute.");
    if ($("regLink")) { $("regLink").href = EXPLORER + "/address/" + s.register; $("regLink").target = "_blank"; $("regLink").rel = "noopener"; }
    $("rules").textContent = JSON.stringify(s.rules, null, 2);
    $("battery").textContent = (s.battery || []).map((p) => `[${p.id}] ${p.claim} · ${p.kind}\n  ${p.prompt}${p.criteria ? "\n  judged by: " + p.criteria : ""}`).join("\n\n");
    const ids = s.order || [];
    paintAgents(ids.slice().reverse().map((id) => s.agents[id]).filter(Boolean), ids, `<b>snapshot</b> taken ${esc(taken)}, shown because live reads are failing; every row below is also on the explorer`);
    return true;
  } catch (e) { return false; }
}

for (const li of document.querySelectorAll("#steps li")) li.onclick = () => goTo(li.dataset.go);
paint();
const saved = (() => { try { return localStorage.getItem(REMEMBER_KEY); } catch (e) { return null; } })();
if ($("useDemoReg") && DEMO_REGISTER) { $("useDemoReg").hidden = false; if ($("useDemoLead")) $("useDemoLead").hidden = false; $("useDemoReg").onclick = () => useRegister(DEMO_REGISTER); }
/* A register you pasted or deployed yourself wins, unless it cannot be read on this network
   (the hackathon moved from Studio to Studio Next, and a browser may still remember a Studio
   address); then the demo register is loaded and the memory is corrected. */
const first = saved || DEMO_REGISTER;
if (first) {
  log("loading " + first + (saved ? "" : " (the demo register)") + " …");
  useRegister(first).then((ok) => {
    if (ok || !saved || !DEMO_REGISTER || saved.toLowerCase() === DEMO_REGISTER.toLowerCase()) return;
    log("the remembered register did not answer on this network; loading the demo register instead", "warn");
    try { localStorage.removeItem(REMEMBER_KEY); } catch (e) {}
    useRegister(DEMO_REGISTER);
  });
}
