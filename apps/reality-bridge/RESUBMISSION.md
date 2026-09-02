# Resubmission note

Copy the section below into the steward's resubmit box. It answers the
specific request that was raised and points at verifiable artifacts.

---

## Steward request

> The main thing holding this back is that the Bitcoin panel claims a
> scheduled-time result but fetches the current tip whenever resolution runs,
> so caller timing can change a payout-bearing outcome. Bind resolution to
> timestamped or checkpointed evidence and include that evidence and timing in
> the stored receipt.

## What was wrong

The finding is correct, and the consequence was worse than the wording
suggests. Bitcoin tip height is monotone, so the panel *"will the tip be
greater than N at the evidence timestamp"* answered **NO** to an early caller
and **YES** to a late one. Resolution is permissionless and the outcome carries
the pool, so whoever chose when to call was choosing the payout. The panel
named a scheduled instant but nothing in the contract bound the answer to it.

## What changed

**1. Resolution is bound to the panel's instant.** Each panel already stored a
`resolution_time`; it never reached the consensus block. It is now passed in,
stated in the extraction prompt, and the model is required to answer the
condition as it stood at that instant rather than at the moment of the call.

**2. Evidence must carry its own timestamp, and the receipt commits to it.**
The model must report `observed_at` -- the timestamp the evidence page itself
gives for the observation relied on -- normalised to a Unix second, because a
free-text date would not canonicalise identically across validators on a field
that is compared exactly. A `FINAL` that cannot produce one is refused and the
panel is voided (`VOID_UNANCHORED`) rather than settled: an answer that cannot
say when it was true is an answer about whenever resolution happened to run.
Both the as-of instant and `observed_at` are inside the hashed receipt, which
moved to `reality-bridge-evidence-v2`.

**3. The published question now rests on checkpointed evidence.** It changed
from *"is the tip above N"* to *"was Bitcoin block N mined at or before T?"*,
read from the height-addressed `/api/blocks/<height>`. A mined block's header
timestamp is fixed when the block is found and never changes, so the answer is
identical whoever asks and whenever they ask. Where the target block does not
exist yet, the panel returns the retryable `UNRESOLVED` -- which moves no
deadline and changes no state -- instead of resolving to an outcome. The live
tip endpoint is now read once at publish time, only to choose a block that is
still in the future.

## Verification

The contract was redeployed, because the stored panel gained a field and the
receipt scheme changed.

| | |
| --- | --- |
| Contract | `0x9fD62230aA1149bf443C0a447ffe9D1b2cF4b87E` (StudioNet, chain 61999) |
| Deployment transaction | `0x88d553046d34a8bb7aee59b36b047231746d61c98c8a85e42ad9f3c5ef4ae881` |
| Hosted client | [reality-bridge-beta.vercel.app](https://reality-bridge-beta.vercel.app) — serves the corrected contract |
| Independent verifier | `python genlayer/scripts/verify_submission.py --json` — **all checks pass** against the review manifest, live StudioNet state, Blockstream evidence, and the hosted bundle |
| Review map | [`submission/review-manifest.json`](submission/review-manifest.json) — machine-readable claim IDs linked to artifacts and verifier checks |

**Demonstrated on chain, round 2 on that contract.** The target block landed
just late, which makes the round a direct proof rather than an assertion:

- Panel instant: `2026-09-01T20:52:11Z`
- Block 965083's header timestamp: `20:52:53Z` -- **42 seconds later**
- Resolution actually ran at `20:53:40Z`, by which time the live tip had
  already passed 965083
- Stored outcome: **NO**, `observed_at=1788295973`, receipt
  `d0530d271059263a7f575f02515a283fa96e629c1946609e74e80eded80a140f`

The previous code would have read the tip at resolution time and answered
**YES**. The corrected code compares the block's own header timestamp against
the panel's instant and answers **NO**. The caller's clock moved on; the
outcome did not. Resolution transaction:
`0xa412a8141fc29f85379c9b37fcf41cb707c30c9d8e56566ddf0f39064775dae6`.

The retryable path also ran for real: the two resolution attempts made before
block 965083 existed returned `UNRESOLVED` and left the stored `attempts`
counter at `1`, changing no state and moving no deadline.

Settlement followed: the runner had revealed `YES` against `NO` and was
eliminated, the surviving seat took the pool, and on-chain `claimed_amount`
equals `pool` at `0.020000 GEN`.

Round 3 is the current deadline-bound public round: block `965094`, joins close
`2026-09-01T22:39:51Z`, resolvable `2026-09-02T00:24:51Z`. The hosted client
reads its status from StudioNet; if that real join window has elapsed, the
operator runbook gives the exact command for publishing a fresh future block
checkpoint rather than presenting an expired round as a fixture.

Four contract tests cover the property directly, including one that resolves a
panel long after its instant and asserts the receipt still commits to the
panel's instant rather than the caller's clock, and one that refuses a junk
timestamp instead of storing it.

Full details, including the on-chain settlement evidence, are in
[`SUBMISSION.md`](SUBMISSION.md); the threat model entry is under
*Caller-chosen outcomes through resolution timing* in
[`SECURITY.md`](SECURITY.md).
