// The transactions of one register, listed from the RPC and decoded, so the page
// can put the explorer link of every transaction under the passport it touched.
// A contract cannot know its own transaction hashes; the network can list them
// (sim_getTransactionsForAddress), but each entry carries a contract snapshot
// and weighs a hundred kilobytes, so the list is read here and returned as a
// few bytes per transaction: hash, sender, method, agent, and how it ended.
//
//   GET /api/txs?register=0x…   ->  { register, count, txs: [{hash, from, at, method, agent, exec, result, error}] }
export const config = { runtime: "nodejs" };

const RPC = "https://studio-next.genlayer.com/api";
const cache = new Map();            // register -> { at, body }; a few seconds, so a busy page does not hammer the RPC
const TTL_MS = 5000;

/* GenLayer calldata: a LEB128 header per value, type in the low three bits, payload above.
   0 special (null, false, true, address), 1 int, 2 negative int, 3 bytes, 4 string,
   5 array (count), 6 map (count; keys are length-prefixed strings). */
function decode(buf) {
  let i = 0;
  const varint = () => { let v = 0, s = 0, c; do { c = buf[i++]; v += (c & 0x7f) * 2 ** s; s += 7; } while (c & 0x80); return v; };
  const one = () => {
    const h = varint(), t = h & 7, p = Math.floor(h / 8);
    if (t === 0) { if (p === 0) return null; if (p === 1) return false; if (p === 2) return true; if (p === 3) { const a = "0x" + buf.subarray(i, i + 20).toString("hex"); i += 20; return a; } return null; }
    if (t === 1) return p;
    if (t === 2) return -p - 1;
    if (t === 3) { const b = buf.subarray(i, i + p); i += p; return b; }
    if (t === 4) { const s = buf.subarray(i, i + p).toString("utf8"); i += p; return s; }
    if (t === 5) { const out = []; for (let k = 0; k < p; k++) out.push(one()); return out; }
    if (t === 6) { const out = {}; for (let k = 0; k < p; k++) { const n = varint(); const key = buf.subarray(i, i + n).toString("utf8"); i += n; out[key] = one(); } return out; }
    throw new Error("unknown calldata type " + t);
  };
  return one();
}

function summarize(t, register) {
  let call = null;
  try { call = decode(Buffer.from(t.data?.calldata || "", "base64")); } catch (e) {}
  if (!call || typeof call !== "object" || Array.isArray(call)) return null;
  const method = call[""] ?? call.method;
  if (typeof method !== "string") return null;                       // the deploy has no method
  const args = Array.isArray(call.args) ? call.args : [];
  const lr = t.consensus_data?.leader_receipt, one = Array.isArray(lr) ? lr[0] : lr;
  let text = "";
  try { text = Buffer.from(one?.result || "", "base64").toString("utf8").replace(/[^\x20-\x7e]/g, " ").trim(); } catch (e) {}
  let j = null; const b = text.indexOf("{"); if (b !== -1) { try { j = JSON.parse(text.slice(b)); } catch (e) {} }
  const exec = one?.execution_result || null;
  return {
    hash: t.hash, from: t.from_address, at: t.created_at, status: t.status, method,
    agent: typeof args[0] === "string" ? args[0].trim().toLowerCase() : null,
    exec, result: j ? { ok: j.ok, status: j.status ?? null, outcome: j.outcome ?? null } : null,
    error: exec === "ERROR" ? text.slice(0, 160) : null,
  };
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  const url = new URL(req.url, "https://x");
  const register = (url.searchParams.get("register") || "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(register)) return res.status(400).end(JSON.stringify({ error: "register=0x… (40 hex characters)" }));
  const key = register.toLowerCase(), fresh = url.searchParams.get("fresh") === "1";
  const hit = cache.get(key);
  if (hit && !fresh && Date.now() - hit.at < TTL_MS) return res.status(200).end(hit.body);
  let list;
  try {
    const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sim_getTransactionsForAddress", params: [register] }) });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message || "rpc error");
    list = Array.isArray(j.result) ? j.result : [];
  } catch (e) { return res.status(502).end(JSON.stringify({ error: "the network did not list the transactions: " + String(e.message || e) })); }
  const txs = list.filter((t) => String(t.to_address || "").toLowerCase() === key).map((t) => summarize(t, register)).filter(Boolean);
  txs.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const body = JSON.stringify({ register, count: txs.length, txs });
  cache.set(key, { at: Date.now(), body });
  res.status(200).end(body);
}
