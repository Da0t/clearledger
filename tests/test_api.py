import pytest
from fastapi.testclient import TestClient
import clearledger.api as ledger_api
from clearledger.ledger import Ledger
from app import create_app

@pytest.fixture
def client(tmp_path, monkeypatch):
    ledger = Ledger(tmp_path / "api.sqlite")
    ledger.seed()
    monkeypatch.setattr(ledger_api, "_ledger", ledger)
    with TestClient(create_app(public=False)) as client:
        yield client

def test_api_recovery_workflow(client):
    incident = client.post("/api/ledger/incident").json()
    result = client.post(f"/api/ledger/events/{incident['event_id']}/retry")
    assert result.status_code == 200
    state = client.get("/api/ledger/state").json()
    assert all(state["checks"].values())
    assert all(r["status"] == "matched" for r in state["reconciliation"])


@pytest.mark.parametrize("amount", [1.5,True,"100",-1])
def test_api_rejects_noninteger_or_negative_money(client, amount):
    assert client.post("/api/ledger/events", json={"event_id":"e", "payment_id":"p", "amount":amount}).status_code == 422
