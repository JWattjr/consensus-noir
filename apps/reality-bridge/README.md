# Reality Bridge

**A consensus-mediated commitment game for real-world claims, built as a native GenLayer intelligent-contract application on StudioNet.**

Reality Bridge turns a glass-bridge elimination mechanic into a protocol about information arriving over time. A bridge panel is not a hidden random value: it is a pre-registered binary claim about the outside world. The active runner must commit a sealed `YES` or `NO` position before the panel's evidence time. Afterward, independent GenLayer validators evaluate the registered public sources under the on-chain evidence policy and record a consensus outcome.

The application is intentionally small enough to inspect, but it is not a frontend wrapper around a centralized oracle. The contract owns the round, the participant order, commitment validity, validator-resolution request, settlement, payout accounting and every recovery path. The web client is a strictly non-authoritative interpreter of final contract state.

**Start a review at [`REVIEWER.md`](REVIEWER.md).** It is the canonical short
entrypoint. [`submission/review-manifest.json`](submission/review-manifest.json)
expresses the same claims and evidence links in a stable machine-readable form.

## Submission surface

| Item | Verified value |
| --- | --- |
| Network | **GenLayer StudioNet only** — chain id `61999` |
| Contract | `0x9fD62230aA1149bf443C0a447ffe9D1b2cF4b87E` |
| Hosted client | [reality-bridge-beta.vercel.app](https://reality-bridge-beta.vercel.app) |
| Settled proof round | Round `2`: two wallets, one future-resolving panel, complete settlement and claims |
| Consensus result | `NO` / `FINAL_EVIDENCE`, receipt `d0530d271059263a7f575f02515a283fa96e629c1946609e74e80eded80a140f` |
| Latest public round | Round `3` — deadline-bound; the client reads its live status from StudioNet |
| Pinned GenVM runner | `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` |

### Check it without trusting it

```bash
python genlayer/scripts/verify_submission.py --json
```

Reads the deployed contract from StudioNet, re-fetches each resolved panel's evidence from its public source, recomputes every stored receipt from the pre-image documented in [`specs/PRODUCT_SPEC.md`](specs/PRODUCT_SPEC.md), and re-derives each outcome from the evidence's own timestamp. The JSON result carries stable check IDs, evidence, and a summary; the process exits non-zero on any failure. It reads no stored answer and compares it to itself, and it reads the hosted client's deployed JavaScript rather than trusting this file. Omit `--json` for a concise `PASS`/`FAIL` report. Use `--manifest-only --json` for an offline review-package check with no GenLayer dependency.

Round 2 is worth looking at closely, because the target block landed 42 seconds *after* the panel's instant. Resolution ran later still, when the live chain tip had already passed the target — so an implementation that read the current tip would have answered `YES`. This one compares the block's own header timestamp against the panel's instant and answers `NO`. That margin is the difference between a panel whose outcome depends on when someone calls it and one whose outcome does not. See *Caller-chosen outcomes through resolution timing* in [`SECURITY.md`](SECURITY.md).

The complete transaction trail, exact deadlines and payout proof are in [`SUBMISSION.md`](SUBMISSION.md). This repository targets StudioNet exclusively; all currency and assets are test assets with no real-world value. Submission claims are grounded in executable, on-chain, source, and hosted-bundle evidence.

## Why this needs GenLayer

The difficult decision is semantic rather than arithmetic: whether a public source, at a specified time, satisfies a human-readable `YES` condition. That requires web retrieval, natural-language interpretation, source comparison and a defined ambiguity policy. A conventional backend can render an index, but it cannot be trusted to decide the game outcome or distribute the pool.

Reality Bridge places that boundary inside the intelligent contract:

```text
player commitment ──> on-chain sealed state
                             │
evidence timestamp ──> validator web reasoning ──> consensus receipt
                             │
                       immutable panel outcome
                             │
                    weighted claims or refunds
```

The publisher is permitted to author a round, but cannot rewrite it after publication, select an outcome, bypass deadlines or redirect the pool. Anyone may activate a lapsed round, resolve due evidence, move past a missed runner, expire an overdue round, or claim/refund an eligible seat. That removes the need for a privileged keeper and makes recovery behavior part of the protocol, not an operational promise.

## Protocol model

### Immutable evidence envelope

Before opening a round, the publisher registers the allowed evidence hosts and an ordered bridge of one to three panels. A panel commits to:

- its question and precise `YES` condition;
- a primary source plus optional corroborating sources;
- a choice deadline and later evidence-resolution time; and
- a position in the bridge, which fixes play order.

Opening a round freezes its rules and evidence envelope. Resolution can produce `YES`, `NO`, `VOID`, or a retryable `UNRESOLVED`; it does not accept an arbitrary publisher-provided answer. Every resolved panel retains a compact receipt derived from the evidence host, outcome, event identifier and effective date. The receipt demonstrates validator agreement about the registered source interpretation, not an assertion that the public internet is infallible.

### Commit, reveal and liveness

The runner first submits a salted commitment hash, then reveals the choice and salt during the reveal grace period. This separates private intent from public evidence and prevents a runner from waiting for an outcome before choosing a side. The client will not enable the commit until the participant exports and acknowledges a versioned recovery bundle; losing browser storage must not turn a valid commitment into an unrecoverable action.

Liveness is explicit. A missed commit or reveal can be forfeited permissionlessly after its per-attempt deadline. The next seat inherits the opened bridge when time remains; once the information window is gone, the panel voids rather than pretending it can still be fairly answered. Terminal expiry and every no-settlement condition route to individual refunds.

### Conservation and incentives

Each seat supplies the exact entry amount. Correct answers add a discovery credit, while an incorrect answer eliminates the runner; a `VOID` eliminates nobody. At settlement, every surviving seat is assigned:

```text
weight = 1 + 3 × discovery_credits
claim  = pool × seat_weight / total_survivor_weight
```

The final survivor receives rounding dust, so the total of all claims equals the round pool exactly. Cancellation, under-subscription, no survivors and terminal expiry do not strand value: each eligible seat can independently withdraw one entry as a refund. Claims and refunds are idempotent.

## State machine and invariants

```text
DRAFT ──open──> OPEN ──start──> ACTIVE ──all panels settled──> SETTLED
                    │                │
                    │                └──terminal / no survivors──> REFUNDABLE
                    └──cancel / insufficient seats──────────────> REFUNDABLE
```

The contract and client are designed around the same non-negotiable properties:

1. A panel cannot be resolved before its evidence time or past its terminal boundary.
2. A player can reveal only the same salted choice they committed.
3. Join order is immutable and determines the runner order.
4. The published evidence envelope cannot be altered after opening.
5. A terminal round exposes only its relevant claim or refund path.
6. Every successful payout is bounded by the pool and total payouts conserve it exactly.
7. The client never treats RPC acceptance as execution success.

## Client correctness model

The Next.js client is deliberately defensive around an eventually settled network:

- **Final reads only.** Authoritative contract reads use `TransactionHashVariant.LATEST_FINAL`, not a provisional SDK default.
- **Receipt-aware transaction monitoring.** A submitted hash means *submitted*. The UI watches it through decision and requires `execution_result === "SUCCESS"`; an accepted transaction that reverts is surfaced as failure rather than painted as success.
- **Selected-round consistency.** A background reconciliation for an old transaction cannot render its payload beneath another selected lobby row.
- **Status-aware interfaces.** Finished rounds read as settled or unwound, never as a live crossing with a current panel. Inert historical rounds stay collapsed until requested.
- **Purposeful practice mode.** The offline simulator has a scripted clock and fixed outcomes, is entered only through an explicit action, and is never a fallback for a StudioNet failure.
- **Network gate.** Every write is gated on a connected wallet being on StudioNet, with an actionable explanation for unavailable operations.

These choices make the client easier to trust during review and operation: it represents protocol state rather than inventing a smoother but inaccurate local story.

## Verified on-chain result

Round 2 on the reviewed contract asks a genuinely future-resolving question:
whether Bitcoin block `965083` — still unmined when published — was mined at
or before `2026-09-01T20:52:11Z`. A mined block's header timestamp does not
change, so the answer is independent of who resolves it and when they call.
An earlier contract read the moving *current* tip instead; that defect and its
replacement are documented in [`SECURITY.md`](SECURITY.md).

Two funded wallets joined. The active runner committed and revealed `YES`.
Block `965083` arrived 42 seconds after the fixed panel instant, so validator
consensus stored `NO` and eliminated that runner. The surviving seat claimed
the entire `0.020 GEN` pool; the final read has `claimed_amount == pool`.
Receipt
`d0530d271059263a7f575f02515a283fa96e629c1946609e74e80eded80a140f`
binds the question, evidence host, outcome, panel instant, and observed block
timestamp. The verifier independently re-fetches the source and recomputes
that receipt. Ordered transaction hashes and final readback are in
[`SUBMISSION.md`](SUBMISSION.md).

## Repository map

```text
reality-bridge/
├── frontend/                      # Next.js App Router client, StudioNet-only
│   ├── src/lib/contract.ts         # ABI adapter, final reads, write monitoring
│   ├── src/lib/derive.ts           # pure lifecycle/action availability model
│   ├── src/lib/recovery.ts         # versioned commitment recovery bundles
│   └── src/components/             # lobby, bridge, evidence, actions, monitor
├── genlayer/
│   ├── contracts/reality_bridge.py # pinned-runner intelligent contract
│   ├── tests/direct/               # deterministic protocol behavior
│   └── tests/integration/          # hosted consensus and two-wallet journey
├── specs/
│   ├── PRODUCT_SPEC.md             # rules, economics and failure handling
│   └── ARCHITECTURE.md             # trust boundary and system invariants
├── deployment/studionet.json       # contract, runner and verification manifest
├── submission/review-manifest.json # machine-readable claims and evidence map
├── REVIEWER.md                     # canonical review entrypoint
├── SECURITY.md                     # threat model and mitigations
├── QA.md                           # hands-on StudioNet verification procedure
└── DEMO.md                         # optional hands-on walkthrough
```

## Verification

The project layers static contract validation, deterministic direct tests, frontend unit/component tests, production builds, dependency audit, automated StudioNet integration and an actual hosted two-wallet journey. Run the local checks from this directory:

```bash
python -m pip install -r genlayer/requirements.txt
GENVMROOT=.genvmroot genvm-lint check genlayer/contracts/reality_bridge.py
python -m pytest genlayer/tests/direct -q
npm --prefix frontend install
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run test
npm --prefix frontend run build
```

For the consensus integration procedure and the manual wallet journey, use [`QA.md`](QA.md). The contract runner hash is intentionally pinned; do not replace it while preparing a submission.

## Review reading order

1. [`REVIEWER.md`](REVIEWER.md) for the bounded review path and strongest proof.
2. [`submission/review-manifest.json`](submission/review-manifest.json) for stable claim and evidence IDs.
3. [`genlayer/scripts/verify_submission.py`](genlayer/scripts/verify_submission.py) to independently re-derive live claims.
4. [`specs/ARCHITECTURE.md`](specs/ARCHITECTURE.md) for the consensus boundary.
5. [`SECURITY.md`](SECURITY.md) and [`KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md) for threats and explicit limits.
6. [`SUBMISSION.md`](SUBMISSION.md) for the complete transaction and test record.

## Contribution constraints

- Keep all deployment, documentation and user-facing network language on **StudioNet** only.
- Do not commit `.env.local` or `.deployer.key`.
- Do not change the concrete GenVM runner hash without a deliberate contract migration and a fresh verification run.
- Read the bundled Next.js documentation under `frontend/node_modules/next/dist/docs/` before changing framework code.
