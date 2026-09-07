"""Mutate every defence and record which test killed each mutant.

A passing count is a claim. This table is evidence: each row names a change
that removes or inverts one defence in contracts/passport.py and the test
that failed because of it. If any mutant survives, no table is written and
the exit code is 1 — a defence with no test that can fail is a defence that
can be deleted by accident.

    python tools/mutate.py            # writes tests/MUTATIONS.md
"""
import os
import pathlib
import re
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = (ROOT / "contracts" / "passport.py").read_text(encoding="utf-8")
PYTEST = [sys.executable, "-m", "pytest", "-q", "-x", "--no-header", "-p", "no:cacheprovider", str(ROOT / "tests" / "test_pure.py")]

MUTATIONS = [
    ("fence does nothing",
     'return str(raw).replace("<", "(").replace(">", ")")', 'return str(raw)'),
    ("fence deletes instead of replacing",
     'return str(raw).replace("<", "(").replace(">", ")")', 'return str(raw).replace("<", "").replace(">", "")'),
    ("a contradiction no longer refuses",
     '    if any(v == CONTRADICTS for v in votes):\n        return CONTRADICTS\n', ''),
    ("the injection probe rewards obedience",
     'return CONTRADICTS if probe["expect"].lower() in text else MATCHES', 'return MATCHES if probe["expect"].lower() in text else CONTRADICTS'),
    ("another maker no longer contradicts a family claim",
     '            if other != family and any(w in text for w in other_words):\n                return CONTRADICTS\n',
     '            if other != family and any(w in text for w in other_words):\n                pass\n'),
    ("anyone may update or withdraw",
     '        if gl.message.sender_address != agent.operator:\n            _fail("only the operator of " + agent_id + " may do that")\n', ''),
    ("a refused pair can be re-inspected unchanged",
     '        if agent.status == STATUS_REFUSED and str(agent.refused_key) == key:\n            _fail("this endpoint with these claims was already refused; change one of them before asking again")\n', ''),
    ("claims outside the closed set are accepted",
     '            if claim not in CLAIM_IDS:\n                _fail("unknown claim " + claim[:40] + "; the battery only tests " + ", ".join(CLAIM_IDS))\n', ''),
    ("two model families are accepted",
     '        if len(families) > 1:\n            _fail("an agent has one model family, not " + str(len(families)))\n', ''),
    ("http endpoints are accepted",
     'if not endpoint.startswith("https://") or', 'if'),
    ("the second presentation order is the first one",
     '    if reverse:\n        options.reverse()\n', ''),
    ("the criterion reaches the judge unfenced",
     '"CRITERION: " + _fence(probe["criteria"])', '"CRITERION: " + probe["criteria"]'),
    ("the judge may answer anything",
     '    if verdict not in VERDICTS:\n        raise gl.vm.UserError(ERROR_LLM + " the judge returned a verdict outside the set: " + verdict[:40])\n', ''),
    ("the reason is not capped",
     'reason = str(raw.get("reason", "")).strip()[:MAX_REASON_CHARS]', 'reason = str(raw.get("reason", "")).strip()'),
    ("a passport never expires",
     '    days = _days_between(issued_at, now)\n    return days < 0 or days >= VALID_DAYS', '    return False'),
    ("a missing clock counts as expired",
     '    if not issued_at or not now:\n        return False\n', '    if not issued_at or not now:\n        return True\n'),
]


def run(mutant_path: pathlib.Path) -> str:
    env = dict(os.environ, PASSPORT_SOURCE=str(mutant_path))
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
    rows, escaped = [], []
    with tempfile.TemporaryDirectory() as tmp:
        for name, old, new in MUTATIONS:
            if SRC.count(old) != 1:
                print(f"  ! mutation anchor not found exactly once: {name}"); return 2
            path = pathlib.Path(tmp) / "passport.py"
            path.write_text(SRC.replace(old, new), encoding="utf-8")
            killer = run(path)
            (rows if killer else escaped).append((name, killer))
            print(f"  {'killed ' if killer else 'ESCAPED'}  {name}" + (f"  ← {killer}" if killer else ""))
    if escaped:
        print(f"\n{len(escaped)} mutant(s) escaped; no table written."); return 1
    table = ["# Mutations", "", f"{len(rows)} defences in `contracts/passport.py`, each removed or inverted in turn, and the test that failed because of it. "
             "Generated by `tools/mutate.py`; it refuses to write this file if any mutant survives.", "",
             "| defence removed | killed by |", "|---|---|"] + [f"| {n} | `{k}` |" for n, k in rows] + [""]
    (ROOT / "tests" / "MUTATIONS.md").write_text("\n".join(table), encoding="utf-8")
    print(f"\n{len(rows)} / {len(rows)} killed · tests/MUTATIONS.md written"); return 0


if __name__ == "__main__":
    sys.exit(main())
