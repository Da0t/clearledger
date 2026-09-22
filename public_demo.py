"""Isolated stateless hosting adapter for the ClearLedger Python engine.

Each browser tab owns a bounded command transcript. Every public request rebuilds
that tab's sandbox on the server. No money or shared customer data is stored, and
serverless cold starts cannot mix or silently reset another visitor's session.
This is explicitly a replayable demo, not a durable hosted financial service.
"""
from datetime import datetime, timezone
import itertools
from pathlib import Path
import re
import subprocess
import tempfile
from typing import Literal
from uuid import NAMESPACE_URL, uuid4, uuid5

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from clearledger.ledger import Ledger, LedgerError
from clearledger.api import Event, Refund, Hold, Resolve, Provider

ROOT = Path(__file__).resolve().parent
router = APIRouter(tags=["Public sandboxes"])
MAX_COMMANDS = 200


class Command(BaseModel):
    model_config = ConfigDict(extra="forbid")
    path: str = Field(max_length=220)
    body: dict = Field(default_factory=dict)
    at: datetime
    nonce: str = Field(pattern=r"^[a-f0-9]{8}$")


class Session(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[1] = 1
    started_at: datetime
    history: list[Command] = Field(default_factory=list, max_length=MAX_COMMANDS)


class Envelope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    path: str = Field(max_length=220)
    body: dict | None = None
    session: Session


def ledger_command(ledger, command):
    path, data = command.path, command.body
    ledger.clock = lambda: command.at.isoformat()
    if path == "/api/ledger/incident":
        return ledger.incident(command.nonce)
    if path == "/api/ledger/events":
        p = Event.model_validate(data)
        return ledger.receive(p.event_id, p.payment_id, p.amount)
    if match := re.fullmatch(r"/api/ledger/events/([^/]{1,100})/retry", path):
        return ledger.process(match[1])
    if path == "/api/ledger/refunds":
        p = Refund.model_validate(data)
        return ledger.refund(p.payment_id, p.amount, p.key)
    if path == "/api/ledger/holds":
        p = Hold.model_validate(data)
        return ledger.hold(p.hold_id, p.amount)
    if match := re.fullmatch(r"/api/ledger/holds/([^/]{1,100})/resolve", path):
        p = Resolve.model_validate(data)
        return ledger.resolve_hold(match[1], p.action, p.key)
    if path == "/api/ledger/provider-records":
        p = Provider.model_validate(data)
        return ledger.import_provider(p.record_id, p.payment_id, p.kind, p.amount)
    raise ValueError("Unsupported ledger operation")


def execute(envelope):
    session = envelope.session.model_copy(deep=True)
    path = envelope.path
    state_read = path == "/api/ledger/state"
    if not state_read and len(session.history) >= MAX_COMMANDS:
        raise ValueError("This sandbox reached 200 actions. Use New session to start again.")
    current = Command(path=path, body=envelope.body or {}, at=datetime.now(timezone.utc), nonce=uuid4().hex[:8])
    if path.startswith("/api/ledger/"):
        if any(not c.path.startswith("/api/ledger/") for c in session.history):
            raise ValueError("Mixed project transcripts are not supported")
        with tempfile.TemporaryDirectory(prefix="clearledger-") as directory:
            sequence = itertools.count()
            ledger = Ledger(Path(directory)/"sandbox.sqlite", clock=lambda:session.started_at.isoformat(),
                id_factory=lambda:uuid5(NAMESPACE_URL, f"{session.started_at.isoformat()}:{next(sequence)}"))
            ledger.seed()
            for command in session.history:
                ledger_command(ledger, command)
            value = ledger.snapshot() if state_read else ledger_command(ledger, current)
    else:
        raise ValueError("Unsupported sandbox route")
    if not state_read:
        session.history.append(current)
    return {"value": value, "session": session.model_dump(mode="json")}


@router.post("/api/demo")
async def demo(request: Request):
    # Bound both request-body allocation and re-execution work for an anonymous demo.
    if int(request.headers.get("content-length", "0")) > 100_000:
        raise HTTPException(413, "Sandbox request is too large")
    payload = bytearray()
    async for chunk in request.stream():
        payload.extend(chunk)
        if len(payload) > 100_000:
            raise HTTPException(413, "Sandbox request is too large")
    try:
        envelope = Envelope.model_validate_json(payload)
        from starlette.concurrency import run_in_threadpool
        return await run_in_threadpool(execute, envelope)
    except (ValidationError, ValueError, LedgerError) as exc:
        detail = "Invalid sandbox input" if isinstance(exc, ValidationError) else str(exc)
        raise HTTPException(409, detail) from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(503, "Sandbox execution timed out. Start a new session.") from exc
