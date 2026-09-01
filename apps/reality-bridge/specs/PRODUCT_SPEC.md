# Reality Bridge product specification

Network: **GenLayer StudioNet only** (chain id `61999`). StudioNet is the sole
supported network for this product.

## Product promise

Cross a bridge whose safe panels are determined by reality. The farther ahead
you stand, the less information you have and the more of the pool you can earn.

## Core loop

1. The publisher authors an ordered bridge of binary real-world claims and
   opens it. Questions, conditions, evidence sources and deadlines are frozen
   at that moment and can never change.
2. Players join before the join deadline by sending the exact entry. Join order
   becomes crossing order and is immutable.
3. Once the join window closes, **anyone** may start the round.
4. The active runner commits a salted hash of `YES` or `NO` for the first
   unresolved panel, inside their own commit window.
5. The runner reveals the same choice and salt before their reveal cut-off.
6. After the panel's evidence timestamp, **anyone** may request resolution.
7. Validators independently render the registered sources and must derive the
   same decision fields before an outcome is written: `YES`, `NO` or `VOID`.
8. A correct runner survives and gains one discovery credit. An incorrect
   runner is eliminated. A `VOID` panel eliminates nobody and awards nothing.
9. If the runner is eliminated, the next surviving seat becomes the runner and
   inherits every panel that has already been opened.
10. The round ends when every panel resolves, when no runner remains, or when
    the immutable terminal deadline passes.

## Round lifecycle

```text
DRAFT ──► OPEN ──► ACTIVE ──► SETTLED
   │        │         │
   │        │         └──────► REFUNDABLE   (no survivor / terminal expiry)
   │        └────────────────► REFUNDABLE   (under-subscribed / publisher cancel)
   └─────────────────────────► CANCELLED    (empty round, publisher cancel)
```

- `DRAFT` — the publisher is still adding panels. Nobody may join.
- `OPEN` — definitions are frozen; players may join until the join deadline.
- `ACTIVE` — crossing and resolution are in progress; no new players.
- `SETTLED` — every claim amount is fixed and individually claimable.
- `REFUNDABLE` — the round unwound; every joined entry is individually
  refundable exactly once.
- `CANCELLED` — an empty round was withdrawn before anybody joined.

There is **no `SETTLING` state**. Settlement is a single atomic step inside the
transaction that resolves the last panel, so an observable intermediate state
would be dead code. Earlier drafts of this document described one; the contract
never implemented it and the state has been removed rather than faked.

## Panel definition

Every panel commits every field that can affect settlement:

- Bridge position (panels are appended in order and never reordered).
- A binary question written so `YES` and `NO` are mutually exclusive.
- An explicit `YES` condition.
- A **choice deadline** — the panel's information cut-off. No commitment may be
  accepted at or after this instant.
- A **resolution time** — the earliest moment anyone may ask for resolution.
- One primary HTTPS source and up to two corroborating HTTPS sources, each on a
  host the publisher has registered in the contract's source registry.

### Source policy

- A source host must be registered with `register_source` before it can back a
  panel. `revoke_source` blocks a host from **new** panels and never touches a
  panel that is already frozen.
- URLs must be `https://`, must have a real domain host (no IP literal, no
  userinfo), and must carry **no query string and no fragment**. Registered
  sources therefore have to expose stable, path-addressed pages, which removes
  the most obvious participant-controlled surface.
- Deterministic priority: **the primary source decides.** A corroborating source
  can only downgrade a `FINAL` primary to `VOID` when it directly contradicts
  it; it can never create a `FINAL` on its own. An unavailable corroborating
  source is ignored. An unavailable primary yields the retryable `UNRESOLVED`
  state.

### Outcomes and reason codes

| Outcome | Reason code            | Meaning                                                     |
| ------- | ---------------------- | ----------------------------------------------------------- |
| `YES`   | `FINAL_EVIDENCE`       | The evidence establishes the condition.                      |
| `NO`    | `FINAL_EVIDENCE`       | The evidence establishes the condition is not met.           |
| `VOID`  | `VOID_EVIDENCE`        | Cancelled, contradictory or permanently unanswerable.        |
| `VOID`  | `VOID_CONTRADICTION`   | A corroborating source contradicted the primary source.      |
| `VOID`  | `VOID_LIVENESS`        | The panel passed its information cut-off with no valid commitment behind it. |
| —       | `UNRESOLVED`           | Not written. Retryable; no deadline moves and no state changes. |

