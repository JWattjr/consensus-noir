# Reality Bridge threat model and security notes

Scope: the intelligent contract in `genlayer/contracts/reality_bridge.py`, the
StudioNet frontend in `frontend/`, and the operational path in
[`DEPLOYMENT.md`](DEPLOYMENT.md). Every asset is a **GenLayer StudioNet test
asset with no real-world value**.

## Trust assumptions

1. **GenLayer consensus is honest-majority.** A validator majority that agrees
   on a false reading of the evidence can write a false outcome. Consensus
   establishes *agreement about how registered public evidence should be
   interpreted*, not that the evidence is true.
2. **The publisher is trusted for content quality only.** They register evidence
   hosts and author panels. They cannot touch funds, outcomes, order or weights
   once a round opens.
3. **Registered sources are honest-ish.** A source that changes its published
   result between the leader's read and a validator's read causes disagreement,
   which rotates the leader; it does not silently flip an outcome.
4. **The player controls their own key and their own recovery bundle.**

## Assets

| Asset | Protection |
| ----- | ---------- |
| Native GEN escrow | conservation asserted in-transaction; no admin withdrawal |
| Unrevealed choice | salted, domain-separated SHA-256 commitment |
| Panel definitions | frozen at `open_round`; no mutator exists |
| Outcome integrity | independent validator agreement on all persisted fields |
| Round liveness | per-attempt windows, permissionless recovery, terminal deadline |

## Attack surface and mitigations

### Prompt injection through evidence

A page can contain text aimed at the model. Layered defence:

1. Rendered text is sanitised (control characters removed, unit separator
   stripped) and truncated to 16 000 characters.
2. The fence markers `<<<REALITY_BRIDGE_EVIDENCE` /
   `REALITY_BRIDGE_EVIDENCE>>>` are stripped from the page, so a page cannot
   close the fence and escape into the instruction context.
3. The prompt states explicitly that everything inside the fence is untrusted
   data and that instructions inside it must be ignored.
4. Publisher-supplied text is rejected if it contains a fence marker or the
   separator.
5. **Blast radius is bounded.** Even a fully successful injection can only move
   `status` and `outcome`. `reason_code` is chosen by the contract from a fixed
   set, and `evidence_receipt` is computed by the contract; neither is ever
   copied from model output.
6. A single validator that reads the page differently blocks the write.

Covered by `test_malicious_page_instructions_do_not_change_the_stored_decision`.

### Commitment griefing

Previously, any account could call `commit_choice` for the active runner and
burn their single commitment slot with a hash the runner could not open,
guaranteeing elimination. `commit_choice` and `reveal_choice` now require
`gl.message.sender_address` to equal the runner's account. Covered by
`test_only_the_active_runner_may_commit_or_reveal`.

### Late-information commitment

Accepting a commitment after a panel's real-world answer is public would let a
runner answer with knowledge. No commitment is accepted at or after
`tile.choice_deadline`, and a recovery that arrives past that instant voids the
panel (`VOID_LIVENESS`) instead of re-arming it.

### Caller-chosen outcomes through resolution timing

Resolution is permissionless: anyone may call it once a panel is resolvable.
If a panel were answered against the world *at the moment of the call*, then
any condition that becomes true over time would hand the outcome to whoever
chose when to call. The published Bitcoin panel had exactly this shape — "is
the tip height above N", read from a live tip endpoint. Tip height only rises,
so the same panel answered `NO` to an early caller and `YES` to a late one,
with real money on the result.

Three things now prevent it:

- The panel's own `resolution_time` is passed into the consensus block and the
  condition is answered **as of that instant**, never as of the call.
- A settling answer must carry `observed_at`, the timestamp the evidence page
  itself gave for the observation relied on. A `FINAL` without one is refused
  and the panel is voided (`VOID_UNANCHORED`).
- Both instants are inside the hashed receipt, so the stored record commits to
  when the answer was true rather than only to what it was.

The published question was also reformulated onto a datum that is fixed once
it exists — a specific block's header timestamp, read from a height-addressed
URL — instead of a live, moving value. A source that cannot answer yet yields
the retryable `UNRESOLVED`, which moves no deadline and changes no state,
rather than an outcome. Covered by
`test_caller_timing_cannot_move_a_payout_bearing_outcome`,
`test_a_final_without_a_timestamped_observation_is_voided`,
`test_receipt_binds_the_timestamp_the_evidence_carried` and
`test_a_junk_observation_timestamp_is_refused_rather_than_stored`.

### Ordering race at the terminal deadline

