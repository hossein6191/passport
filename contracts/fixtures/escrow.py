# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

"""Escrow: money that can only reach an agent whose passport covers the job.

A buyer funds a job for one agent and one claim. When the buyer releases,
the escrow asks the Passport register — an ordinary synchronous view, no
model, no consensus — whether that agent holds an issued passport covering
that claim. If yes, the operator is paid. If the passport was refused,
withdrawn or never issued, the buyer takes the money back instead. There is
no path through this contract that pays an agent without a passport.

It is a fixture: small on purpose, and here to be read.
"""

import json
from genlayer import *


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

    def __init__(self, register: str, agent_id: str, claim_id: str) -> None:
        self.register = Address(register)
        self.agent_id = agent_id.strip().lower()
        self.claim_id = claim_id.strip().lower()
        self.buyer = gl.message.sender_address
        self.pool = u256(0)
        self.settled = False
        self.outcome_json = "{}"

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
        return json.dumps({"ok": True, "pool": str(int(self.pool))})

    def _holder(self) -> dict:
        register = gl.get_contract_at(self.register)
        valid = bool(register.view().is_valid(str(self.agent_id), str(self.claim_id)))
        record = json.loads(str(register.view().passport(str(self.agent_id))))
        return {"valid": valid, "operator": record.get("operator"), "status": record.get("status")}

    @gl.public.write
    def release(self) -> str:
        """Pay the operator if the passport covers the claim; otherwise refund the buyer. Buyer only, once."""
        if gl.message.sender_address != self.buyer:
            raise gl.vm.UserError("[EXPECTED] only the buyer settles this job")
        if self.settled:
            raise gl.vm.UserError("[EXPECTED] this job has already been settled")
        if self.pool == u256(0):
            raise gl.vm.UserError("[EXPECTED] there is nothing in the job")
        holder = self._holder()
        amount = self.pool
        if holder["valid"] and holder.get("operator"):
            payee = Address(str(holder["operator"]))
            paid = "operator"
        else:
            payee = self.buyer
            paid = "buyer"
        _Payee(payee).emit_transfer(value=amount)
        self.pool = u256(0)
        self.settled = True
        outcome = {"passport": str(holder.get("status")), "paid": paid, "to": payee.as_hex, "amount": str(int(amount))}
        self.outcome_json = json.dumps(outcome)
        return json.dumps({"ok": True, **outcome})

    @gl.public.view
    def would_pay(self) -> str:
        holder = self._holder()
        return "operator" if holder["valid"] else "buyer"

    @gl.public.view
    def status(self) -> str:
        return json.dumps({
            "register": self.register.as_hex, "agent": str(self.agent_id), "claim": str(self.claim_id),
            "buyer": self.buyer.as_hex, "pool": str(int(self.pool)), "settled": bool(self.settled),
            "outcome": json.loads(str(self.outcome_json)),
        })