`VOID` is never treated as `NO`. It eliminates nobody and awards nothing.

### Evidence receipt

For every written outcome the contract stores a deterministic receipt:

`<US>` is the ASCII unit separator (`0x1F`), which is rejected in every
operator-supplied string so a stored value can never forge a pre-image.

```text
sha256("reality-bridge-evidence-v1" <US> round_id <US> tile_index <US> primary_host
       <US> status <US> outcome <US> event_id <US> effective_date)
```

`event_id` and `effective_date` are **normalized extraction fields** taken from
the page: an identifier folded to `[A-Z0-9.:/_-]` (max 48 characters, `NONE`
when the page carries none) and a strict `YYYY-MM-DD` day (empty when the page
states none). Day granularity, aggressive folding and a fixed alphabet are
deliberate: they keep the fields substantive while staying stable enough for
independent validators to agree. Validators compare every one of these fields
plus the receipt itself; disagreement rotates the leader rather than writing a
disputed outcome.

Free-form model prose never reaches storage.

## Choice privacy

GenLayer is not confidential storage. A choice is hidden until reveal with a
domain-separated commitment:

```text
sha256("reality-bridge-choice-v1" <US> round_id <US> tile_index <US> player <US> choice <US> salt)
```

The contract recomputes it deterministically. Only the active runner may commit
or reveal, and both are single-use per attempt. **Losing the salt means losing
the ability to reveal**, which forfeits the crossing — so the interface makes
the player export a versioned recovery bundle before it will sign the commit.

## Deadlines and liveness

Each panel carries an immutable `choice_deadline` and `resolution_time`. Each
*runner attempt* additionally carries its own window:

```text
attempt_deadline = min(now + commit_window, tile.choice_deadline, terminal_deadline)
reveal_cutoff    = attempt_deadline + reveal_grace
```

When a runner is eliminated for a missed commit or a missed reveal, the next
seat receives a **fresh** attempt window on the same panel — but only while the
panel's information cut-off is still in the future. Once that cut-off passes,
accepting a new commitment would let a runner answer with knowledge, so the
panel is voided with `VOID_LIVENESS` and the round advances instead.

Every attempt deadline is clamped by the round's immutable terminal deadline, so
no sequence of failures can extend a round.

The terminal deadline is a **hard economic boundary**, not merely a cap on
derived deadlines. Once it passes, the round can only unwind: `resolve_tile`
stops settling and enters the refund path instead, and settlement re-checks the
deadline. Resolution and expiry can therefore both be in flight past the
deadline without the outcome depending on which lands first.

### Permissionless actions

