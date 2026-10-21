"""Mutate every defence and record which test killed each mutant.

A passing count is a claim. This table is evidence: each row names a change
that removes or inverts one defence in contracts/passport.py or
contracts/fixtures/escrow.py and the test that failed because of it. If any
mutant survives, no table is written and the exit code is 1: a defence with no
test that can fail is a defence that can be deleted by accident.

    uv run --python 3.12 --with pytest==9.1.1 python tools/mutate.py     # writes tests/MUTATIONS.md
"""
import os
import pathlib
import re
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = (ROOT / "contracts" / "passport.py").read_text(encoding="utf-8")
ESRC = (ROOT / "contracts" / "fixtures" / "escrow.py").read_text(encoding="utf-8")
PYTEST = [sys.executable, "-m", "pytest", "-q", "-x", "--no-header", "-p", "no:cacheprovider", str(ROOT / "tests" / "test_pure.py")]

MUTATIONS = [
    # ---- the prompt
    ("fence does nothing",
     'return str(raw).replace("<", "(").replace(">", ")")', 'return str(raw)'),
    ("fence deletes instead of replacing",
     'return str(raw).replace("<", "(").replace(">", ")")', 'return str(raw).replace("<", "").replace(">", "")'),
    ("the delimiter tag is not the body's own hash",
     'tag = _sha256(body)[:TAG_CHARS]', 'tag = "0" * TAG_CHARS'),
    ("the answer-first order prints the criterion first",
     '    if answer_first:\n        parts[2], parts[3] = parts[3], parts[2]\n', ''),
    ("the word list is never reversed",
     '    if answer_first:\n        options.reverse()\n', ''),
    ("the criterion reaches the judge unfenced",
     '"CRITERION: " + _fence(probe["criteria"])', '"CRITERION: " + probe["criteria"]'),
    # ---- reading the judge
    ("the judge may answer anything",
     '    if word not in ANSWER_WORDS:\n        raise', '    if False:\n        raise'),
    ("the reason is not capped",
     'reason = str(raw.get("reason", "")).strip()[:MAX_REASON_CHARS]', 'reason = str(raw.get("reason", "")).strip()'),
    ("a yes to the failing framing counts as a match",
     '        return MATCHES if meets else CONTRADICTS', '        return MATCHES'),
    ("the four readings need not agree",
     '    if all(r == first for r in readings[:len(ASKINGS)]) and len(readings) == len(ASKINGS):', '    if True:'),
    ("a contradiction no longer refuses a claim",
     '    if any(v == CONTRADICTS for v in votes[:len(BATTERY)]):\n        return CONTRADICTS\n', ''),
    ("the injection probe rewards obedience",
     'return CONTRADICTS if probe["expect"].lower() in text else MATCHES', 'return MATCHES if probe["expect"].lower() in text else CONTRADICTS'),
    ("another maker no longer contradicts a family claim",
     '            if other != family and any(w in text for w in FAMILY_WORDS[other]):\n                return CONTRADICTS\n',
     '            if other != family and any(w in text for w in FAMILY_WORDS[other]):\n                pass\n'),
    ("a passport is issued without every claim matching",
     '        if words and all(w == MATCHES for w in words[:MAX_CLAIMS]):\n            agent.status = STATUS_ISSUED',
     '        if words:\n            agent.status = STATUS_ISSUED'),
    # ---- consensus
    ("the validator agrees without deriving the value itself",
     '            try:\n                mine = leader_fn()\n            except Exception:\n                return False        # this node could not derive the value itself, so it has not agreed\n',
     '            return True\n'),
    ("a validator whose own judge fails counts as agreeing",
     'return False        # this node could not derive the value itself, so it has not agreed', 'return True'),
    ("an agent's 4xx is classed as transient",
     'raise gl.vm.UserError(ERROR_EXTERNAL + " the agent answered " + str(status))',
     'raise gl.vm.UserError(ERROR_TRANSIENT + " the agent answered " + str(status))'),
    ("a leader's failure is agreed with whatever its message",
     '            return mine == leader_msg', '            return True'),
    ("a judge outage is agreed as the agent's silence",
     '            return _agent_silent(mine) == _agent_silent(leader_msg)', '            return True'),
    # ---- the door
    ("claims outside the closed set are accepted",
     '        if claim not in CLAIM_IDS:\n            return [], "unknown claim "', '        if False:\n            return [], "unknown claim "'),
    ("two model families are accepted",
     '    if len(families) > 1:\n', '    if False:\n'),
    ("http endpoints are accepted",
     'if not endpoint.startswith("https://") or len(endpoint)', 'if len(endpoint)'),
    # ---- the stake
    ("register takes any stake",
     '        if not problem and value != _stake_needed(claims):', '        if False:'),
    ("a payable refusal keeps the value sent",
     '    if value > 0:\n        _Payee(sender).emit_transfer(value=u256(value))\n', ''),
    ("update takes any top-up",
     '        if not problem and value != top_up:', '        if False:'),
    ("update keeps the excess stake",
     '            _Payee(sender).emit_transfer(value=u256(excess))\n', '            pass\n'),
    ("a passport is inspected without its stake covering every claim",
     '        if int(agent.stake) < _stake_needed(claims):', '        if False:'),
    # ---- authority
    ("anyone may update",
     '        if _low(sender) != _low(agent.operator):\n            return _refund(sender, value, "only the operator of " + agent_id + " may do that")\n', ''),
    ("anyone may inspect, retire or unstake",
     '        if _low(gl.message.sender_address) != _low(agent.operator):\n            _fail("only the operator of " + agent_id + " may do that")\n', ''),
    ("the operator may challenge their own passport",
     '        if me == _low(agent.operator):', '        if False:'),
    # ---- a passport in force
    ("a passport in force can be updated out from under a challenge",
     '        elif self._live(agent, _now()):\n            problem = (', '        elif False:\n            problem = ('),
    ("the operator's inspection of a passport in force is an ordinary one: a refusal with the stake intact",
     '        renewal = self._live(agent, now)', '        renewal = False'),
    ("a renewal that finds a contradiction slashes nothing",
     '            self._slash(agent, {"slashed": stake, "to_challenger": 0, "kept": stake})', '            pass'),
    ("a renewal does not renew the issue date",
     '            agent.issued_at = now\n', ''),
    ("a renewal goes ahead with no clock",
     '            now, _seconds = _clock()', '            pass'),
    ("a refused pair can be inspected again unchanged",
     '        if str(agent.refused_key) and str(agent.refused_key) == key:', '        if False:'),
    ("the refused-pair guard holds only while the status is refused, so a no-op update reopens it",
     'if str(agent.refused_key) and str(agent.refused_key) == key:',
     'if str(agent.status) == STATUS_REFUSED and str(agent.refused_key) == key:'),
    ("a revoked passport does not record its refused pair",
     '        agent.refused_key = key\n', ''),
    ("a retired agent can be inspected",
     '        if str(agent.retired_at):\n            _fail("that agent was retired by its operator")', '        if False:\n            _fail("x")'),
    # ---- the clock
    ("a passport never expires",
     '    return days < 0 or days >= VALID_DAYS', '    return False'),
    ("a clock that went backwards is trusted",
     '    return days < 0 or days >= VALID_DAYS', '    return days >= VALID_DAYS'),
    ("a missing clock counts as expired",
     '    if not issued_at or not now:\n        return False\n', '    if not issued_at or not now:\n        return True\n'),
    ("a timed write goes ahead with no clock",
     '    if seconds < 0:\n        _fail("no readable clock', '    if False:\n        _fail("no readable clock'),
    # ---- challenges
    ("a passport that is not in force can be challenged",
     '        if not self._live(agent, now):\n            _fail("only an issued', '        if False:\n            _fail("only an issued'),
    ("no cooldown between challenges",
     '    return now_seconds - last >= CHALLENGE_COOLDOWN_SECONDS', '    return True'),
    ("a challenge needs no credit",
     '        if held < bond:', '        if False:'),
    ("a passport with no stake behind it is challenged",
     '        if stake < 1:\n            _fail("this passport has no stake behind it")', '        if False:\n            _fail("x")'),
    ("a revoke pays the challenger the whole stake",
     '        to_challenger = stake // 2', '        to_challenger = stake'),
    ("a revoke leaves the stake in place",
     '        agent.stake = u256(0)\n        agent.slashed', '        agent.slashed'),
    ("a challenge that settled pays the operator nothing",
     '"from_credit": price, "to_operator": price}', '"from_credit": price, "to_operator": 0}'),
    ("an inconclusive challenge costs the whole bond",
     'price = _challenge_bond(stake) if outcome == OUTCOME_HELD else _challenge_fee(stake)', 'price = _challenge_bond(stake)'),
    ("a challenge that held costs only the fee",
     'price = _challenge_bond(stake) if outcome == OUTCOME_HELD else _challenge_fee(stake)', 'price = _challenge_fee(stake)'),
    ("the bond is flat, not a share of the stake at risk",
     '    return stake // CHALLENGE_BOND_SHARE', '    return GEN_ATTO // 10'),
    ("the fee is flat, not a share of the stake at risk",
     '    return stake // CHALLENGE_FEE_SHARE', '    return GEN_ATTO // 100'),
    ("an inconclusive challenge counts as held",
     '    if all(w == MATCHES for w in words[:MAX_CLAIMS]):\n        return OUTCOME_HELD', '    if True:\n        return OUTCOME_HELD'),
    ("an inconclusive challenge revokes",
     '    if any(w == CONTRADICTS for w in words[:MAX_CLAIMS]):\n        return OUTCOME_REVOKED\n    if all(',
     '    if not all(w == MATCHES for w in words[:MAX_CLAIMS]):\n        return OUTCOME_REVOKED\n    if all('),
    # ---- an endpoint that stops answering
    ("an endpoint that refuses the battery escapes the challenge",
     '            if _agent_silent(message):\n                return {}, {}, message[:MAX_REASON_CHARS]\n', ''),
    ("a judge outage counts as the agent's silence",
     'or message.startswith(ERROR_TRANSIENT + " the agent")', 'or message.startswith(ERROR_TRANSIENT)'),
    ("a second silent round inside the hour revokes",
     '    if first < 0 or now_seconds - first < SILENCE_GRACE_SECONDS:', '    if first < 0 or now_seconds - first < 0:'),
    ("silence never revokes",
     '    return OUTCOME_REVOKED\n\n\ndef _renewal_outcome', '    return OUTCOME_UNANSWERED\n\n\ndef _renewal_outcome'),
    ("a silent round does not suspend the passport",
     '            if not str(agent.silent_since):\n                agent.silent_since = now\n', '            pass\n'),
    ("is_valid ignores a suspension",
     '        if not self._live(agent, _now()) or str(agent.silent_since):', '        if not self._live(agent, _now()):'),
    ("a challenge the endpoint answered does not lift the suspension",
     '        else:\n            agent.silent_since = ""\n        if outcome == OUTCOME_REVOKED:',
     '        else:\n            pass\n        if outcome == OUTCOME_REVOKED:'),
    ("a renewal the endpoint answered does not lift the suspension",
     '        agent.silent_since = ""                     # the endpoint answered the battery\n', ''),
    # ---- retiring and credit
    ("retire ends the passport and frees the stake at once",
     '    return b - a >= RETIRE_HOLD_SECONDS', '    return True'),
    ("is_valid ignores the hold after retire",
     '    return not _hold_over(str(agent.retired_at), now)', '    return True'),
    ("unstake before the hold has passed",
     '        if not _hold_over(str(agent.retired_at), now):\n            ends', '        if False:\n            ends'),
    ("unstake can be repeated",
     '        agent.stake = u256(0)\n        self.staked_total = u256(int(self.staked_total) - amount)',
     '        self.staked_total = u256(int(self.staked_total) - amount)'),
    ("deposit credits nothing",
     '        self.credit[me] = u256(held)\n', ''),
    ("withdraw can be repeated",
     '        self.credit[me] = u256(0)\n', ''),
    # ---- the escrow
    ("escrow: the operator may settle at once",
     '    return days is not None and days >= SETTLE_AFTER_DAYS', '    return True', "escrow"),
    ("escrow: a stranger may settle",
     '    if not caller_is_operator:\n        return False\n', '', "escrow"),
    ("escrow: a squatter holding the name is paid",
     '    return str(row_operator).lower() == str(operator).lower() and str(row_endpoint).strip() == str(endpoint).strip()',
     '    return str(row_endpoint).strip() == str(endpoint).strip()', "escrow"),
    ("escrow: a changed endpoint is still paid",
     '    return str(row_operator).lower() == str(operator).lower() and str(row_endpoint).strip() == str(endpoint).strip()',
     '    return str(row_operator).lower() == str(operator).lower()', "escrow"),
    ("escrow: an invalid passport is still paid",
     '    if not valid:\n        return False\n', '', "escrow"),
    ("escrow: an expired passport is still paid",
     'not _expired(str(record.get("issued_at") or ""), now)', 'True', "escrow"),
    ("escrow: a passport retired past its hold is still paid",
     'and not _hold_over(str(record.get("retired_at") or ""), now))', 'and True)', "escrow"),
    ("escrow: anybody's wei starts the operator's clock",
     '        if not self.funded_at and gl.message.sender_address == self.buyer:', '        if not self.funded_at:', "escrow"),
    ("escrow: an unreadable register locks the job",
     '        except Exception:\n            return {"valid": False, "covers": False, "status": "unreadable", "row_operator": "", "row_endpoint": "",\n                    "unrevoked": False}',
     '        except Exception:\n            raise', "escrow"),
    ("escrow: a job funded before a revoke pays once the passport is issued again",
     '    return bool(mark_then) and mark_then == mark_now', '    return True', "escrow"),
    ("escrow: anybody's money reads the revoke count the job binds to",
     '        if not self.funded_mark and gl.message.sender_address == self.buyer:', '        if not self.funded_mark:', "escrow"),
    ("escrow: money sent to a settled job is kept",
     '            if value > u256(0):\n                _Payee(gl.message.sender_address).emit_transfer(value=value)\n', '', "escrow"),
]


