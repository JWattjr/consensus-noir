# Consensus Noir

Consensus Noir is a standalone GenLayer-native social deduction game. Players
study a frozen noir case file, commit to a suspect and theory, reveal during a
fixed window, and share a testnet GEN pool only when validator consensus finds
the same suspect.

The contract, frontend, tests, deployment notes, and generated artifacts in
this repository form the complete MVP boundary.

## Local commands

```powershell
# from the repository root
genvm-lint check contracts/consensus_noir.py
python -m pytest tests/direct -v
$env:CONSENSUS_NOIR_RUN_INTEGRATION = "1"
python -m pytest tests/integration -m integration -v -s
cd frontend
npm install
npm run lint
npm run typecheck
npm run build
```

The contract starts with the pinned GenVM runner required for GenLayer testnet.
The integration test is opt-in because it performs real consensus work and may
need a configured StudioNet account.

## Network status

StudioNet (chain `61999`, `https://studio.genlayer.com/api`) is the only
supported network. No legacy GenLayer testnet is referenced anywhere in this
app.

No mainnet deployment is included. The current StudioNet deployment, seeded
`glasshouse-0217-live` case, runner hash, and transaction hashes are recorded in
`deployment/studionet.json`.