`start_round`, `forfeit_missed_commit`, `forfeit_missed_reveal`, `resolve_tile`,
`expire_round`, `claim` and `refund` are all permissionless (claim and refund
pay only the caller's own recorded amount). No privileged keeper exists, and the
interface exposes every one of them.

### Schedule validation

The contract rejects impossible schedules at authoring time:

- `join_deadline` must be in the future.
- `terminal_deadline ≥ join_deadline + commit_window + reveal_grace`.
- Panel 0: `choice_deadline ≥ join_deadline + commit_window`, so a round that
  activates exactly at its join deadline still gives the first runner a full
  commit window.
- Panel *n* > 0: `choice_deadline > previous.choice_deadline` **and**
  `choice_deadline ≥ previous.resolution_time + commit_window`.
- Every panel: `resolution_time ≥ choice_deadline + reveal_grace`, so resolution
  can never race a legally pending reveal.
- Every panel: `resolution_time ≤ terminal_deadline`, re-checked on `open_round`.
- `commit_window` ∈ [60 s, 24 h]; `reveal_grace` ∈ [30 s, 24 h].

## Economics

All amounts are native StudioNet GEN, a test asset with no real-world value.

| Rule | Value |
| ---- | ----- |
| Minimum players | **2** — a round with fewer unwinds into refunds at start |
| Maximum players | **8** |
| Panels per round | 1 to **3** |
| Entry | exact `entry_amount`; over- and under-payment both revert |
| Protocol fee | **0** (`PROTOCOL_FEE_BPS = 0`); the whole pool is distributed |
| Pool | `player_count × entry_amount` |
| Survivor weight | `1 + 3 × discovery_credits` |
| Payout | `pool × weight_i / Σ weight` for each survivor, integer division |
| Remainder | to the highest-credit survivor; ties break to the earliest join index |
| Eliminated seats | receive **nothing** at settlement |
| Maximum loss | exactly one entry; the contract can never take more |

**One-player rounds are not allowed.** A single player has no counterparty and
no downside, so `start_round` unwinds an under-subscribed round into refunds
instead of activating it.

### Why later seats can profit without running

Join order is the risk curve: seat 1 faces every unresolved panel, later seats
inherit whatever earlier runners opened. A survivor who never ran still risked
their entry, so they keep a base weight of 1 — but the `×3` credit weight means
a runner who opens all three panels holds weight 10 against a passive
survivor's 1. With three seats and a full crossing, the runner takes 250/300 of
the pool and each passive survivor takes 25 of their 100 entry. Passivity is
survivable and unprofitable, which is the intended shape.

### Refund policy

`CANCELLED`, under-subscription, no-survivor and terminal expiry all resolve the
same way: **every joined seat — including eliminated seats — may claim exactly
its own entry back, once.**

The alternative (paying an expired round out to survivors) was rejected. An
expired round has no complete, evidence-backed result to pay out on, and
refunding entry is the only distribution that is conservation-exact for every
player count and that no single participant can profit from. Elimination
penalties apply when a round actually completes; they are not a way to
redistribute an unfinished game. An eliminated seat can never receive more than
it paid.

### Conservation

The contract asserts conservation inside the transaction that fixes amounts:

- `Σ claim_amount == pool` at settlement (remainder included).
- `Σ refund_amount == pool` when a round unwinds.
- `claim` and `refund` each pay one recorded amount once, writing the collected
  flag **before** the external transfer, so a re-entrant call hits the
  duplicate-collection guard.

## Publisher powers

The publisher may: register and revoke evidence hosts, create a round, append
panels, open a round, and cancel a round that has not started (a populated round
only after its join deadline, and only into the refund path).

The publisher may also hand the role on. Rotation is two-step:
`transfer_ownership` nominates an account and `accept_ownership` completes it
from that account. A nomination can be withdrawn with
`cancel_ownership_transfer`, and the zero address is rejected. One-step
transfer was rejected because a mistyped address would permanently strand the
only role that can author rounds.

The publisher may **not**: change any panel after opening, choose an outcome,
eliminate a player, reorder seats, change weights, move a deadline, or withdraw
player escrow. There is no owner settlement method and no admin withdrawal.

## Bot and Sybil policy

One seat per address, an 8-seat cap and a curated publisher are the whole
defence. Reality Bridge is **not Sybil-resistant**: an operator with many
addresses can buy the early seats and therefore the discovery credits. That is
acceptable for a StudioNet build with no real-value assets, and it is the main
blocker for permissionless round creation. See
[`KNOWN_LIMITATIONS.md`](../KNOWN_LIMITATIONS.md).

## Trust and moderation

The MVP uses an owner-curated publisher. This is a content-safety and
source-quality role, not a settlement role.

Validator consensus establishes **agreement about how registered public evidence
should be interpreted**. It does not establish that the evidence is true. The
interface states this wherever a receipt is shown.

## Non-goals for this release

- Non-StudioNet or real-value play.
- Confidential persistent state.
- Player-created rounds.
- Cross-chain escrow or bridge messaging.
- Tradable positions or a secondary market.
- AI-generated questions without human review.
- More than three panels or eight players.

## Success criteria

- A complete round runs without an authoritative backend or a privileged keeper.
- Independent validators agree on every persisted decision field.
- A player cannot change a choice after committing, and only the runner can
  commit or reveal.
- A publisher cannot change evidence or criteria after opening.
- Any account can trigger overdue activation, forfeiture, resolution or expiry.
- Every terminal outcome is deterministic and individually claimable.
- A player who loses their browser state can still reveal from an exported
  recovery bundle.
