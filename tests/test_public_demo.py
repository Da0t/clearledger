from datetime import datetime, timezone
from fastapi.testclient import TestClient
import pytest
from app import create_app


@pytest.fixture
def client():
    with TestClient(create_app(public=True)) as client:
        yield client


def fresh():
    return {"version":1,"started_at":datetime.now(timezone.utc).isoformat(),"history":[]}


def call(client, session, path, body=None):
    response=client.post("/api/demo",json={"path":path,"body":body,"session":session})
    assert response.status_code==200, response.text
    result=response.json()
    session.update(result["session"])
    return result["value"]


def test_ledger_visitors_are_isolated_and_refresh_is_identical(client):
    a,b=fresh(),fresh()
    initial=call(client,b,"/api/ledger/state")
    call(client,a,"/api/ledger/holds",{"hold_id":"new_hold","amount":5000})
    state=call(client,a,"/api/ledger/state")
    assert state["balances"]["wallet"]==285000
    assert state==call(client,a,"/api/ledger/state")
    assert call(client,b,"/api/ledger/state")==initial


def test_public_incident_recovery_and_refund(client):
    session=fresh()
    incident=call(client,session,"/api/ledger/incident",{})
    state=call(client,session,"/api/ledger/state")
    assert state["balances"]["wallet"]==290000
    assert state["inbox"][0]["id"]==incident["event_id"]
    call(client,session,f"/api/ledger/events/{incident['event_id']}/retry",{})
    call(client,session,"/api/ledger/refunds",{"payment_id":incident["payment_id"],"amount":2500,"key":"r1"})
    call(client,session,"/api/ledger/provider-records",{"record_id":"ref1","payment_id":incident["payment_id"],"kind":"refund","amount":2500})
    state=call(client,session,"/api/ledger/state")
    assert state["balances"]["wallet"]==300400
    assert all(state["checks"].values())
    assert all(r["status"]=="matched" for r in state["reconciliation"])


def test_public_invalid_command_cannot_escape_sandbox(client):
    for path in ["/api/market/orders/x\nRESET/cancel", "/etc/passwd", "/api/ledger/state/../../secret"]:
        response=client.post("/api/demo",json={"path":path,"body":{},"session":fresh()})
        assert response.status_code==409


def test_independent_application(client):
    assert client.get('/').status_code == 200
    assert client.get('/marketlab').status_code == 404
    assert client.get('/api/market/state').status_code == 404
    assert client.get('/api/ledger/state').status_code == 404
    assert client.post('/api/demo', json={'path':'/api/market/state','session':fresh()}).status_code == 409
    assert client.post('/api/demo', content=b'x'*100001).status_code == 413
    assert client.get('/openapi.json').json()['info']['title'] == 'ClearLedger'
