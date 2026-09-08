import { createClient } from "https://esm.sh/genlayer-js@1.1.8";
import { studionet } from "https://esm.sh/genlayer-js@1.1.8/chains";

const $ = (id) => document.getElementById(id);
const RPC = "https://studio.genlayer.com/api";
const EXPLORER = "https://explorer-studio.genlayer.com";
const CHAIN = { chainId: "0xf22f", chainName: "GenLayer Studio", nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 }, rpcUrls: [RPC], blockExplorerUrls: [EXPLORER + "/"] };
const CLAIMS = ["family:gpt", "family:claude", "family:gemini", "family:llama", "family:mistral", "family:other",
                "can:code", "can:translate", "can:summarize", "can:math", "safe:injection"];
// The register deployed from the author's wallet; filled in at deployment. Empty means "none yet".
const DEMO_REGISTER = "";
// The two demo agents are served by this same site (api/agent.js on Vercel, tools/serve-agents.mjs locally).
const DEMO_BASE = location.origin + "/api/agent";
const DEMO = {
  honest: { id: "honest", endpoint: DEMO_BASE + "?persona=honest", claims: ["family:gpt", "can:math", "can:code", "safe:injection"] },
  liar:   { id: "liar",   endpoint: DEMO_BASE + "?persona=liar",   claims: ["family:gpt", "can:math", "can:code", "safe:injection"] },
};

const rpc = async (m, p) => {
  for (let i = 0; i < 6; i++) {
    try { const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: m, params: p }) }); return (await r.json()).result; }
    catch (e) { await new Promise((x) => setTimeout(x, 1500)); }
  }
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const link = (path, text) => `<a href="${EXPLORER}${path}" target="_blank" rel="noopener">${esc(text)}</a>`;
const log = (m, cls) => { const e = $("log"); e.innerHTML += "\n" + (cls ? `<span class="${cls}">${m}</span>` : m); for (const box of [e, e.parentElement]) if (box) box.scrollTop = box.scrollHeight; };

/* ---------------------------------------------------------------- wallet */
const provs = [];
addEventListener("eip6963:announceProvider", (e) => { if (!provs.some((p) => p.info.rdns === e.detail.info.rdns)) provs.push(e.detail); });
dispatchEvent(new Event("eip6963:requestProvider"));
let provider = null, account = null, reg = null;
async function ensureNet(p) {
  try { await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN.chainId }] }); }
  catch (e) { if (e && (e.code === 4902 || String(e.message || "").includes("Unrecognized"))) await p.request({ method: "wallet_addEthereumChain", params: [CHAIN] }); else throw e; }
}
async function client() { await ensureNet(provider); const a = await provider.request({ method: "eth_accounts" }); account = a[0]; return createClient({ chain: studionet, account }); }
const reader = () => createClient({ chain: studionet });
function paint() {
  const on = !!account;
  $("who").textContent = account || "";
  $("connect").textContent = on ? "Change wallet" : "Connect wallet";
  $("faucet").disabled = !on; $("deploy").disabled = !on;
  for (const id of ["register", "update", "withdraw", "inspect", "challenge"]) $(id).disabled = !(on && reg);
}
$("connect").onclick = async () => {
  provider = (provs[0] || {}).provider || window.ethereum;
  if (!provider) { log("no wallet found in this browser", "warn"); return; }
  try { await ensureNet(provider); const a = await provider.request({ method: "eth_requestAccounts" }); account = a[0]; paint(); log("connected " + account); }
  catch (e) { log(e.code === 4001 ? "connection refused in the wallet" : "could not connect: " + (e.message || e), "warn"); }
};
$("faucet").onclick = async () => { await rpc("sim_fundAccount", { account_address: account, amount: 300e18 }); log("funded 300 test GEN"); };

/* ---------------------------------------------------------------- claims */
$("claims").innerHTML = CLAIMS.map((c) => `<label><input type="checkbox" value="${c}">${c}</label>`).join("");
const chosenClaims = () => [...$("claims").querySelectorAll("input:checked")].map((i) => i.value);
const setClaims = (list) => { for (const i of $("claims").querySelectorAll("input")) i.checked = list.includes(i.value); };
if ($("claimIds")) $("claimIds").innerHTML = CLAIMS.map((c) => `<option value="${c}">`).join("");
if ($("demoBase")) $("demoBase").textContent = DEMO_BASE + "?persona=honest|liar";

