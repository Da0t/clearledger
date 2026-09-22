# ClearLedger

An auditable money-movement application with an append-only journal, idempotent payment processing, failure recovery, bounded refunds, reservations, and provider reconciliation.

This is an independent application with its own source repository, API, UI, tests, CI, and deployment. All data and funds are synthetic.

## Run locally

Requires Python 3.12.

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload
```

Open http://localhost:8000. Run `python -m pytest -q` for the automated checks.

## Public deployment

The Vercel configuration serves the real Python/SQLite ledger through a bounded replay adapter. Each visitor owns an isolated tab session. Refresh preserves that tab’s transcript; New session resets it. The hosted demo is not durable financial storage. Commands are capped at 200 per session.

No Java runtime or trading application is required.

## Engineering details

See [ClearLedger engine documentation](clearledger/README.md) and the tests for correctness guarantees and limitations.
