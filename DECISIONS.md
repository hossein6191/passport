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
