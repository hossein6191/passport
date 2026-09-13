# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

"""Escrow: money that can only reach an agent whose passport covers the job.

A buyer funds a job for one agent and one claim, and names the operator
address and the endpoint it is buying from. When the job is settled, the
escrow asks the Passport register, an ordinary synchronous view with no
model and no consensus, whether that agent holds an issued passport covering
that claim, and reads the row to check that it is still the row the buyer
bound to: the same operator, the same endpoint. If everything holds, the
named operator is paid. If the passport was refused, withdrawn or never
issued, or the name now belongs to somebody else, or the endpoint changed,
the buyer takes the money back instead. There is no path through this
contract that pays an agent without a passport, and none that pays whoever
happened to register a name first.

A name on the register is a handle, first come first served; it carries no
authority. Whoever pays must know the operator independently and say so
here. The register never decides that for them.

It is a fixture: small on purpose, and here to be read.
"""

import json
import typing
from genlayer import *

SETTLE_AFTER_DAYS = 7           # after this, the operator may settle too; the rule of payment is the same


def _now() -> str:
    """The one clock validators agree on: the message's own datetime.

    Measured: `gl.message_raw["datetime"]` is identical on every node for a
    transaction. There is no block timestamp. "" when the clock is not there,
    and then expiry is simply not enforced rather than guessed.
    """
    try:
        raw = gl.message_raw
        value = raw.get("datetime") if hasattr(raw, "get") else None
        return str(value) if value else ""
    except Exception:
        return ""


def _instant_seconds(iso: str) -> int:
    """Seconds since 1970-01-01 for an ISO-8601 UTC instant, integers only.

    Measured: floats and the datetime module trap the VM in deterministic
    mode ("wasm_trap DeterministicMode"), so the calendar is done by hand.
    -1 when the string cannot be read.
    """
    try:
        s = iso.strip()
        if s.endswith("Z"):
            s = s[:-1]
        elif s.endswith("+00:00"):
            s = s[:-6]
        date_part, _, time_part = s.partition("T")
        y, m, d = (int(x) for x in date_part.split("-"))
        parts = (time_part.split(":") + ["0", "0", "0"])[:3]
        hour, minute, second = int(parts[0] or "0"), int(parts[1] or "0"), int(parts[2].split(".")[0] or "0")
        if not (1 <= m <= 12 and 1 <= d <= 31 and 0 <= hour < 24 and 0 <= minute < 60 and 0 <= second < 60):
            return -1
        y2 = y - (1 if m <= 2 else 0)
        era = (y2 if y2 >= 0 else y2 - 399) // 400
        yoe = y2 - era * 400
        doy = (153 * (m + (-3 if m > 2 else 9)) + 2) // 5 + d - 1
        doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
        days = era * 146097 + doe - 719468
        return days * 86400 + hour * 3600 + minute * 60 + second
    except Exception:
        return -1


def _days_between(earlier: str, later: str) -> typing.Optional[int]:
    """Whole days from one ISO instant to another; None if either cannot be read."""
    a, b = _instant_seconds(earlier), _instant_seconds(later)
    if a < 0 or b < 0:
        return None
    return (b - a) // 86400


def _may_settle(caller_is_buyer: bool, caller_is_operator: bool, funded_at: str, now: str) -> bool:
    """The buyer may settle at any time; the operator once the job is SETTLE_AFTER_DAYS old.

    A missing clock never opens the operator's path early: no clock, no deadline.
    """
    if caller_is_buyer:
        return True
    if not caller_is_operator:
        return False
    days = _days_between(funded_at, now) if funded_at and now else None
    return days is not None and days >= SETTLE_AFTER_DAYS


def _covers(valid: bool, row_operator: str, row_endpoint: str, operator: str, endpoint: str) -> bool:
    """The job pays only when the passport is valid AND the row under the name is
    the one the buyer bound to: the operator address and the endpoint the buyer
    knew when funding. The name alone proves nothing; whoever registered it first
    holds it, and that is a wallet's assertion, not authority.
    """
    if not valid:
        return False
    return str(row_operator).lower() == str(operator).lower() and str(row_endpoint).strip() == str(endpoint).strip()


@gl.evm.contract_interface
class _Payee:
    class View:
        pass

    class Write:
        pass