def _fresh_env(**extra):
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    env.update(extra)
    return env


def run(mutant_path: pathlib.Path, escrow_path: pathlib.Path) -> str:
    env = _fresh_env(PASSPORT_SOURCE=str(mutant_path), ESCROW_SOURCE=str(escrow_path))
    out = subprocess.run(PYTEST, env=env, capture_output=True, text=True, cwd=ROOT)
    if out.returncode == 0:
        return ""
    text = out.stdout + out.stderr
    if "error during collection" in text or "IndentationError" in text or "SyntaxError" in text:
        raise RuntimeError("the mutant does not even import; that is a broken anchor, not a killed defence")
    m = re.search(r"FAILED tests/test_pure\.py::(\S+)", text)
    if not m:
        raise RuntimeError("a test failed but its name could not be read:\n" + text[-800:])
    return m.group(1)


def main() -> int:
    baseline = subprocess.run(PYTEST, env=_fresh_env(), capture_output=True, text=True, cwd=ROOT)
    if baseline.returncode != 0:
        print("the unmutated suite does not pass; a mutation table over a failing suite proves nothing")
        print((baseline.stdout + baseline.stderr)[-600:]); return 3
    rows, escaped = [], []
    with tempfile.TemporaryDirectory() as tmp:
        for entry in MUTATIONS:
            name, old, new = entry[0], entry[1], entry[2]
            target = entry[3] if len(entry) > 3 else "passport"
            base = ESRC if target == "escrow" else SRC
            if base.count(old) != 1:
                print(f"  ! mutation anchor not found exactly once ({base.count(old)}): {name}"); return 2
            k = len(rows) + len(escaped)
            path = pathlib.Path(tmp) / f"passport_{k}.py"
            epath = pathlib.Path(tmp) / f"escrow_{k}.py"
            path.write_text(base.replace(old, new) if target == "passport" else SRC, encoding="utf-8")
            epath.write_text(base.replace(old, new) if target == "escrow" else ESRC, encoding="utf-8")
            killer = run(path, epath)
            (rows if killer else escaped).append((name, killer))
            print(f"  {'killed ' if killer else 'ESCAPED'}  {name}" + (f"  <- {killer}" if killer else ""))
    if escaped:
        print(f"\n{len(escaped)} mutant(s) escaped; no table written."); return 1
    table = ["# Mutations", "",
             f"{len(rows)} defences in `contracts/passport.py` and `contracts/fixtures/escrow.py`, each removed or "
             "inverted in turn, and the test that failed because of it. Generated by `tools/mutate.py`; it refuses to "
             "write this file if any mutant survives.", "",
             "| defence removed | killed by |", "|---|---|"] + [f"| {n} | `{k}` |" for n, k in rows] + [""]
    (ROOT / "tests" / "MUTATIONS.md").write_text("\n".join(table), encoding="utf-8")
    print(f"\n{len(rows)} / {len(rows)} killed · tests/MUTATIONS.md written"); return 0


if __name__ == "__main__":
    sys.exit(main())
