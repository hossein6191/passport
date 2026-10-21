// The page's waiting copy and money formatting, from node, with no browser and no network:
//   node --test tests/site/
import { test } from "node:test";
import assert from "node:assert/strict";
import { STATES, ROLES, waitLines, gen, attoOf, stakeFor, swapAtOf, swapToOf, span, rowState, roleOf, outcomeHead, moneyLines, GEN } from "../../waiting.js";

const CTX = { id: "demo-swap-1", stake: String(2n * GEN), bond: String(GEN / 5n), fee: String(GEN / 10n), credit: String(GEN / 2n),
              amount: String(GEN), until: 1_800_000_600, now: 1_800_000_000, endpoint: "https://x/api/agent?persona=swap&at=1", claim: "can:code" };

test("every state answers the five questions, for every role, never with an empty line", () => {
  for (const state of STATES) for (const role of ROLES) {
    const L = waitLines(state, CTX, role);
    for (const k of ["title", "what", "long", "act", "leave", "money"]) {
      assert.equal(typeof L[k], "string", `${state}/${role}/${k}`);
      assert.ok(L[k].trim().length > 1, `${state}/${role}/${k} is empty`);
      assert.ok(!/undefined|NaN|\[object/.test(L[k]), `${state}/${role}/${k}: ${L[k]}`);
    }
  }
});

test("every state says where the money is in GEN when money is involved", () => {
  for (const s of ["staking", "challenging", "revoked", "held", "inconclusive", "deposit", "job_fund", "job_paid"]) {
    assert.match(waitLines(s, CTX, "challenger").money, /GEN/, s);
  }
});

test("a challenger hears the money of a catch, the bond and the fee", () => {
  const L = waitLines("challenging", CTX, "challenger");
  assert.match(L.money, /0\.2 GEN/);
  assert.match(L.money, /1 GEN of the stake is paid to you/);
  assert.match(L.money, /0\.1 GEN/);
  assert.match(waitLines("revoked", CTX, "challenger").money, /^1 GEN to you; 1 GEN kept by the register/);
});

test("the copy without a context still reads", () => {
  for (const state of STATES) assert.ok(waitLines(state).what.length > 1, state);
});

test("GEN is formatted from atto without floats", () => {
  assert.equal(gen("2000000000000000000"), "2 GEN");
  assert.equal(gen(GEN / 5n), "0.2 GEN");
  assert.equal(gen(GEN / 20n), "0.05 GEN");
  assert.equal(gen("0"), "0 GEN");
  assert.equal(gen(-GEN), "−1 GEN");
  assert.equal(gen("garbage"), "0 GEN");
  assert.equal(stakeFor(4), 2n * GEN);
});

test("a typed amount becomes atto, and nothing else does", () => {
  assert.equal(attoOf("1"), GEN);
  assert.equal(attoOf("0.25"), GEN / 4n);
  assert.equal(attoOf(" 2.5 "), 5n * GEN / 2n);
  for (const bad of ["", "0", "-1", "1e3", "abc", "1.2.3", "0.0000000000000000001"]) assert.equal(attoOf(bad), null, bad);
});

test("the swap moment is read from the endpoint, and only from a swap endpoint", () => {
  assert.equal(swapAtOf("https://a.b/api/agent?persona=swap&at=1800000000"), 1800000000);
  assert.equal(swapAtOf("https://a.b/api/agent?persona=swap&at=1800000000&to=coy"), 1800000000);
  assert.equal(swapAtOf("https://a.b/api/agent?persona=honest&at=1800000000"), 0);
  assert.equal(swapAtOf("https://a.b/api/agent?persona=swap&at=soon"), 0);
  assert.equal(swapAtOf("not a url"), 0);
  assert.equal(swapToOf("https://a.b/api/agent?persona=swap&at=1&to=coy"), "coy");
  assert.equal(swapToOf("https://a.b/api/agent?persona=swap&at=1"), "swapped");
});

test("spans read as a person would say them", () => {
  assert.equal(span(45), "45 s");
  assert.equal(span(245), "4 min 05 s");
  assert.equal(span(7380), "2 h 03 min");
  assert.equal(span(86400 + 3600 * 4), "1 day 4 h");
  assert.equal(span(-5), "0 s");
});

test("a row's state follows the register's fields", () => {
  const base = { stake: "2000000000000000000", slashed: "0", in_force: false, retired: false, suspended: false, hold_over: false };
  assert.equal(rowState({ ...base, status: "issued", in_force: true }), "issued");
  assert.equal(rowState({ ...base, status: "issued" }), "expired");
  assert.equal(rowState({ ...base, status: "refused", stake: "0", slashed: "2000000000000000000" }), "revoked_row");
  assert.equal(rowState({ ...base, status: "refused" }), "refused");
  assert.equal(rowState({ ...base, status: "issued", in_force: true, suspended: true }), "suspended");
  assert.equal(rowState({ ...base, status: "issued", in_force: true, retired: true }), "retired");
  assert.equal(rowState({ ...base, status: "issued", retired: true, hold_over: true }), "unstake_ready");
  assert.equal(rowState({ ...base, status: "issued", retired: true, hold_over: true, stake: "0" }), "retired_done");
  assert.equal(rowState({ ...base, status: "unverified" }), "unverified");
  assert.equal(rowState({ error: "no agent named x" }), "missing");
  assert.equal(roleOf({ operator: "0xAbC" }, "0xabc"), "operator");
  assert.equal(roleOf({ operator: "0xAbC" }, "0xdef"), "visitor");
  assert.equal(roleOf({ operator: "0xAbC" }, null), "visitor");
});

test("a settled challenge's card names the outcome and the money from the viewer's side", () => {
  const row = { n: 1, by: "0xc", outcome: "revoked", slashed: String(2n * GEN), to_challenger: String(GEN), kept: String(GEN), bond: String(GEN / 5n),
                from_credit: "0", to_operator: "0", reasons: { "family:gpt": "maker: the answer names another family" } };
  assert.equal(outcomeHead(row, "0xC").head, "Contradicted · revoked · stake paid to you");
  assert.equal(outcomeHead(row, "0xd").head, "Contradicted · revoked · stake paid to the challenger");
  assert.match(moneyLines(row, "0xc").join(" "), /1 GEN to you/);
  const silent = { ...row, reasons: { "family:gpt": "the endpoint still did not answer the public battery" } };
  assert.match(outcomeHead(silent, "0xc").head, /^Still silent/);
  assert.equal(outcomeHead({ ...row, outcome: "held" }).head, "All claims held · bond to the operator");
  assert.equal(outcomeHead({ ...row, outcome: "inconclusive" }).head, "Inconclusive · fee to the operator");
  assert.equal(outcomeHead({ ...row, outcome: "unanswered" }).head, "No answer · suspended · nothing moved");
  assert.match(moneyLines({ ...row, outcome: "held", from_credit: String(GEN / 5n) }, "0xc")[0], /0\.2 GEN, went from your credit to the operator/);
});