class Escrow(gl.Contract):
    register: Address
    agent_id: str
    claim_id: str
    buyer: Address
    pool: u256
    settled: bool
    outcome_json: str
    funded_at: str          # message clock of the first funding; the operator's deadline counts from here
    operator: Address       # the operator the buyer is buying from; the only address this job can pay besides the buyer
    endpoint: str           # the endpoint the buyer is buying from; the row must still carry it

    def __init__(self, register: str, agent_id: str, claim_id: str, operator: str, endpoint: str) -> None:
        self.register = Address(register)
        self.agent_id = agent_id.strip().lower()
        self.claim_id = claim_id.strip().lower()
        self.buyer = gl.message.sender_address
        self.pool = u256(0)
        self.settled = False
        self.outcome_json = "{}"
        self.funded_at = ""
        self.operator = Address(operator)
        self.endpoint = endpoint.strip()

    @gl.public.write.payable
    def fund(self) -> str:
        """Add to the job. Anybody may. Never raises: value sent to a refused
        payable call is stranded by the chain, so a refusal refunds and says why."""
        value = gl.message.value
        if self.settled:
            if value > u256(0):
                _Payee(gl.message.sender_address).emit_transfer(value=value)
            return json.dumps({"ok": False, "reason": "this job has already been settled; your funds were returned"})
        if value == u256(0):
            return json.dumps({"ok": False, "reason": "send an amount greater than zero"})
        self.pool = self.pool + value
        if not self.funded_at:
            self.funded_at = _now()
        return json.dumps({"ok": True, "pool": str(int(self.pool))})

    def _holder(self) -> dict:
        register = gl.get_contract_at(self.register)
        valid = bool(register.view().is_valid(str(self.agent_id), str(self.claim_id)))
        record = json.loads(str(register.view().passport(str(self.agent_id))))
        row_operator = str(record.get("operator") or "")
        row_endpoint = str(record.get("endpoint") or "")
        covers = _covers(valid, row_operator, row_endpoint, self.operator.as_hex, str(self.endpoint))
        return {"valid": valid, "covers": covers, "status": record.get("status"),
                "row_operator": row_operator, "row_endpoint": row_endpoint}

    @gl.public.write
    def release(self) -> str:
        """Pay the named operator if the passport covers the claim and the row is
        the one the buyer bound to; otherwise refund the buyer.

        The buyer may settle at any time. The operator may settle once the job
        is SETTLE_AFTER_DAYS old, so a buyer cannot sit on a finished job
        forever, and the rule of payment is the same whoever calls.
        """
        if self.settled:
            raise gl.vm.UserError("[EXPECTED] this job has already been settled")
        if self.pool == u256(0):
            raise gl.vm.UserError("[EXPECTED] there is nothing in the job")
        holder = self._holder()
        sender = gl.message.sender_address
        is_buyer = sender == self.buyer
        is_operator = sender == self.operator
        if not _may_settle(is_buyer, is_operator, str(self.funded_at), _now()):
            raise gl.vm.UserError("[EXPECTED] only the buyer settles this job, or its operator once it is "
                                  + str(SETTLE_AFTER_DAYS) + " days old")
        amount = self.pool
        if holder["covers"]:
            payee = self.operator
            paid = "operator"
        else:
            payee = self.buyer
            paid = "buyer"
        _Payee(payee).emit_transfer(value=amount)
        self.pool = u256(0)
        self.settled = True
        outcome = {"passport": str(holder.get("status")), "valid": bool(holder["valid"]), "bound": bool(holder["covers"]),
                   "paid": paid, "to": payee.as_hex, "amount": str(int(amount)),
                   "settled_by": "buyer" if is_buyer else "operator"}
        self.outcome_json = json.dumps(outcome)
        return json.dumps({"ok": True, **outcome})

    @gl.public.view
    def would_pay(self) -> str:
        holder = self._holder()
        return "operator" if holder["covers"] else "buyer"

    @gl.public.view
    def status(self) -> str:
        return json.dumps({
            "register": self.register.as_hex, "agent": str(self.agent_id), "claim": str(self.claim_id),
            "operator": self.operator.as_hex, "endpoint": str(self.endpoint),
            "buyer": self.buyer.as_hex, "pool": str(int(self.pool)), "settled": bool(self.settled),
            "funded_at": str(self.funded_at), "settle_after_days": SETTLE_AFTER_DAYS,
            "operator_may_settle": _may_settle(False, True, str(self.funded_at), _now()),
            "outcome": json.loads(str(self.outcome_json)),
        })
