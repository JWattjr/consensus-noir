# Reality Bridge — submission checklist

Network: **GenLayer StudioNet only**, chain id `61999`.

Every artifact below is read back from
[`deployment/studionet.json`](deployment/studionet.json) or quoted verbatim
from a command. Where something is unverified, it says so.

## Verified artifacts

| Artifact | Value |
| -------- | ----- |
| Pinned GenVM runner | `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` |
| Published contract | `0x9fD62230aA1149bf443C0a447ffe9D1b2cF4b87E` |
| Publisher account | `0xf19AA039E52fC65A23f2f98FBA15081244C32d4d` |
| Deployment transaction | `0x88d553046d34a8bb7aee59b36b047231746d61c98c8a85e42ad9f3c5ef4ae881` |
| Published round | `1` on the corrected contract — one panel, entry `0.01 GEN` |
| Frontend URL | [reality-bridge-beta.vercel.app](https://reality-bridge-beta.vercel.app) — production, verified |
| Independent verification | `python genlayer/scripts/verify_submission.py --json` — all checks pass against the review manifest, live chain, source data, and hosted client |
| Machine-readable review map | [`submission/review-manifest.json`](submission/review-manifest.json) — stable claim IDs, artifact paths, and live-check IDs |

Per-transaction hashes, deadlines and the panel threshold are in the manifest.
Do not assume a round listed there is still joinable: rounds carry real
deadlines and expire. Publish a fresh one using the recipes in
[`QA.md`](QA.md).

### The published round poses a genuinely open question

> Was Bitcoin block **965073** mined at or before **2026-09-01T19:14:31Z**?

The target block does not exist when the round is published — it is ten above
the live tip at that moment (`965063`), roughly an hour and three quarters of
mining away from the panel's instant, so it is genuinely uncertain — so at the moment a player commits, the answer
does not exist yet.

The evidence source is `https://blockstream.info/api/blocks/965073`:
height-addressed, public, and **immutable once mined**. A block's header
timestamp is fixed when it is found and never changes, so this panel returns
the same answer whoever asks and whenever they ask.

Two earlier versions of this question were defective, and both are worth
retaining in the audit history because the second is subtle:

1. A static fixture page whose answer was readable before committing. That
   exercised the consensus plumbing but not the product.
2. *"Will the tip height be greater than N at the evidence timestamp?"* read
   from `/api/blocks/tip/height`. The wording named a scheduled instant but
   the source reports the tip **now**, and tip height only ever rises — so the
   same panel answered NO to an early caller and YES to a late one. Resolution
   is permissionless, so whoever chose when to call was choosing a
   payout-bearing outcome. This was caught in review and is fixed.

### Resolution is bound to the panel's instant, not the caller's clock

The contract now passes the panel's own evidence instant into the consensus
block, requires the model to answer the condition **as of that instant**, and
requires it to report `observed_at` — the timestamp the evidence page itself
carried for the observation relied on. Both the as-of instant and
`observed_at` are inside the hashed receipt, so a stored receipt commits to
*when* the answer was true and not merely to what it was.

A FINAL that cannot produce a timestamp from the page is refused and the panel
is voided (`VOID_UNANCHORED`) rather than settled, because an answer that
cannot say when it was true is an answer about whenever resolution happened to
run. Where a source cannot answer yet — the target block is not mined — the
panel stays in the retryable `UNRESOLVED` state, which changes no state and
moves no deadline, instead of resolving to an outcome.

Receipts are versioned `reality-bridge-evidence-v2`; a v1 receipt cannot be
mistaken for a v2 one.

### Round 2: the fix demonstrated on chain, with the margin that proves it

Round 2 on the published contract was played to settlement by two funded
wallets on 2026-09-01. It is the clearest evidence that resolution no longer
depends on when it is called, because the target block landed *just* late:

| | |
| --- | --- |
| Question | Was Bitcoin block **965083** mined at or before **2026-09-01T20:52:11Z**? |
| Evidence | `https://blockstream.info/api/blocks/965083` |
| Block 965083 header timestamp | **20:52:53Z** -- 42 seconds *after* the panel's instant |
| Stored `observed_at` | `1788295973` |
| Outcome | **NO**, `FINAL_EVIDENCE` |
| Resolution actually ran at | 20:53:40Z (`resolved_at` 1788296020), after the block existed |
| Receipt | `d0530d271059263a7f575f02515a283fa96e629c1946609e74e80eded80a140f` |

**This is the defect and the fix in one round.** By the time resolution ran,
the live tip had already passed 965083. The previous code read the tip and
would have answered **YES**. The corrected code compares the block's own
header timestamp against the panel's instant, sees it is 42 seconds late, and
answers **NO**. The caller's clock moved on; the outcome did not.

The retryable path also ran for real. The first two resolution attempts landed
before block 965083 existed and returned `UNRESOLVED`:

```text
21:52:34  resolve_tile attempt 1: ACCEPTED   -> panel still PENDING
21:53:58  resolve_tile attempt 2: ACCEPTED   -> panel still PENDING
21:55:10  resolve_tile attempt 3: ACCEPTED   -> outcome=NO observed_at=1788295973
```

The stored `attempts` counter is `1`, confirming the two unresolved attempts
changed no state and moved no deadline, exactly as specified.

Settlement followed the rules: the runner had revealed `YES` against an
outcome of `NO` and was `ELIMINATED`; the surviving seat took the whole pool.
On-chain `claimed_amount` equals `pool` at `0.020000 GEN`.

| Step | Transaction |
| --- | --- |
| Join (runner `0xB18920bc...`) | `0x5e5aa9ecdc1cbd664e1f0e24193f9944609267a3981b8d2549c8a9959c71ccf1` |
| Join (survivor `0xeB1f0C85...`) | `0x6e2ce8379e483b6ae6bc5115f3c990af02727b735135480f356a1411ff9f9fbe` |
| Start (permissionless) | `0x3709e56f115cb0e173be4c2b1c6eeb6fe295e6c22cf531b2f4402ea585ec2588` |
| Commit `YES` | `0xd57c10ce3e4afcaa7140afccd64e3ade4dad8c7250c786b4b5a2a54bc41b5b20` |
| Reveal `YES` | `0x6a9f29f7e856b5c52fb972930765fef0e2b3a9e1bfa6cff4bfdaa9d0d1de160b` |
| Resolution (the one that decided) | `0xa412a8141fc29f85379c9b37fcf41cb707c30c9d8e56566ddf0f39064775dae6` |
| Claim `0.020000 GEN` | `0x9a8d0400dec4f19b3e781976decf4c6902176fee6f276e1387a40eb7acb32e8d` |

Round 3 is the latest published round: block `965094`, joins close
`2026-09-01T22:39:51Z`, resolvable `2026-09-02T00:24:51Z`. Its joinability is
read from StudioNet rather than asserted permanently in this document.

### The previous deployment, and what its evidence does and does not prove

Rounds 1-4 were published on `0x4DE4c2aFC908fd744b65Fe8361FEE4Dc1C5c8CA9`, the deployment that carried the
defective tip-height question. The contract was **redeployed** at
`0x9fD62230aA1149bf443C0a447ffe9D1b2cF4b87E` for the timing fix, because the stored panel gained a field and
the receipt scheme moved to v2.

The round-4 journey below therefore still proves what it always proved -- the
lifecycle, weighted settlement, and that `claimed_amount == pool` -- but its
*question* was the defective one. It is retained as settlement evidence, not
as evidence that the question was sound. The anchored question is proven
separately by the hosted integration run recorded further down.

### Round 4 publication and settlement

Round 4 was published on StudioNet at height `964787`, with a join deadline of
`2026-08-30T21:34:26Z`, choice deadline `2026-08-30T21:44:26Z`, evidence time
`2026-08-30T21:46:26Z`, and terminal deadline `2026-08-31T21:19:26Z`. The live
question and all three deadlines are stored in the manifest; they are not a
static fixture.

### Hosted two-wallet journey (round 4)

The production page at [reality-bridge-beta.vercel.app](https://reality-bridge-beta.vercel.app)
was used with these public StudioNet accounts:

| Account | Role | Result |
| ------- | ---- | ------ |
| `0x1eE3B827907429E5dF3DB7282446b6E065ff6199` | runner | joined, committed/revealed `YES`, received `0.016 GEN` (one discovery credit) |
| `0x9A8Ceb4FEF3c74B6631D04f999e550c662B2BaF0` | passive survivor | joined, started/resolved the round, received `0.004 GEN` |

Transaction hashes, in lifecycle order:

1. Join wallet 1 — `0x957dfe74cbe381eeb16d48fb23202d1f824d9831ec25fa6afcdc6071a542e13b`
2. Join wallet 2 — `0xcf3b802c4f45bbd731ee5cbd43d652a8c3354f168e3a300722766f610946a7ff`
3. Start from wallet 2 — `0x979abe50000431985f4b3451ef65f2de5a292f87a1e41f3cbb193b591e96cffe`
4. Commit `YES` from wallet 1 — `0xa8056890ce385a68da7bb5326b101fba5d4e5678996cb09f66297e2e5f9c27bf`
5. Reveal `YES` from wallet 1 — `0x347f511c68e334c955feb81740e469e3c3bab3d53a5798f4c8527aa6142e4b6b`
6. Permissionless resolution request — `0x2c3c6bc33f3c37ebd407b4f0ed1d6eda0db37f4c21703d9e961ea0df71eb4994`
7. Claim by wallet 1, `0.016 GEN` — `0x717b661179c9b59809241686f87f9d9f72f22fd1b88d638cae8a9d5f34dfa04e`
8. Claim by wallet 2, `0.004 GEN` — `0x1ec88863e5d7c7a3d3f1b60ddf514c54552a5df395a0badcaa4a575843c6fa2a`

Independent finalized reads (`show_round.py 4`) report `SETTLED`, panel
outcome `YES`, reason `FINAL_EVIDENCE`, one attempt, receipt
`77839f48ea5854f466c6ff6ffbfa5de5a6b176bad3503173158316da44c23f4c`, pool
`20000000000000000` wei, and `claimed_amount == pool`. Both seats are marked
claimed. The contract's current global balance includes a separate historical
round-3 reserve (`0.010 GEN`); round 4 itself is fully conserved.

## Definition of done

| Requirement | Status | Evidence |
| ----------- | ------ | -------- |
| StudioNet is the only network, everywhere | done | a repository-wide search finds no other GenLayer network outside third-party dependencies; enforced by a CI job and by `tests/app.test.tsx`, which derives the forbidden set from the SDK's own chain list |
| Terminal deadline is a hard boundary | done | resolution past the deadline unwinds instead of settling; both orderings tested at `terminal + 1` |
| Missed-commit and missed-reveal liveness | done | per-attempt windows; the same panel is handed on while still answerable, and voided for liveness once it is not |
| Impossible schedules rejected | done | boundary tests at equality, one second before and one second after |
| Commit/reveal recovery after storage loss | done | versioned bundle, export gate, validating import |
| Every permissionless path in the UI | done | start, both forfeits, resolve, expire, claim, refund |
| Transaction success requires proof | done | `execution_result === "SUCCESS"` is required; a decided transaction with no receipt stays pending; the watch runs through to finality |
| Authoritative reads are final | done | `TransactionHashVariant.LATEST_FINAL` on every read |
| Claims and refunds eligibility-aware and idempotent | done | contract and UI tests |
| Evidence receipts are meaningful | done | derived from host, status, outcome, event id and effective date |
| Simulation completes, and is never mistaken for live play | done | its own scripted clock; every scenario driven to a terminal state in tests; simulation-specific wording |
| Publisher rotation is recoverable | done | two-step transfer and accept, withdrawable, zero address rejected |
| Zero high or critical advisories | done | `npm audit` reports `found 0 vulnerabilities` on `next@16.3.3` |
| Contract lint and schema validation | done | 28 methods (9 view, 19 write) |
| Deterministic contract tests | done | 61 passed |
| Frontend tests | done | 104 passed across 8 files |
| Hosted StudioNet journey | done | signed round-4 run against the production URL; hashes and payout proof below |
| Continuous integration | done | `.github/workflows/reality-bridge.yml` — contract, frontend and network-hygiene jobs |
| Source is versioned | done | commits `a5c6d31`, `5305d48`, `9198aab`, `61c139e`, `2cf5eb2`, and `48839ee` |
| Public URL | done | production URL recorded in `deployment/studionet.json` and checked with browser automation |
| Claims are independently checkable | done | `verify_submission.py` re-reads the chain, re-fetches each panel's evidence from its public source, recomputes every receipt from the documented pre-image, and re-derives each outcome; it trusts nothing in this repository's prose |

## Command results

```text
GENVMROOT=.genvmroot genvm-lint check genlayer/contracts/reality_bridge.py
  Lint passed (3 checks)
  Validation passed - RealityBridge, 28 methods (9 view, 19 write)

python -m pytest genlayer/tests/direct -q
  61 passed

npm --prefix frontend run test
  8 test files, 104 passed

npm --prefix frontend run typecheck     clean
npm --prefix frontend run lint          clean
npm --prefix frontend run build         Compiled successfully - 2 static routes
npm --prefix frontend audit             found 0 vulnerabilities
```

The automated hosted integration is run by hand, because it sends real
transactions:

```bash
cd genlayer && python -m pytest tests/integration -q -s
```

It deploys a throwaway contract, funds two accounts, authors and opens a round,
joins twice, activates permissionlessly, commits, reveals, runs a real
validator resolution, checks the stored outcome and receipt, settles, and
withdraws for both players. Results are recorded in the manifest under
`verification`.

## What the automated integration proved

### The anchored resolution, verified on StudioNet

A full hosted journey on contract `0xaD59a13a0eB41d31F5eC2b8fc8C8558aD9b221bf`
(2026-09-01, 187 s) ran deploy through both withdrawals, resolving a real
panel with real validators against
`https://blockstream.info/api/blocks/900000`:

```text
resolve_tile accepted in 31s
tile outcome=YES reason=FINAL_EVIDENCE observed_at=1749188499
```

`1749188499` is block 900000's header timestamp, read off the page by the
validators rather than supplied by the test. The suite recomputes the v2
receipt from that value plus the panel's `resolution_time` and asserts it
matches what the contract stored, so the anchoring is proven on chain and not
merely asserted in a unit test.

### Earlier runs


A run on contract `0xeC37Bb0a63502143ec87Dc5E5174a1131e375A54` finished
`SETTLED` with `claimed_amount == pool`, weighted claims of `1.6e16` and
`0.4e16` against a `2e16` pool, and a **contract balance of zero** once both
players withdrew. Conservation was proven on chain, not merely asserted in a
test. A second run on `0xf44f742e885586B15dD5d86d9bC25f5C8B624045` reproduced
it.

Both predate the terminal-deadline fix; the run against the corrected contract
is recorded in the manifest. The published round-4 wallet journey above is a
separate run against the long-lived submission contract.

## Browser verification performed

Against the hosted production URL and a local dev server pointed at the
published contract:

- The full lifecycle watched live while two funded accounts played a round:
  lobby pool and seats updating after both joins, `ACTIVE` with five
  countdowns, the stage advancing to `RESOLVE` after the reveal with both
  forfeit controls correctly disappearing, and settlement showing the evidence
  receipt and weighted claims.
- Network pill *GENLAYER STUDIONET*, footer *chain 61999*; no other chain id
  anywhere in the DOM.
- Actions correctly gated with a stated reason when no wallet is connected.
- An RPC failure surfaced the *StudioNet is not answering* panel rather than
  falling back to fixtures.
- Simulation entered by click: distinct chrome, scripted outcomes that do not
  bend to the player's choice, and no live-network vocabulary.
- Mobile at 375 px: no horizontal overflow, no touch target under 44 px.

These observations were originally made against the previous deployment's
hosted configuration. The resolution-timing fix touched the contract, the
published question and the evidence panel's fields; the settled-panel view now
additionally shows *Evidence observed* and *Answered as of*, sourced from the
same stored fields the receipt commits to. The current production bundle is
independently checked below against the corrected contract address.

## How to check this submission without trusting it

The deployment, proof-round, receipt, evidence, outcome, and hosted-client
claims are re-derivable from public data. One command:

```bash
python genlayer/scripts/verify_submission.py --json
```

It reads the deployed contract from StudioNet, re-fetches each resolved
panel's evidence from its public source, recomputes each stored receipt from
the pre-image documented in [`specs/PRODUCT_SPEC.md`](specs/PRODUCT_SPEC.md),
and re-derives each outcome from the evidence's own timestamp against the
panel's instant. Its JSON result carries stable check IDs and evidence for
automated inspection, and it exits non-zero on any failure. Omit `--json` for
the equivalent human-readable `PASS`/`FAIL` report. Nothing in it reads a
stored copy of an answer and compares it to itself.

Current result, against the live deployment:

```text
PASS  contract source is ASCII-only
PASS  manifest targets StudioNet only
PASS  contract is deployed and exposes the documented interface
PASS  round 2 conserves its pool
PASS  round 2 panel 1: receipt recomputes from stored fields
PASS  round 2 panel 1: settled on anchored evidence
PASS  round 2 panel 1: stored timestamp matches the live source
PASS  round 2 panel 1: outcome follows the evidence, not the caller
PASS  round 2 panel 1: resolution ran after the block existed
PASS  hosted client serves the contract this repository documents
all checks passed; summary.allPassed = true
```

The hosted-client check reads the deployed JavaScript bundle and requires it to
contain the same corrected contract address documented by the manifest. It
therefore cannot be satisfied by editing this file.

A hands-on check can use a fresh public round while its on-chain join window is
open; the hosted client shows that live state and [`HANDOFF.md`](HANDOFF.md)
gives the fresh-round command. This is optional: the submission record is the
machine-readable claim map plus reproducible repository, StudioNet,
Blockstream, and hosted-bundle evidence.

## Reading list for a reviewer

0. [`REVIEWER.md`](REVIEWER.md) — canonical short review path and strongest proof.
1. [`submission/review-manifest.json`](submission/review-manifest.json) — stable claim-to-evidence map.
2. [`genlayer/scripts/verify_submission.py`](genlayer/scripts/verify_submission.py) — executable falsification path.
3. [`specs/PRODUCT_SPEC.md`](specs/PRODUCT_SPEC.md) — rules and economics.
4. [`specs/ARCHITECTURE.md`](specs/ARCHITECTURE.md) — consensus boundary and invariants.
5. [`SECURITY.md`](SECURITY.md) — threat model.
6. [`KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md) — what this does not do.
7. [`QA.md`](QA.md) and [`DEMO.md`](DEMO.md) — optional hands-on procedures.
