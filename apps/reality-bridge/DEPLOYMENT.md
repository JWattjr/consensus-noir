# Deploying Reality Bridge to GenLayer StudioNet

Reality Bridge targets **GenLayer StudioNet only** — chain id `61999`, RPC
`https://studio.genlayer.com/api`. StudioNet is the sole supported network. If
StudioNet is unreachable the interface says so; it never substitutes fixtures
for live data.

## Prerequisites

```bash
python -m pip install -r genlayer/requirements.txt
```

```bash
npm --prefix frontend install
```

StudioNet is a hosted simulator: accounts start empty and are topped up through
its faucet (`sim_fundAccount`), so no external funding step is required. That is
also why the previous integration run stalled — an unfunded account submits a
deploy that never decides.

## 1. Lint and validate the contract

```bash
python -m pip install genvm-linter==0.11.0
```

The linter's `validate` step loads the pinned GenVM runner. The published
`latest` artifact bundle no longer ships that runner, so point `GENVMROOT` at
the SDK the test harness already downloaded:

```bash
python genlayer/scripts/make_genvmroot.py
```

```bash
GENVMROOT=.genvmroot genvm-lint check genlayer/contracts/reality_bridge.py
```

Expected output:

```text
✓ Lint passed (3 checks)
✓ Validation passed
  Contract: RealityBridge
  Methods: 24 (8 view, 16 write)
```

Do **not** relax the pinned runner in the contract header to make validation
pass. The pin is
`py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`.

## 2. Run the deterministic suite

```bash
python -m pytest genlayer/tests/direct -q
```

## 3. Deploy and publish a round

```bash
python genlayer/scripts/deploy_studionet.py
```

The script:

1. Resolves the publisher account from, in order:
   `REALITY_BRIDGE_DEPLOYER_KEY` in the environment, the git-ignored
   `genlayer/.deployer.key`, and only otherwise a freshly generated account —
   which it writes to that file. **Keep that file**: the publisher role is the
   only way to author further rounds on the deployment, and it can never be
   recovered. **Never commit a key.**
2. Tops the account up through the StudioNet faucet.
3. Deploys `genlayer/contracts/reality_bridge.py`.
4. Registers `test-server.genlayer.com` in the evidence source registry.
5. Creates a round with real-time deadlines (30-minute join window, 30-minute
   commit window, 15-minute reveal grace, 24-hour terminal deadline), appends
   one panel and opens it.
6. Waits for every transaction to reach a decided state **and** checks the
   leader receipt reports `SUCCESS`. It aborts loudly otherwise.
7. Writes `deployment/studionet.json` and prints the two environment lines the
   frontend needs.

A full run takes about ninety seconds. The published round still uses half-hour
windows, because a browser player signing through a wallet needs far more time
than a script does.

Useful flags:

- `--round-id N` — publish under a different round id.
- `--contract 0x…` — publish onto an existing deployment instead of deploying a
  new one. Requires the publisher key that owns that contract.
- `--skip-round` — deploy and register sources only.
- `--quick` — a fast lifecycle schedule: joins close in 3 minutes and the panel is
  resolvable about 5.5 minutes after publishing. Every value clears the
  contract's minimums, and the panel window stays wider than the commit window
  so a forfeit hands the panel on rather than voiding it. Individual window
  flags still override it.

Rounds carry real deadlines, so a published round eventually stops being
joinable. Publish a fresh one without redeploying:

```bash
python genlayer/scripts/deploy_studionet.py --contract 0x... --round-id 3
```

The manifest merges: the deployment record and previously published rounds are
preserved, and the new round is appended under `rounds`.

## 4. Configure the frontend

```bash
cp frontend/.env.example frontend/.env.local
```

Then set `NEXT_PUBLIC_REALITY_BRIDGE_CONTRACT` (and optionally
`NEXT_PUBLIC_REALITY_BRIDGE_ROUND_ID`) to the values the script printed.
`.env.local` is git-ignored and must stay that way.

```bash
npm --prefix frontend run build
```

```bash
npm --prefix frontend run dev
```

## 5. Verify the live journey in a browser

1. Open the app; confirm the network pill reads **GenLayer StudioNet** and the
   footer shows chain `61999`.
2. Connect an injected wallet. On a different chain the app shows a blocking
   banner, disables every write and offers a switch/add-network button.
3. Fund that wallet on StudioNet (the simulator faucet, or transfer from the
   publisher account).
4. Join the open round. Read the pre-signature disclosure: exact amount,
   maximum loss, zero fee, payout range, refund conditions, the transactions to
   expect, deadline consequences, the salt warning, the StudioNet-only asset
   warning, and the contract address and round id.
5. After the join window closes, press **Start the round** (permissionless).
6. Pick YES or NO. Copy **and** download the recovery bundle, tick the
   confirmation, then commit. The button stays disabled until you do.
7. Reveal before the cut-off. To prove recovery works, clear site data or open a
   fresh browser profile first and restore the bundle — the app validates it
   against your wallet, the contract, the round, the panel and the on-chain
   commitment before enabling the reveal.
8. After the resolution time, press **Ask validators to resolve** and watch the
   transaction card move through the real consensus states.
9. Claim the payout, or the refund if the round unwound.

## 6. Hosted integration proof

```bash
cd genlayer && python -m pytest tests/integration -q -s
```

This deploys a fresh contract, funds two accounts, authors and opens a round,
joins twice, activates, commits, reveals, runs a **real** validator resolution
against a stable public fixture, checks the stored outcome and receipt, and
withdraws for both players. It takes about four minutes and hits the live
network.

It must run from `genlayer/`: `gltest` reads `gltest.config.yaml` from the
current directory, and the suite refuses to start unless that StudioNet
configuration is present.

## 7. Frontend hosting

The repository has no authorized hosting workflow for this application, so
deployment stops here by design. To host it yourself, build the app and serve it
from any static-capable Next.js host with the two `NEXT_PUBLIC_*` variables set.
Record the resulting URL in `deployment/studionet.json` under `frontendUrl`.

## Deployment manifest

`deployment/studionet.json` is written by the script and is the single record of
what exists on chain:

```json
{
  "network": "GenLayer StudioNet",
  "chainId": 61999,
  "runner": "# { \"Depends\": \"py-genlayer:1jb45aa8...\" }",
  "contractAddress": "0x...",
  "publisher": "0x...",
  "transactions": { "deploy": "0x...", "create_round": "0x...", "...": "0x..." },
  "round": { "roundId": 1, "joinDeadlineIso": "...", "...": "..." },
  "frontendUrl": null
}
```

## Safety rules

- Never put a private key in source, in a committed file, or in a command that
  ends up in shell history you share.
- `frontend/.env.local` and `genlayer/.env` are git-ignored; keep them that way.
- Every asset here is a StudioNet test asset with no real-world value. Do not
  reuse this contract or these addresses on any other network.
