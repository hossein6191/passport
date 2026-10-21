# Decisions

## The boundary, written before the code

- **Frontend owns:** the registry page, the register/update form, the "inspect" button, reading passports.
- **Passport contract owns:** the closed set of claims, the public battery, the inspection (each validator
  talks to the agent itself), the three-word verdicts, issue/refuse/pending, the refused-key guard, `is_valid`.
- **External sources own:** the agent's answers. They are untrusted: fenced by replacement at the prompt
  boundary, never stored unfenced into a prompt, and never compared across validators. Only the verdicts are.
- **Escrow fixture owns:** the consequence. Pays the operator the buyer named, only while `is_valid` says so
  and the row still carries that operator and endpoint; otherwise the buyer.

User action → evidence → nondet call → equivalence → state → settlement:
`inspect(agent)` → each validator POSTs the battery to the endpoint → keyword probes decided in code, judged
probes asked in two presentation orders → validators compare the verdict word per claim, exactly → status
issued / refused / pending → `Escrow.release()` reads `is_valid` and the row under the name, pays the
operator the buyer bound to when both hold, and refunds otherwise.

## Why the answer is three words

What crosses consensus is `matches / contradicts / inconclusive` per claim. Agent answers vary per call
(temperature, load); verdicts do not have to. "Inconclusive" is where uncertainty lives, never a tolerance
in the validator. Two presentation orders per judged probe turn an ordering bias into a disagreement that
lands in the value.

## Why this is not a proof

No method identifies the model behind an endpoint. Passport records the network's validators, each
asking the endpoint itself, agreeing on behaviour against public probes. The README and `rules()` say so in those words.

## The clock, and why it is done by hand

There is no block timestamp. `gl.message_raw["datetime"]` is the one instant every node
sees identically for a transaction, and for a read. Passports are issued with it and
expire 30 days later by it. The interval is computed with integers only: the first
version used `datetime.fromisoformat` and a float division, passed lint and every pure
test, and killed the VM on chain with `wasm_trap DeterministicMode` the first time a
view touched a real date. A clock that cannot be read means *no* expiry, not a guess.

## Why the battery is public

A hidden battery would be a secret the contract cannot keep: the source is on chain.
Public probes also make the verdicts explainable: a refused passport says which probe
failed and why. An agent that prepares for known questions is still an agent that
answers them; the claim is about behaviour, not about surprise.

## Who may end a passport

(This is version 1's answer. Version 2 keeps the split and puts money on both sides of it; see
the last section.) The first version let anyone call `inspect`, and every outcome applied. That is a hole
a reviewer would name in one line: a competitor inspects an honest agent on a day a
judged probe comes back inconclusive, and the passport is parked as *pending*: revoked
without evidence, by a stranger. So the two intentions are two calls. `inspect` belongs
to the operator, who is paying for their own passport and accepts any outcome.
`challenge` belongs to anyone, once a day per agent, and can only do one thing: refuse
the passport on a contradiction, with the challenger's verdicts and address on the row.
Matches and inconclusives leave it standing. Evidence can take a passport away; noise
cannot. The cooldown is there because a challenge makes every validator hit the agent's
endpoint, and that is a cost a stranger should not be able to impose in a loop.

## The buyer cannot sit on a finished job

`Escrow.release` was buyer-only. Walk the operator's journey to the end and it dead-ends:
the work is done, the passport is valid, and the buyer simply never releases. Now the
buyer may settle at any time, and the operator may settle once the buyer's first funding is
seven days old, under exactly the same rule. The passport and the binding decide who is
paid, never the caller.
The deadline is counted on the message clock, and a missing clock never opens the
operator's path early.

## A name is a handle, not authority

`register` is first come first served: whoever sends the transaction first holds the
name, and the row is that wallet's assertion about an endpoint. Nothing on chain can say
who the "real" owner of a name is. So the register does not pretend to: a consumer that
moves value binds to what it knows independently, the operator address and the endpoint,
and the escrow refunds the buyer when the row under the name is not that. A squatter can
hold a name and even earn a passport for their own endpoint; they cannot be paid for a
job the buyer bound to somebody else. The next step, if a stronger binding is ever
needed, is verifiable rather than asserted: validators fetch a well-known file on the
endpoint's host that names the operator address, under consensus, and the row is marked
bound to that host.

## Why a refused pair cannot be asked again

Inspection costs consensus and the agent's operator does not pay for it. Without the
guard, a refused operator could ask until a lucky run issued. The way out is honest:
change the endpoint or the claims, which resets the passport and reopens inspection.

## Studio Next, and what the v0.6 runtime changed

