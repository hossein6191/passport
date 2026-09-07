# Decisions

## The boundary, written before the code

- **Frontend owns:** the registry page, the register/update form, the "inspect" button, reading passports.
- **Passport contract owns:** the closed set of claims, the public battery, the inspection (each validator
  talks to the agent itself), the three-word verdicts, issue/refuse/pending, the refused-key guard, `is_valid`.
- **External sources own:** the agent's answers. They are untrusted: fenced by replacement at the prompt
  boundary, never stored unfenced into a prompt, and never compared across validators — only the verdicts are.
- **Escrow fixture owns:** the consequence. Pays the operator only while `is_valid` says so; otherwise the buyer.

User action → evidence → nondet call → equivalence → state → settlement:
`inspect(agent)` → each validator POSTs the battery to the endpoint → keyword probes decided in code, judged
probes asked in two presentation orders → validators compare the verdict word per claim, exactly → status
issued / refused / pending → `Escrow.release()` reads `is_valid` and pays or refunds.

## Why the answer is three words

What crosses consensus is `matches / contradicts / inconclusive` per claim. Agent answers vary per call
(temperature, load); verdicts do not have to. "Inconclusive" is where uncertainty lives — never a tolerance
in the validator. Two presentation orders per judged probe turn an ordering bias into a disagreement that
lands in the value.

## Why this is not a proof

No method identifies the model behind an endpoint. Passport records five independent observers agreeing
on behaviour against public probes. The README and `rules()` say so in those words.

## The clock, and why it is done by hand

There is no block timestamp. `gl.message_raw["datetime"]` is the one instant every node
sees identically for a transaction — and for a read. Passports are issued with it and
expire 30 days later by it. The interval is computed with integers only: the first
version used `datetime.fromisoformat` and a float division, passed lint and every pure
test, and killed the VM on chain with `wasm_trap DeterministicMode` the first time a
view touched a real date. A clock that cannot be read means *no* expiry, not a guess.

## Why the battery is public

A hidden battery would be a secret the contract cannot keep — the source is on chain.
Public probes also make the verdicts explainable: a refused passport says which probe
failed and why. An agent that prepares for known questions is still an agent that
answers them; the claim is about behaviour, not about surprise.

## Why a refused pair cannot be asked again

Inspection costs consensus and the agent's operator does not pay for it. Without the
guard, a refused operator could ask until a lucky run issued. The way out is honest:
change the endpoint or the claims, which resets the passport and reopens inspection.

## Where the agents live

The register stores an HTTPS endpoint and validators fetch it themselves, so the demo
agents have to be reachable from Studio for minutes at a time. They are a Vercel
function. During development they sat behind a tunnel from a laptop — localtunnel
answered 3 of 12 concurrent requests and died mid-inspection; tunnelmole held — but
nothing on chain points at a tunnel.
