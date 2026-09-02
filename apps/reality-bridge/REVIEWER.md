# Reality Bridge — review entrypoint

Use this page for a fast, evidence-led review. The machine-readable equivalent
is [`submission/review-manifest.json`](submission/review-manifest.json).

## Product in one sentence

Reality Bridge is a StudioNet game in which players seal a binary choice before
real-world evidence exists, then GenLayer validators retrieve and interpret the
registered evidence after a fixed timestamp so the intelligent contract can
settle and pay the round without a trusted oracle or keeper.

## Live artifact

| Field | Value |
| --- | --- |
| Network | GenLayer StudioNet, chain `61999` |
| Contract | `0x9fD62230aA1149bf443C0a447ffe9D1b2cF4b87E` |
| Client | [reality-bridge-beta.vercel.app](https://reality-bridge-beta.vercel.app) |
| Deployment source of truth | [`deployment/studionet.json`](deployment/studionet.json) |
| Proof case | Round `2`, settled and fully claimed |
| Pinned runner | `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` |

All values are test-network artifacts. A round in the deployment history should
not be assumed joinable after its deadline; the client reads that state live.

## Fastest independent check

From `apps/reality-bridge`:

```bash
python -m pip install -r genlayer/requirements.txt
python genlayer/scripts/verify_submission.py --json
```

The command exits non-zero on any failed check. It validates this review
package, reads final StudioNet state, re-fetches Blockstream evidence,
recomputes the receipt pre-image, re-derives the panel result, and inspects the
hosted JavaScript bundle for the documented contract address. The install uses
the repository's pinned verifier dependencies. For a fully offline structural
check that needs only Python's standard library and no install step:

```bash
python genlayer/scripts/verify_submission.py --manifest-only --json
```

Omit `--json` from either command for a concise human-readable report.

## Why GenLayer is necessary

The payout-bearing operation is not a deterministic API lookup. It asks whether
untrusted public evidence satisfies a human-readable condition at a specified
instant. The contract uses GenLayer nondeterministic web retrieval and model
reasoning, then has validators reproduce and exactly compare the canonical
decision fields before storage changes. A normal smart contract cannot perform
that semantic evidence evaluation; a centralized service could, but would be a
trusted outcome setter.

The authoritative path is
[`RealityBridge._resolve_tile_consensus`](genlayer/contracts/reality_bridge.py):
the primary source may establish a result, supporting sources may only downgrade
it to `VOID`, unavailable future evidence remains retryable, and the accepted
receipt commits to the panel timestamp and the evidence timestamp.

## Claims and where to falsify them

| Claim | Primary evidence | Independent check |
| --- | --- | --- |
| Resolution is validator-mediated, not supplied by the publisher or UI. | [`genlayer/contracts/reality_bridge.py`](genlayer/contracts/reality_bridge.py), `resolve_tile` and `_resolve_tile_consensus` | `contract_interface` |
| Caller timing cannot move the proof-round outcome. | [`SECURITY.md`](SECURITY.md), *Caller-chosen outcomes through resolution timing*; round 2 in [`SUBMISSION.md`](SUBMISSION.md) | `round_2_panel_1_source_timestamp`, `round_2_panel_1_outcome`, `round_2_panel_1_caller_independence` |
| Choices are sealed before evidence and account-bound when revealed. | `commit_choice` / `reveal_choice` in the contract; direct tests at `test_commitment_*` | deterministic direct suite |
| Anyone can progress missed-runner, resolution, and terminal recovery paths; eligible players withdraw their own claim or refund. | `forfeit_missed_commit`, `forfeit_missed_reveal`, `resolve_tile`, `expire_round`, `claim`, `refund`; [`specs/ARCHITECTURE.md`](specs/ARCHITECTURE.md) | deterministic direct suite |
| Settlement conserves the deposited pool. | contract `claim` / `refund`; proof round in [`deployment/studionet.json`](deployment/studionet.json) | `round_2_pool_conservation` |
| The hosted client points at the reviewed contract and waits for final execution success. | [`frontend/src/lib/contract.ts`](frontend/src/lib/contract.ts) and [`frontend/tests/tx.test.ts`](frontend/tests/tx.test.ts) | `hosted_client_contract` |

The JSON manifest carries these same claims as stable IDs with artifact paths
and live-check IDs, so an automated reviewer does not need to infer the evidence
map from prose.

## The strongest proof case

Round 2 asks whether Bitcoin block `965083` was mined by
`2026-09-01T20:52:11Z`. Its immutable header timestamp is `20:52:53Z`, 42
seconds late. Resolution ran after the block existed, when a current-tip query
would already have flipped to `YES`; the contract stored `NO`. The verifier
re-fetches that header timestamp and recomputes receipt
`d0530d271059263a7f575f02515a283fa96e629c1946609e74e80eded80a140f`
from final contract fields. This directly exercises the security property that
previously failed review.

## Suggested reading order

1. [`submission/review-manifest.json`](submission/review-manifest.json) — stable claims and evidence links.
2. [`genlayer/scripts/verify_submission.py`](genlayer/scripts/verify_submission.py) — executable falsification path.
3. [`genlayer/contracts/reality_bridge.py`](genlayer/contracts/reality_bridge.py) — protocol and consensus boundary.
4. [`specs/ARCHITECTURE.md`](specs/ARCHITECTURE.md) — trust model and state transitions.
5. [`SECURITY.md`](SECURITY.md) — threats, including the corrected timing defect.
6. [`KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md) — explicit limits and non-goals.
7. [`SUBMISSION.md`](SUBMISSION.md) — full transaction history and test evidence.

The repository evidence is the submission record. An optional hands-on product
walkthrough remains in [`DEMO.md`](DEMO.md); the claim map and verifier remain
the authoritative review surface.