(Version 1's network. Version 2 is back on Studio; see the last section.)

The hackathon requires Studio Next (consensus v0.6, chain 61997). Measured on 14
September 2026 with a throwaway account: the runner id the network accepts is
`py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng` (the one in the
Studio v0.123 examples; the older ids answer "invalid_contract runner malformed"); the
SDK is imported as `import genlayer as gl` with `gl.contract.Contract`, `gl.storage.TreeMap`,
`gl.u256` and `gl.Address` (the star import no longer defines `gl`); the nondet round is
`gl.vm.run_nondet(leader_fn, validator_fn)` and returns the leader's value. Everything
else the register relies on still holds there: `gl.nondet.web.post` with `.status` and
`.body`, `gl.nondet.exec_prompt`, the message clock, cross-contract views. Every write
carries a fee quote from `estimateTransactionFeesForWrite`, which simulates the call; a
call the contract refuses cannot be simulated, so those go with the default quote. A
transaction is applied at `ACCEPTED` (decided) and finalizes later; the page shows the
result at `ACCEPTED`. The whole battery, a refusal, a stranger's refused inspection and a
challenge all settled on Studio Next with 3 validators agreeing, at fees below 0.001 GEN.

## Where the agents live

The register stores an HTTPS endpoint and validators fetch it themselves, so the demo
agents have to be reachable from Studio for minutes at a time. They are a Vercel
function on the same host as the page. During development they sat behind a tunnel from
a laptop (localtunnel answered 3 of 12 concurrent requests and died mid-inspection;
tunnelmole held), but nothing on chain points at a tunnel.

## Why twelve demo agents, and why they are scripted

A visitor has to be able to try the register without running an agent, and a reviewer
has to be able to see every outcome without trusting a screenshot. So the six personas
are chosen by outcome: issued twice (one by keyword probes, one by judged probes),
refused three ways (a lie, a hijack of the judge, an invented fact; the third may also
land as pending when the judge only doubts) and pending once (a maker that will not say). They are scripted because the battery does not care what
answers: the verdicts come from code and from the validators' own models, and a script
is the one kind of agent whose answers a reviewer can read in full before the test. The
page says so in as many words. The same function runs a real model when it is deployed
with an API key.

Six more were added on 14 September, because a visitor asked what the chips do and the
answer was "read section 02": each of the later six differs from a base persona in
exactly one thing (a wrong sum, one smuggled line obeyed, one claim too many, chatty
answers, an echo, a narrow honest claim set), so the reason on the record names the one
thing. The chip row now says what each agent does and what to expect before anybody
signs, and the same line is the chip's tooltip.

## Version 2: a stake behind every claim

### Why back on Studio

Version 1's consequence never moved money on the network it was judged on. On Studio Next
every escrow decision settled correctly, and every payment message failed in the fee layer
(`no_matching_allocation`), because the SDK's simulation could not compute the message
allocation for it. The same escrow source moved real money on Studio (chain 61999) before the
hackathon required Studio Next. Version 2 adds slashing and bonds, so every outcome now moves
value; a network where value messages do not execute would leave the whole milestone unproven.
The move is a port, not a new contract: the runner `py-genlayer:1jb45aa8…`, `from genlayer import *`, `gl.message_raw` for the
clock, `gl.get_contract_at` for the register read, `gl.vm.run_nondet_unsafe` for the round,
`_Payee(address).emit_transfer(value=…)` for value out, and genlayer-js 1.1.8 with no fee quotes.
Commit `6598572` was the map, read backwards.

### Why the stake is per claim

A passport is a list of claims, and a challenge can catch any one of them. A flat stake would
make a six-claim passport as cheap to fake as a one-claim one; a stake per claim makes the
money behind a passport grow with what it asserts. 0.5 GEN is small enough for a demo and large
enough that the slash is visible next to a 0.1 GEN bond. The amount is exact, on `register` and
on `update`: a payable call that accepts "at least" has to decide what to do with the rest, and
"exactly, or everything back" is one rule a caller cannot misread. A passport is issued only
when the stake covers every claim; `inspect` refuses before any validator is asked otherwise.

### Why half of the slash goes to the challenger and half stays

The challenger's half is the reward for doing the work everyone else relies on, paid in the
same transaction so that catching a swapped model is visibly worth something. The other half
stays in the register and is paid to nobody, on purpose. If the whole stake went to the
challenger, an operator who swapped models could have a second wallet challenge first and
recover the entire stake: the slash would cost them nothing. With half kept, being caught
costs at least half, whoever catches you. Sending that half to buyers was considered and
rejected: the register cannot tell a real buyer from a sock puppet of the operator, a pool
anybody can claim from is a pool the operator can drain, and the escrow already returns every
buyer's money in full when the passport is revoked.

### Why the cooldown is ten minutes, and per challenger

A challenge makes every validator call the agent's endpoint, so one address may challenge one
passport at most once in `CHALLENGE_COOLDOWN_SECONDS` (600). Ten minutes is short enough to show
two challenges in one demo and long enough that no single address can turn the endpoint into a
load test. The cooldown is counted per challenger and passport, not per passport, because a
per-passport cooldown is a lock: the operator's own second wallet could challenge every ten
minutes, get its bond back as the operator, and keep every stranger out for free. Per challenger,
nobody's challenge blocks anybody else's.

### Why a challenge is priced by the stake, and why a fee for settling nothing

A challenge that settles nothing must not be a free re-roll: a rival could otherwise ask again
and again until one round of judges happened to read a contradiction into an honest answer. The
first build charged a flat 0.1 GEN bond and a flat 0.01 GEN fee against a prize of half the
stake (up to 1.5 GEN). A review of that build found that a flat price against a growing prize, with a
cooldown counted per address, makes many cheap tries from many addresses a lottery. So the
price of a try is now a share of what it can win: the bond, paid to the operator when every
claim holds, is a tenth of the stake (a fifth of the prize); the fee, paid to the operator when
the answers settle nothing, is a twentieth (a tenth of the prize). The cooldown stays per
address, because a per-passport one would let the operator's own second wallet hold it, and
with the price tied to the prize, more addresses buy no better odds per try.

What keeps the odds low is that every validator asks the endpoint itself: a revoke needs the
leader and a majority each to see a slip independently, so an honest agent that slips one call
in three is revoked in about one round in twenty. `test_re_rolling_challenges_against_a_flaky_honest_agent_loses_money`
measures it: 300 tries at one slip in three, and 300 at one in ten, lose money under these
prices, and the same draws under the flat prices come out ahead at one in three. A wrong
accusation still costs the accuser and compensates the accused.

### Why the operator's inspection of a passport in force is a renewal

In version 1 the operator could re-inspect or update an issued passport at any time. With a
stake behind it, both are exits from under a challenge if any outcome applies: an operator who
swapped models could inspect their own agent, take the refusal with no stake slashed, and walk
on, or update the row and get the excess back. The first build of version 2 simply refused
both while the passport was in force. A review of that build found what that cost: a passport could no
longer be renewed, so every one lapsed at day 30 before it could be inspected again, and a
buyer could wait for that lapse to refund a job already delivered.

So `update` stays refused while a passport is in force, and `inspect` becomes a renewal there.
Every claim matching renews it from now. Any contradiction revokes it and slashes the whole
stake, all of it kept by the register (nobody is paid for catching yourself), so inspecting a
swapped model costs the operator more than a challenge would. Anything else changes nothing:
the passport stays as it was and is not renewed, so an inconclusive round can neither park it
as pending (an exit) nor extend it. A renewal needs a clock it can read, because it sets a new
issue date.

The refused-pair guard also tightened: version 1 checked it only while the status said refused,
so updating to the same endpoint and claims reopened the same question. Now an inspection of a
pair that was refused is refused whatever the status, and changing the endpoint or the claims
is the way back, as it always said.

### Why an endpoint that stops answering is suspended, then revoked

The first build let an agreed 4xx or 5xx revert the challenge with nothing stored. An audit
pointed out the exit: the battery is public and fixed, so an operator who swapped models could
answer 403 to exactly those prompts and keep the passport, and every escrow paying on it,
until it expired. Now `challenge` reads an agreed error. If it says the agent did not answer
(a 4xx, a 5xx, no answer at all), the round is stored as `unanswered`: the passport is
suspended (`is_valid` says no, so the escrow refunds a job settled meanwhile), nothing moves,
and the bond stays in credit. A later round in which the endpoint answers, a challenge or the
operator's own renewal, lifts the suspension. A round at least an hour after the first in which
it still does not answer revokes the passport and slashes the stake exactly as a contradiction
does. The hour is there because outages happen: one bad minute suspends, it does not slash.

A judge that could not be reached is a different failure. The validators agree on a transient
error only when both sides failed the same way, the agent or the judge, so a judge outage is
never counted as the agent's silence and stores nothing.

### Why an escrow job binds to the slash count

`is_valid` describes the passport now. A job describes work done over days. The first build
paid whenever `is_valid` said yes at settlement, so a passport revoked during the job, then
restaked under claims that still cover it and issued again, paid the operator for work run on
the revoked passport. Now the escrow reads the register's slash count for the agent when the
buyer first funds the job (a view, inside a try, so the payable call never raises) and pays only
if it is unchanged at settlement. A renewal does not slash, so it does not change what a job
pays. A count that could not be read at funding is read again at the buyer's next funding, and
until it is read the job binds to nothing and refunds.

### Why retire holds the stake for a day

`retire` ends the agent, but the passport stays in force for `RETIRE_HOLD_SECONDS` (one day) and
can still be challenged and slashed. Without the hold, an operator who saw a challenge coming
could retire and take the stake back in the same minute. With it, an escrow job funded against
the passport can still settle while it is in force, and once the hold has passed nothing can
settle against it: `is_valid` says no, the escrow checks the hold on its own clock as well, and
`unstake` hands the stake back. A day is long enough for a buyer or a watcher to act and short
enough for a demo to show the refusal and the return.

### Why the judge is asked four times

Version 1 asked each judged probe in two presentation orders. Version 2 also asks it in two
framings (does the answer meet the criterion; does it fail to meet it), because a judge that
leans toward "yes" agrees with itself in both orders and was invisible. The four readings must
agree, or the stored verdict is `inconclusive`; the disagreement lands in the value, never in a
tolerance. Each question is one plain question, and the answer word is read strictly. The
agent's answer now sits between two delimiter lines tagged with the start of the sha256 of the
fenced text. That is defence in depth, not a new guarantee: the fence already removes every
angle bracket, and the tag only means no answer could write the closing line even if one
survived.

