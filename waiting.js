/* What the page says while something is in between: one plain panel per state and role, answering the
   same five questions every time: what is happening (and who it waits for), how long, whether you must act,
   whether you can leave, and where the money is right now. Pure: no DOM, no network, no clock of its own,
   so tests/site/waiting.test.mjs runs every state and role from node.

   ctx carries what a line needs: id (the agent), stake / bond / fee / credit / amount (atto, as strings or
   bigints), claims (a count), until (unix seconds), now (unix seconds on the chain's clock), endpoint, label,
   renewal (an inspection of a passport in force), payable (the call sends value). */

export const GEN = 10n ** 18n;
export const COOLDOWN_SECONDS = 600;      // the register's CHALLENGE_COOLDOWN_SECONDS
export const HOLD_SECONDS = 86400;        // the register's RETIRE_HOLD_SECONDS
export const SILENCE_GRACE_SECONDS = 3600; // the register's SILENCE_GRACE_SECONDS
export const CLAIM_STAKE = GEN / 2n;      // the register's CLAIM_STAKE: 0.5 GEN behind every claim

const big = (v) => { try { return BigInt(String(v ?? "0").trim() || "0"); } catch (e) { return 0n; } };

/** "2 GEN", "0.2 GEN", "1.25 GEN": atto in, up to four decimals out, trailing zeros dropped. */
export function gen(atto) {
  const v = big(atto), neg = v < 0n, a = neg ? -v : v;
  const whole = a / GEN, frac = (a % GEN).toString().padStart(18, "0").slice(0, 4).replace(/0+$/, "");
  return (neg ? "−" : "") + whole.toString() + (frac ? "." + frac : "") + " GEN";
}

/** atto from a typed amount of GEN ("1", "0.25"); null when it is not a positive amount with at most 18 decimals. */
export function attoOf(text) {
  const s = String(text ?? "").trim();
  if (!/^[0-9]{1,9}(\.[0-9]{1,18})?$/.test(s)) return null;
  const [w, f = ""] = s.split(".");
  const v = BigInt(w) * GEN + BigInt((f + "0".repeat(18)).slice(0, 18));
  return v > 0n ? v : null;
}

/** The stake a set of claims needs, in atto. */
export const stakeFor = (claims) => CLAIM_STAKE * BigInt(Math.max(0, Number(claims) || 0));

/** Unix seconds of an ISO instant, or -1. */
export function isoSeconds(iso) {
  const t = Date.parse(String(iso || ""));
  return Number.isFinite(t) ? Math.floor(t / 1000) : -1;
}

/** The moment a swap agent changes model, read from its endpoint (?persona=swap&at=<unix>); 0 if it is not one. */
export function swapAtOf(endpoint) {
  try {
    const u = new URL(String(endpoint));
    if (u.searchParams.get("persona") !== "swap") return 0;
    const at = u.searchParams.get("at") || "";
    return /^[0-9]{1,12}$/.test(at) ? Number(at) : 0;
  } catch (e) { return 0; }
}
/** What a swap agent turns into at its moment: "another model" (the default) or "coy". */
export function swapToOf(endpoint) {
  try { return new URL(String(endpoint)).searchParams.get("to") === "coy" ? "coy" : "swapped"; } catch (e) { return "swapped"; }
}

/** "45 s", "4 min 05 s", "2 h 03 min", "3 days 4 h". */
export function span(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  if (s < 60) return s + " s";
  if (s < 3600) return Math.floor(s / 60) + " min " + String(s % 60).padStart(2, "0") + " s";
  if (s < 86400) return Math.floor(s / 3600) + " h " + String(Math.floor((s % 3600) / 60)).padStart(2, "0") + " min";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
  return d + (d === 1 ? " day" : " days") + (h ? " " + h + " h" : "");
}
/** "14:05 UTC" for a unix second; the chain's clock is UTC. */
export function clock(unix) {
  const t = new Date(Number(unix) * 1000);
  return Number.isFinite(t.getTime()) ? t.toISOString().slice(11, 16) + " UTC" : "";
}
/** "in 4 min 05 s (14:05 UTC)" or "since 14:05 UTC". */
export function until(unix, now) {
  const left = Number(unix) - Number(now);
  return left > 0 ? "in " + span(left) + " (" + clock(unix) + ")" : "since " + clock(unix);
}