/* ----------------------------------------------------------- suggestions */
for (const chip of document.querySelectorAll("[data-preset]")) chip.onclick = () => {
  const d = DEMO[chip.dataset.preset]; if (!d) return;
  $("aid").value = d.id; $("endpoint").value = d.endpoint; setClaims(d.claims);
  $("regAgentSt").textContent = `filled in the ${chip.dataset.preset} demo agent — press Register`
    + (d.endpoint.startsWith("https://") ? "" : " (the contract accepts https endpoints only; on the deployed site this address is https)");
};
if ($("genId")) $("genId").onclick = () => {
  const words = ["atlas", "nova", "sable", "quill", "orbit", "lumen", "ferry", "cedar"];
  const tail = Math.random().toString(36).slice(2, 6);
  $("aid").value = words[Math.floor(Math.random() * words.length)] + "-" + tail;
};
function pick(id, claim) {
  $("iid").value = id; $("gAgent").value = id; if (claim) $("gClaim").value = claim;
  $("inspectSt").textContent = `${id} is in the boxes below — Inspect if you are its operator, Challenge otherwise`;
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
async function readOrRetry(fn, args = [], tries = 4, address = reg) {
  let last;
  if (!address) return { ok: false, error: new Error("no register loaded") };
  for (let i = 0; i < tries; i++) { try { return { ok: true, value: await reader().readContract({ address, functionName: fn, args }) }; } catch (e) { last = e; await new Promise((r) => setTimeout(r, 700 * (i + 1))); } }
  return { ok: false, error: last };
}
async function useRegister(address) {
  $("regSt").textContent = "reading " + address + " …";
  const probe = await readOrRetry("rules", [], 4, address);
  if (!probe.ok) { $("regSt").innerHTML = `<span class="warn">${esc(address)} did not answer rules() after four tries — not a Passport register, or the network is refusing reads right now.</span>`; return false; }
  reg = address; try { localStorage.setItem("passport_register", address); } catch (e) {}
  $("addr").value = address;
  $("regSt").innerHTML = "This register on the explorer: " + link("/address/" + address, address);
  if ($("regLink")) { $("regLink").href = EXPLORER + "/address/" + address; $("regLink").target = "_blank"; $("regLink").rel = "noopener"; }
  $("rules").textContent = JSON.stringify(JSON.parse(String(probe.value)), null, 2);
  const bat = await readOrRetry("battery");
  if (bat.ok) $("battery").textContent = JSON.parse(String(bat.value)).map((p) => `[${p.id}] ${p.claim} · ${p.kind}\n  ${p.prompt}${p.criteria ? "\n  judged by: " + p.criteria : ""}`).join("\n\n");
  paint(); await renderAgents(); return true;
}
$("load").onclick = () => { const a = $("addr").value.trim(); if (/^0x[0-9a-fA-F]{40}$/.test(a)) useRegister(a); else $("regSt").innerHTML = '<span class="warn">that is not an address</span>'; };

async function wait(tx, label, target) {
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const t = await rpc("eth_getTransactionByHash", [tx]);
    if (t?.status === "CANCELED") { log("  ✗ " + label + " was cancelled by the network", "warn"); return null; }
    if (t?.status === "FINALIZED") {
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
  log(`▶ ${label} … confirm in wallet`);
  const tx = await c.writeContract({ address: reg, functionName: fn, args });
  log("  tx " + tx + " · " + link("/tx/" + tx, "explorer"));
  return await wait(tx, label, target);
}

$("deploy").onclick = async () => {
  $("deploy").disabled = true;
  try {
    const got = await fetch("./contracts/passport.py?t=" + Date.now());
    if (!got.ok) throw new Error("could not read contracts/passport.py from this host");
    const src = await got.text();
    const c = await client();
    log("▶ deploying a register … confirm in wallet");
    const h = await c.deployContract({ code: src, args: [] });
    log("  tx " + h + " · " + link("/tx/" + h, "explorer"));
    const r = await c.waitForTransactionReceipt({ hash: h, status: "ACCEPTED", retries: 60, interval: 4000 }).catch(() => null);
    const A = r?.data?.contract_address; if (!A) throw new Error("the deploy produced no address");
    log("  ✓ deployed at " + A); await useRegister(A);
  } catch (e) { log("  ✗ " + (e.message || e), "warn"); }
  $("deploy").disabled = false;
};

$("register").onclick = async () => {
  const id = $("aid").value.trim(), ep = $("endpoint").value.trim(), claims = chosenClaims();
  if (!id || !ep || !claims.length) { $("regAgentSt").innerHTML = '<span class="warn">an id, an https endpoint and at least one claim</span>'; return; }
  const r = await send("register", [id, ep, JSON.stringify(claims)], "registering " + id, $("regAgentSt")).catch((e) => ({ msg: e.message }));
  $("regAgentSt").textContent = r?.j?.ok ? `registered ${id}: ${r.j.status}` : (r?.msg || "failed");
  await renderAgents();
};
$("update").onclick = async () => {
  const id = $("aid").value.trim(), ep = $("endpoint").value.trim(), claims = chosenClaims();
  const r = await send("update", [id, ep, JSON.stringify(claims)], "updating " + id, $("regAgentSt")).catch((e) => ({ msg: e.message }));
  $("regAgentSt").textContent = r?.j?.ok ? `updated ${id}: ${r.j.status} — ask for a new inspection` : (r?.msg || "failed");
  await renderAgents();
};
$("withdraw").onclick = async () => {
  const id = $("aid").value.trim();
  const r = await send("withdraw", [id], "withdrawing " + id, $("regAgentSt")).catch((e) => ({ msg: e.message }));
  $("regAgentSt").textContent = r?.j?.ok ? `withdrew ${id}` : (r?.msg || "failed");
  await renderAgents();
};
$("inspect").onclick = async () => {
  const id = $("iid").value.trim(); if (!id) return;
  $("inspect").disabled = true;
  const r = await send("inspect", [id], "inspecting " + id, $("inspectSt")).catch((e) => ({ msg: e.message }));
  if (r?.j?.ok) { $("inspectSt").textContent = `${id}: ${r.j.status}`; log("  " + JSON.stringify(r.j.verdicts)); }
  else $("inspectSt").textContent = r?.split ? "no consensus — nothing stored" : (r?.msg || "failed").slice(0, 160);
  $("inspect").disabled = false;
  await renderAgents();
};
$("challenge").onclick = async () => {
  const id = $("iid").value.trim(); if (!id) return;
  $("challenge").disabled = true;
  const r = await send("challenge", [id], "challenging " + id, $("inspectSt")).catch((e) => ({ msg: e.message }));
  if (r?.j?.ok) { $("inspectSt").textContent = `${id}: the passport ${r.j.outcome === "stands" ? "stands" : "was refused"} (${r.j.status})`; log("  " + JSON.stringify(r.j.verdicts)); }
  else $("inspectSt").textContent = r?.split ? "no consensus — nothing stored" : (r?.msg || "failed").slice(0, 160);
  $("challenge").disabled = false;
  await renderAgents();
};
$("gate").onclick = async () => {
  if (!reg) { $("gateSt").textContent = "load a register first"; return; }
  const a = $("gAgent").value.trim(), c = $("gClaim").value.trim();
  const r = await readOrRetry("is_valid", [a, c]);
  $("gateSt").textContent = r.ok ? `is_valid(${a}, ${c}) → ${r.value}` : "could not read just now";
};

/* ---------------------------------------------------------------- agents */
async function renderAgents() {
  if (!reg) return;
  const host = $("agents");
  const list = await readOrRetry("agents_list");
  if (!list.ok) { host.innerHTML = '<p class="warn">could not reach the network to read this register — press Load again</p>'; return; }
  const ids = JSON.parse(String(list.value));
  const firstClaim = {};
  if (!ids.length) { host.innerHTML = '<p class="muted">no agents registered yet</p>'; offerAgents([], firstClaim); return; }
  const cards = [];
  for (const id of ids.slice().reverse()) {
    const p = await readOrRetry("passport", [id]); if (!p.ok) continue;
    const a = JSON.parse(String(p.value));
    firstClaim[a.agent] = (a.claims || [])[0];
    const rows = Object.entries(a.verdicts || {}).map(([c, v]) => `<div class="v ${esc(v)}">${esc(c)} → ${esc(v)}</div><div class="reason">${esc((a.reasons || {})[c] || "")}</div>`).join("");
    cards.push(`<div class="agent"><div class="head"><span class="name" data-pick="${esc(a.agent)}" title="put this agent in the inspect and gate boxes">${esc(a.agent)}</span><span class="badge ${esc(a.status)}">${esc(a.status)}</span></div>
      <div class="mono muted">${esc(a.endpoint)}</div>
      <div class="mono muted">operator ${esc(a.operator)} · inspections ${a.inspections}${a.issued_at_inspection ? " · issued at #" + a.issued_at_inspection : ""}${a.issued_at ? " · issued " + esc(String(a.issued_at).slice(0, 10)) + (a.expired ? " · <b>expired</b>" : " · valid " + a.valid_days + " days") : ""}</div>
      <div class="mono">claims: ${(a.claims || []).map(esc).join(", ")}</div>
      ${a.inspections ? `<div class="mono muted">last inspected by ${esc(a.last_inspector)}</div>` : ""}
      ${a.challenges ? `<div class="mono muted">challenged ${a.challenges}× · last by ${esc(a.last_challenge?.by || "")} on ${esc(String(a.last_challenge?.at || "").slice(0, 10))} → <b>${esc(a.last_challenge?.outcome || "")}</b></div>` : ""}
      ${rows ? `<div class="verdicts">${rows}</div>` : '<p class="fine">not inspected yet</p>'}</div>`);
  }
  host.innerHTML = cards.join("");
  for (const n of host.querySelectorAll(".name[data-pick]")) n.onclick = () => { pick(n.dataset.pick, firstClaim[n.dataset.pick]); $("iid").scrollIntoView({ behavior: "smooth", block: "center" }); };
  offerAgents(ids, firstClaim);
}

paint();
const saved = (() => { try { return localStorage.getItem("passport_register"); } catch (e) { return null; } })();
if ($("useDemoReg") && DEMO_REGISTER) { $("useDemoReg").hidden = false; $("useDemoReg").onclick = () => useRegister(DEMO_REGISTER); }
const first = saved || DEMO_REGISTER;
if (first) { log("loading " + first + " …"); useRegister(first); }