A revealed final panel plus a lapsed terminal deadline used to leave two valid
transactions in flight: `resolve_tile` settled weighted payouts while
`expire_round` refunded everyone, so whichever landed first decided the money.
The deadline is now a hard boundary — resolution past it unwinds the round
instead of settling, and settlement itself re-checks the deadline. Both
orderings are tested at `terminal + 1` and must converge on the same refundable
outcome.

### Losing the publisher role

Round authoring is owner-only, so a lost publisher key used to mean no further
round could ever be published on a deployment. `transfer_ownership` /
`accept_ownership` is a two-step rotation: the nominee must accept, the
proposal can be withdrawn, and the zero address is rejected. One-step transfer
was rejected because a mistyped address would strand the role permanently.

### Round stalling

A runner who simply stops acting used to be able to freeze a round: the previous
`forfeit_missed_reveal` handed the panel to a new runner whose commit deadline
had already passed, so nobody could ever act again. Now each runner attempt gets
its own window, both forfeit paths are permissionless and exposed in the UI, and
every derived deadline is clamped by the immutable terminal deadline. A round
therefore always terminates in `SETTLED`, `REFUNDABLE` or `CANCELLED`.

### Reentrancy and hostile recipients

`claim` and `refund` write the collected flag and update round accounting
**before** `emit_transfer`, so a re-entrant call hits the duplicate-collection
guard and reverts. Direct mode does not execute an external recipient, so the
ordering invariant is asserted rather than exercised against a hostile contract;
see [`KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md).

### Overpayment, underpayment and double joins

`join_round` requires `gl.message.value == entry_amount` exactly and rejects a
second seat for the same address.

### Sybil seats

Join order is the risk curve, so buying the early seats buys the discovery
credits. One seat per address and an eight-seat cap are the only defences.
Reality Bridge is **not Sybil-resistant** and does not claim to be; this is the
main blocker for permissionless round creation.

### Salt loss

Losing the salt means losing the ability to reveal, which forfeits the crossing.
Mitigations: salts come from the platform CSPRNG (the code throws rather than
falling back to `Math.random`); a versioned recovery bundle must be copied or
downloaded and explicitly acknowledged before the commit is signed; the bundle
is also written to durable local storage *before* the wallet step, so a crash
during signing cannot orphan a commitment; and the bundle can be re-imported on
any device, validated against the wallet, contract, round, panel and the
on-chain commitment. **Salts are never uploaded anywhere.**

### Wrong network and wrong wallet

The frontend reads `eth_chainId`, blocks every write off chain `61999`, and
offers a switch/add-network flow. Actions are additionally gated on the
connected account's role: only the runner sees an enabled commit or reveal, and
only a wallet with a recorded amount sees an enabled claim or refund.

### Misreported transactions

A returned hash means *submitted*, nothing more. GenLayer can leave a
transaction `UNDETERMINED`, time out a leader, or accept a transaction whose
contract execution reverted. `classifyTransaction` treats all of those as
failures and surfaces the contract's own message.

Success additionally requires positive proof: `execution_result === "SUCCESS"`.
A decided transaction whose leader receipt has not arrived is reported as
pending, not as done — absence of evidence is not evidence of success. The
watch also runs through to `FINALIZED` rather than stopping at acceptance,
because authoritative reads use `TransactionHashVariant.LATEST_FINAL`; ending
early left the board showing pre-transaction state. When finality outlasts the
wait budget the result is reported as accepted-but-not-final, which is not a
failure and is not labelled as one.

### Simulation mistaken for live play

The simulation is a separate mode, entered only by an explicit click. It has its
own hatched banner and network pill, its own account and contract placeholders,
and it never uses live-consensus vocabulary: resolution reads "run the scripted
outcome", receipts read "what the scenario recorded". It also runs on its own
scripted clock, so every scenario completes immediately instead of stalling on
a real deadline. Outcomes
are fixed by the scenario script before the player chooses, so it can never
simply agree with the player. A StudioNet read failure surfaces an error; it
never drops the player into a simulation.

## Known weaknesses accepted for this release

- Extraction fields (`event_id`, `effective_date`) are model-derived. Heavy
  normalisation keeps them stable, but a page with an ambiguous identifier can
  still cause validator disagreement. The failure mode is a retryable
  non-write, not a wrong write.
- The corroboration check is best-effort: an unavailable corroborating source is
  ignored rather than blocking a primary `FINAL`.
- Extraction stability is the main residual risk; see above.

## Reporting

This is a StudioNet demonstration build. Do not deploy it to a network carrying
real value without an independent audit and a resolution to the Sybil and
extraction-stability items above.