/** The state an agent row is in, for its card and its waiting panel. */
export function rowState(p) {
  if (!p || p.error) return "missing";
  if (p.retired) return p.hold_over ? (big(p.stake) > 0n ? "unstake_ready" : "retired_done") : "retired";
  if (p.suspended) return "suspended";
  if (p.status === "issued") return p.in_force ? "issued" : "expired";
  if (p.status === "refused") return big(p.slashed) > 0n && big(p.stake) === 0n ? "revoked_row" : "refused";
  if (p.status === "pending") return "pending";
  return "unverified";
}

/** Who the viewer is to an agent: its operator, or somebody else. */
export const roleOf = (p, me) => (me && p?.operator && String(p.operator).toLowerCase() === String(me).toLowerCase() ? "operator" : "visitor");

/** The headline of a settled challenge row, from the point of view of `me`. */
export function outcomeHead(row, me) {
  const mine = !!me && String(row?.by || "").toLowerCase() === String(me).toLowerCase();
  const silent = /did not answer/.test(Object.values(row?.reasons || {}).join(" "));
  switch (row?.outcome) {
    case "revoked":
      return { cls: "revoked", head: (silent ? "Still silent" : "Contradicted") + " · revoked · stake paid to " + (mine ? "you" : "the challenger") };
    case "held":
      return { cls: "held", head: "All claims held · bond to the operator" };
    case "inconclusive":
      return { cls: "inconclusive", head: "Inconclusive · fee to the operator" };
    case "unanswered":
      return { cls: "unanswered", head: "No answer · suspended · nothing moved" };
    default:
      return { cls: "inconclusive", head: "Settled" };
  }
}

/** The money a settled challenge moved, as lines for the viewer. */
export function moneyLines(row, me) {
  const mine = !!me && String(row?.by || "").toLowerCase() === String(me).toLowerCase();
  const you = mine ? "you" : "the challenger";
  if (row?.outcome === "revoked") {
    return [
      "slashed: " + gen(row.slashed) + ", the whole stake",
      gen(row.to_challenger) + " to " + you + ", sent in the same transaction (it lands when the transaction is finalized)",
      gen(row.kept) + " kept by the register, paid to nobody",
      "the bond (" + gen(row.bond) + ") stays in " + (mine ? "your" : "the challenger's") + " credit",
    ];
  }
  if (row?.outcome === "held") return ["the bond, " + gen(row.from_credit) + ", went from " + (mine ? "your" : "the challenger's") + " credit to the operator", "the stake is untouched"];
  if (row?.outcome === "inconclusive") return ["the fee, " + gen(row.from_credit) + ", went from " + (mine ? "your" : "the challenger's") + " credit to the operator; the rest of the bond stays", "the stake is untouched"];
  if (row?.outcome === "unanswered") return ["nothing moved: the credit and the stake are untouched", "the passport is suspended (is_valid says no) until a round in which the endpoint answers"];
  return [];
}

const FINAL = "the transfer lands when the transaction is finalized, a few minutes after the verdict";

/**
 * The five answers for one state and role. Every state returns all five, never an empty line.
 *   states: wallet, staking, topping, inspecting, issued, refused, pending, unverified, expired, suspended,
 *           deposit, withdraw, challenging, revoked, held, inconclusive, unanswered, cooldown, retiring, retired,
 *           unstake_ready, unstaking, split, job_open, job_fund, job_funded, job_settle, job_paid, job_refunded
 *   roles:  operator, challenger, buyer, visitor
 */
