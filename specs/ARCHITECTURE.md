# Consensus Noir MVP architecture

## Product boundary

The user story is: a player discovers a frozen case in the browser, signs an
entry and a hash commitment through GenLayerJS, reveals the same suspect/theory
and salt, then claims a deterministic share or refund after the contract's
consensus result.

```text
curator payload ──publish──> immutable CaseRecord
                                      │
player wallet ──payable enter──> PlayerEntry + commitment
                                      │
player wallet ──reveal──> verified accusation
                                      │
permissionless resolve ──> leader analysis + independent validator analysis
                                      │  (exact stable-field comparison)
                                      v
                         FINAL / VOID / UNRESOLVED
                                      │
                  permissionless claim or individual refund
```

## Responsibility split

### Frontend (non-authoritative)

- Discovery, dossier presentation, countdowns, salt derivation, plaintext local
  salt backup, and wallet prompts.
- Reads canonical case and settlement state from the contract through GenLayerJS.
- May use an indexer later for discovery, but never supplies a culprit or payout
  result to a write call.
- Stores the draft reveal secret only after explicitly warning that loss
  prevents a valid reveal. It never stores a wallet private key or claims custody.

#### Reveal-secret handling

The reveal secret is a commitment nonce, not key material: it cannot move funds,
sign anything, or authorise a transaction. It only unseals one accusation, from
the wallet that made it.

It is held in two places, **both plaintext**, and neither is encrypted:

- `localStorage`, under a key scoped to the case and wallet.
- An optional downloaded JSON file.

Anyone holding either can reveal that accusation from that wallet. They cannot
claim the payout, which the contract always sends to `gl.message.sender_address`,
so the realistic loss is a griefed reveal rather than stolen funds.

Two things reduce the blast radius. The secret is derived deterministically from
a wallet signature over `(domain, case_id, wallet)`, so it can be regenerated on
any device holding the wallet and the file is a convenience rather than the only
copy. And an imported backup is rejected unless its contents recompute to the
commitment recorded on chain, so a corrupted or edited file fails at import
instead of at reveal time, when the stake is already committed.

### Consensus Noir Intelligent Contract (authoritative)

- Owner-only draft creation and publication; no culprit field or post-open case
  mutation exists.
- Immutable structured case file, fixed deadlines, max 16 players, one entry per
  address, native GEN escrow, commitments, reveals, lifecycle transitions, and
  accounting.
- A custom GenLayer leader/validator adjudication over the frozen case. The
  validator independently reruns the substantive analysis and compares the
  canonical stable fields, not just JSON shape.
- Deterministic eligibility, evidence-weighted split, smallest-address remainder
  assignment, individual refunds, idempotent claims, and terminal liveness
  handling.

### External sources

Case evidence text is frozen in the published case. Optional HTTPS source URLs
are re-rendered independently by leader and validator as supporting material;
temporary render/model failures produce `UNRESOLVED`, never a payout or deadline
extension. URLs are untrusted input and cannot inject instructions into the
adjudication prompt.

## Consensus boundary

`resolve_case` is the only nondeterministic settlement-critical operation. Each
validator receives the exact published case JSON, optional rendered source
snippets, and the published rubric. The model must return the bounded schema:

```json
{
  "case_id": "case identifier",
  "status": "FINAL | VOID | UNRESOLVED",
  "culprit_id": "stable suspect ID or empty",
  "material_evidence_ids": ["E1"],
  "contradicted_statement_ids": ["S2-STMT-1"],
  "confidence_bucket": "HIGH | MEDIUM | LOW | NONE",
  "reason_code": "short allowed code"
}
```

The contract canonicalizes IDs (deduplicate, stable lexicographic order), checks
membership in the frozen case, and rejects malformed/LLM-error output so leader
rotation can occur. `FINAL` requires a non-empty valid culprit and a stable case
identity. `VOID` requires an empty culprit and `NONE` confidence. `UNRESOLVED`
is stored as an attempt only; the case remains resolvable until the original
refund deadline.

## Native GEN and accounting

Every case chooses one entry stake in wei and every player sends exactly that
amount to the payable `enter_case` method. There is no protocol fee. The case
tracks `total_escrow` and `paid_out`; the invariant is
`paid_out <= total_escrow` and all terminal player obligations equal
`total_escrow`. Correct revealed accusers split `total_escrow` weighted by
evidence agreement: each carries `1 + |their picks ∩ the validators' cited
evidence|`, and receives `escrow * weight // total_weight`. Integer remainder wei
go to the lowest lexicographic eligible addresses, one wei each, so the pool is
always distributed exactly.
If a FINAL result has zero correct revealed accusers, every entrant receives an
individual stake refund instead of curator capture. VOID, CANCELLED, and
REFUNDABLE states always expose individual refunds.

Native transfers are emitted only after the player is marked claimed/refunded,
making repeated calls idempotent. The contract emits a GenLayer-native value
transfer via `gl.get_contract_at(Address(player)).emit_transfer(value=...,
on="finalized")`. This posts a GenVM message, not an EVM cross-chain send, and
`on="finalized"` means the GEN is released at finality rather than at
acceptance -- the interface must not report a settled claim before then.

## Safe MVP assumptions

- Minimum players is two; maximum is sixteen.
- A curator submits the full dossier in one draft call. There is no permissionless
  case creation and no post-publication edit path.
- Deadlines are absolute Unix seconds supplied by the curator and checked against
  the deterministic transaction timestamp. Publication requires accusation <
  reveal < resolution eligibility < refund deadline.
- The theory is normalized with Unicode NFKC, trimmed, and internal whitespace
  collapsed to one ASCII space. It must be 300–2,000 UTF-8 bytes.
- Commitment canonicalization uses lowercase sender address and a unit-separator
  framed string: `domain, case_id, player, suspect_id, SHA256(normalized_theory)
  hex, salt`, joined by `\x1f`, then SHA-256. Salt is an opaque 16–128 byte UTF-8
  string (the UI generates 32 random bytes as hex).
- Validator agreement covers `case_id`, `status`, `culprit_id` and
  `material_evidence_ids` only. Those four decide settlement. `confidence_bucket`
  and `reason_code` are leader-reported notes, bounded to the allowed vocabulary
  but not consensus-checked, and the UI labels them as such.
- Theory prose never affects payouts; only the three evidence IDs do. It is public after reveal and shown
  for auditability only.