export function waitLines(state, ctx = {}, role = "visitor") {
  const id = ctx.id || "the agent";
  const stake = gen(ctx.stake), bond = gen(ctx.bond), fee = gen(ctx.fee), credit = gen(ctx.credit), amount = gen(ctx.amount);
  const half = gen(big(ctx.stake) / 2n);
  const op = role === "operator";
  const L = (title, what, long, act, leave, money) => ({ title, what, long, act, leave, money });
  switch (state) {
    case "wallet":
      return L("Waiting for your wallet",
        "Your wallet is showing " + (ctx.label || "the transaction") + ". Nothing is sent until you sign.",
        "Until you sign or refuse.",
        "Yes: sign it, or refuse it, in the wallet window.",
        "Not yet. Once it is signed it runs on the network without this page.",
        ctx.payable ? amount + " stays in your wallet until you sign; then it travels with the transaction." : "Nothing moves. Studio charges no gas.");
    case "staking":
      return L("Registering " + id + " with its stake",
        "The register checks the id, the claims and the endpoint. Nobody calls the agent yet; that is the inspection.",
        "About half a minute to a minute.",
        "No.",
        "Yes. If it is accepted, " + id + " is on the record, unverified, and section 08 shows it when you come back.",
        stake + " travels with the registration (0.5 GEN for each claim). If the register refuses anything, all of it comes back in the same transaction; if it accepts, the stake stays in the register while the agent exists and comes back by Unstake one day after Retire.");
    case "topping":
      return L("Updating " + id,
        "The register checks the new endpoint and claims and resets the passport to unverified; inspect it again afterwards.",
        "About half a minute to a minute.",
        "No.",
        "Yes. The row changes as soon as this is accepted.",
        big(ctx.amount) > 0n ? amount + " goes with the update: what the new claims lack. A refusal returns it in the same transaction."
          : big(ctx.returned) > 0n ? gen(ctx.returned) + " the new claims no longer need comes back to you in this transaction." : "Nothing moves: the stake already covers these claims.");
    case "inspecting":
      return L(ctx.renewal ? "Renewing " + id : "Inspecting " + id,
        "Every validator sends the public battery to " + (ctx.endpoint || "the endpoint") + " itself, decides the keyword probes in code and asks its own model about the judged ones, then they compare one word per claim. "
          + (ctx.renewal ? "Every claim matching renews the passport from now." : "Every claim matching issues the passport."),
        "One to three minutes; longer if a validator times out and the round is run again.",
        "No.",
        "Yes. The verdict is stored on the row whatever happens; section 08 has it when you come back.",
        ctx.renewal ? "Your " + stake + " stake stays in the register. If a claim is contradicted now, the passport is revoked and the whole stake is slashed and kept by the register."
          : "Your " + stake + " stake stays in the register. An inspection of a passport not in force moves no money, whatever it finds.");
    case "issued":
      return L(id + " holds a passport in force",
        "is_valid(" + id + ", claim) says yes for its claims" + (ctx.until ? ", until " + clock(ctx.until) + " on " + new Date(Number(ctx.until) * 1000).toISOString().slice(0, 10) : "") + ".",
        "30 days from issue, unless a challenge revokes it first, or one day after Retire.",
        op ? "Nothing. Inspect it again to renew it for 30 days from then; Retire to stop." : "Nothing. If you doubt it, challenge it: section 07, bonded with " + bond + " of credit.",
        "Yes.",
        op ? "Your " + stake + " stake stays in the register and answers for every claim. Anyone but you may challenge it; a contradiction pays them " + half + " and the register keeps the rest."
          : stake + " of the operator's stake answers for it. A challenge that finds a claim contradicted pays the challenger " + half + "; one that finds every claim holding costs the challenger the bond, " + bond + ".");
    case "refused":
      return L(id + " was refused",
        "A claim was contradicted; the validators' reasons are on the row. The same endpoint with the same claims cannot be inspected again.",
        "Until its operator changes the endpoint or the claims.",
        op ? "Update mine (section 06) with what it really does, then inspect it again." : "Nothing; is_valid says no.",
        "Yes.",
        op ? "Your " + stake + " stake is still in the register; Update keeps it, Retire and Unstake take it back." : "The operator's stake (" + stake + ") is still in the register.");
    case "pending":
      return L(id + " is pending",
        "Nothing was contradicted, but not every claim settled (an inconclusive word).",
        "Until its operator inspects it again or narrows the claims.",
        op ? "Inspect again, or drop the claim that did not settle (Update mine)." : "Nothing; is_valid says no until it is issued.",
        "Yes.",
        "The " + stake + " stake stays in the register.");
    case "unverified":
      return L(id + " is on the record, not inspected yet",
        "Registered with its claims and its stake; no validator has called it yet.",
        "Until its operator presses Inspect.",
        op ? "Yes: Inspect it in section 07. About a minute." : "Nothing; is_valid says no until it is issued.",
        "Yes.",
        "The " + stake + " stake is in the register.");
    case "expired":
      return L(id + "'s passport has expired",
        "It was issued more than 30 days ago; is_valid says no and nobody can challenge it.",
        "Until its operator inspects it again.",
        op ? "Inspect it again: every claim matching issues it for 30 more days." : "Nothing.",
        "Yes.",
        op ? "Your " + stake + " stake is in the register; Retire, then Unstake a day later, takes it back." : "The " + stake + " stake is in the register; nothing can be slashed from an expired passport.");
    case "suspended":
      return L(id + " is suspended",
        "The validators agreed its endpoint did not answer the battery. is_valid says no until a round in which it answers.",
        "If it still does not answer " + span(SILENCE_GRACE_SECONDS) + " after it was first found silent, the next challenge revokes it.",
        op ? "Bring the endpoint back, then inspect it: a round in which it answers lifts the suspension." : "Nothing. A challenge after the hour revokes it if it is still silent.",
        "Yes.",
        "Nothing has moved yet: the " + stake + " stake is in the register.");
    case "deposit":
      return L("Adding challenge credit",
        "The register writes " + amount + " under your address. Only a challenge by you can spend it; only withdraw by you takes it out.",
        "About half a minute to a minute.",
        "No.",
        "Yes. The credit stays under your address; Take back my credit returns all of it at any time.",
        amount + " travels with the transaction into the register, as your credit. A refusal returns it in the same transaction.");
    case "withdraw":
      return L("Taking back your credit",
        "The register sends all of your credit (" + credit + ") back to your address.",
        "About half a minute to the decision; " + FINAL + ".",
        "No.",
        "Yes. The GEN reaches your wallet whether this page is open or not.",
        "In the register until the transaction is finalized, then in your wallet.");
    case "challenging":
      return L("Challenging " + id,
        "Every validator sends the public battery to " + id + "'s endpoint itself and judges each claim; the round settles only when a majority give the leader's words.",
        "One to three minutes to the verdict; " + FINAL + ".",
        "No.",
        "Yes. The result is written on the row (section 08, challenges) and the transfers land whether this page is open or not.",
        "Your bond, " + bond + ", is in your credit in the register. Contradicted: the passport is revoked and " + half + " of the stake is paid to you, the bond stays yours. Every claim held: the bond goes to the operator. Nothing settled: the fee, " + fee + ", goes to the operator.");
    case "revoked":
      return L(id + " is revoked",
        role === "challenger" ? "The validators agreed a claim is contradicted. The passport is refused and the whole stake slashed; you caught it."
          : "A challenge found a claim contradicted. The passport is refused and the whole stake slashed.",
        "Done: the verdict is stored. " + (role === "challenger" ? "Your " + half + " lands when the transaction is finalized, a few minutes." : "The challenger's half lands when the transaction is finalized."),
        role === "challenger" ? "Nothing. Your bond is still in your credit: take it back when you like." : op ? "To come back: Update mine with a new endpoint or claims, stake again, then inspect." : "Nothing; is_valid says no. A job in escrow on it refunds its buyer.",
        "Yes.",
        (role === "challenger" ? half + " to you" : half + " to the challenger") + "; " + gen(big(ctx.stake) - big(ctx.stake) / 2n) + " kept by the register, paid to nobody. Every escrow job funded on " + id + " before now refunds its buyer, even if it is issued again.");
    case "held":
      return L("Every claim held",
        "A majority of validators found every claim matching: " + id + "'s passport stands.",
        "Done. The bond reaches the operator when the transaction is finalized.",
        role === "challenger" ? "Nothing. This address may challenge " + id + " again after " + span(COOLDOWN_SECONDS) + "." : "Nothing.",
        "Yes.",
        "The bond, " + bond + ", went from the challenger's credit to the operator. " + (role === "challenger" ? "Your credit now: " + credit + "." : ""));
    case "inconclusive":
      return L("Nothing settled",
        "The answers did not settle a claim either way (the agent would not say, or the judges' four readings disagreed): " + id + "'s passport stands.",
        "Done. The fee reaches the operator when the transaction is finalized.",
        role === "challenger" ? "Nothing. Inconclusive is not evidence, so it is not a free re-roll: the next try from this address waits " + span(COOLDOWN_SECONDS) + " and costs the same." : "Nothing.",
        "Yes.",
        "The fee, " + fee + ", went from the challenger's credit to the operator; the rest of the bond stays in credit. " + (role === "challenger" ? "Your credit now: " + credit + "." : ""));
    case "unanswered":
      return L(id + " did not answer",
        "The validators agreed the endpoint did not answer the battery. The passport is suspended: is_valid says no.",
        "Until a round in which it answers; still silent " + span(SILENCE_GRACE_SECONDS) + " after the first time, the next challenge revokes it.",
        role === "challenger" ? "Nothing now. Challenge again after " + span(COOLDOWN_SECONDS) + "; after the hour it revokes if it is still silent." : op ? "Bring the endpoint back and inspect it." : "Nothing.",
        "Yes.",
        "Nothing moved: the bond stays in the challenger's credit and the " + stake + " stake in the register.");
    case "cooldown":
      return L("Cooldown",
        "This address challenged " + id + " less than " + span(COOLDOWN_SECONDS) + " ago; one address may challenge one passport once in ten minutes.",
        ctx.until ? "It may challenge again " + until(ctx.until, ctx.now) + "." : "Ten minutes from its last challenge.",
        "Wait, or challenge from another address: each address has its own ten minutes.",
        "Yes.",
        "Your credit (" + credit + ") stays in the register under your address; Take back my credit returns it.");
    case "retiring":
      return L("Retiring " + id,
        "The register marks " + id + " retired. Its passport stays in force, and can still be challenged, for one more day.",
        "About half a minute to a minute.",
        "No.",
        "Yes.",
        "The " + stake + " stake stays in the register through the day's hold, where a challenge can still reach it.");
    case "retired":
      return L(id + " is retired; the hold is running",
        "Retired by its operator. Its passport stays in force and challengeable until the hold ends, so nobody can retire and walk off with the stake in the same minute.",
        ctx.until ? "The hold ends " + until(ctx.until, ctx.now) + "." : "One day after Retire.",
        op ? "Come back after the hold and press Unstake mine." : "Nothing. It can be challenged until the hold ends.",
        "Yes.",
        op ? "Your " + stake + " stake stays in the register through the hold; Unstake hands it back after." : "The " + stake + " stake stays in the register through the hold.");
    case "unstake_ready":
      return L("The hold is over",
        id + " is retired and its hold has passed; nothing can settle against it any more.",
        "Until its operator unstakes.",
        op ? "Yes: press Unstake mine in section 06." : "Nothing.",
        "Yes.",
        stake + " is waiting in the register for its operator.");
    case "unstaking":
      return L("Taking back the stake of " + id,
        "The register sends the " + stake + " stake back to the operator, the sender.",
        "About half a minute to the decision; " + FINAL + ".",
        "No.",
        "Yes. The GEN reaches your wallet whether this page is open or not.",
        "In the register until the transaction is finalized, then in your wallet.");
    case "split":
      return L("No majority",
        "The validators did not agree, so nothing was stored and nothing in the register changed.",
        "Done.",
        "Press again: a round with no majority stores nothing and moves nothing, so it is safe to repeat.",
        "Yes.",
        "Where it was before you pressed.");
    case "job_open":
      return L("Opening the job",
        "Deploying an escrow contract from your wallet, bound to " + id + ", the claim " + (ctx.claim || "") + ", the operator " + (ctx.operator || "") + " and its endpoint. You are its buyer.",
        "About a minute.",
        "No.",
        "Better stay: the job's address arrives here (it is also on the explorer under your wallet's transactions). This browser remembers it.",
        "Nothing moves yet: the job holds nothing until you fund it.");
    case "job_fund":
      return L("Funding the job",
        "Putting " + amount + " into the job. The job also reads how much the register has ever slashed from " + id + ": a revoke after now refunds you, even if it is issued again later.",
        "About a minute.",
        "No.",
        "Yes. This browser remembers the job.",
        amount + " goes into the job contract. Only the operator you bound to (while the passport covers the job) or you can ever receive it.");
    case "job_funded":
      return L("The job holds " + amount,
        "It is waiting for its buyer to settle. would_pay reads the register for free: it says who would be paid now.",
        "Until you settle; the operator may settle too seven days after your first funding.",
        "Settle when the work is done.",
        "Yes. This browser remembers the job; its address is on the explorer.",
        amount + " is in the job contract.");
    case "job_settle":
      return L("Settling the job",
        "The job asks the register is_valid(" + id + ", " + (ctx.claim || "claim") + ") and reads the row: it pays the operator only if the passport covers the claim, the row still carries the operator and endpoint you bound to, and nothing was slashed since you funded. Otherwise it refunds you.",
        "About a minute to the decision; " + FINAL + ".",
        "No.",
        "Yes. The payment lands whether this page is open or not.",
        "In the job until the transaction is finalized, then with whoever it pays.");
    case "job_paid":
      return L("The operator was paid",
        "The passport covered the claim and the row was the one you bound to, so the job paid " + amount + " to the operator.",
        ctx.final ? "Done: the transfer has landed." : "Decided; " + FINAL + ".",
        "Nothing. Open a new job to try again.",
        "Yes.",
        ctx.final ? amount + " is in the operator's wallet." : amount + " is on its way to the operator's wallet.");
    case "job_refunded":
      return L("You were refunded",
        "The passport did not cover the job (revoked, refused, suspended, expired, or the row changed), so the job returned " + amount + " to you.",
        ctx.final ? "Done: the transfer has landed." : "Decided; " + FINAL + ".",
        "Nothing.",
        "Yes.",
        ctx.final ? amount + " is back in your wallet." : amount + " is on its way back to your wallet.");
    default:
      return L("Working", "The page is waiting for the network.", "A moment.", "No.", "Yes.", "Where it was.");
  }
}

/** Every state waitLines knows, for the tests. */
export const STATES = ["wallet", "staking", "topping", "inspecting", "issued", "refused", "pending", "unverified", "expired",
  "suspended", "deposit", "withdraw", "challenging", "revoked", "held", "inconclusive", "unanswered", "cooldown", "retiring",
  "retired", "unstake_ready", "unstaking", "split", "job_open", "job_fund", "job_funded", "job_settle", "job_paid", "job_refunded"];
export const ROLES = ["operator", "challenger", "buyer", "visitor"];
