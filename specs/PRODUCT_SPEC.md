# Consensus Noir product specification

## Case dossier

Each case is published with a stable `case_id`, title, premise, incident,
investigation question, 3–5 suspects, suspect statements, timeline entries,
5–12 evidence objects, optional HTTPS sources, rubric, and four absolute
deadlines. Evidence and statements use stable IDs and are frozen at publication.

The seeded example case is **The Glasshouse at 02:17**: a rain-slick conservatory
where a missing ledger, a stopped clock, and three mutually incompatible alibis
leave the validators to decide whether one suspect is materially better
supported—or whether the file should be void.

## Lifecycle

`DRAFT → OPEN → REVEAL → RESOLVABLE → RESOLVED | VOID | REFUNDABLE`.
`CANCELLED` is a terminal branch for an unstarted draft or an underfilled case
after its accusation deadline. Anyone may advance a case when its prerequisite
timestamp has passed; no curator call is needed after publication.

## Accusations

Players commit once during OPEN, paying the exact case stake. The commitment
binds player address, suspect ID, normalized theory digest, the three chosen
evidence IDs (sorted), and salt. A reveal is accepted only during REVEAL and must
reproduce the stored commitment exactly. Missing or invalid reveals can never win
and do not block resolution.

## Payouts

Correct revealed accusers share the whole pool, weighted by evidence agreement.
Each correct accuser's weight is `1 + (their picks that the validators also
cited)`, so a weight ranges from 1 to 4. Payout is
`escrow * weight / total_weight`, with the integer remainder assigned one wei
each to the lowest-sorted addresses. Naming the right suspect for the right
reasons therefore pays more than guessing it, and a case where everyone is
equally right still divides the pool evenly. There is no protocol fee.

## Result codes

Allowed reason codes are short, lowercase identifiers such as `convergent_evidence`,
`material_contradiction`, `underdetermined`, `source_unavailable`, and
`malformed_analysis`. Free-form reasoning is deliberately not persisted or used
for settlement.

## Security invariants

The direct suite covers these invariants: immutable opened material; no culprit
setter; one entry/accusation per address; exact reveal reproduction; no winning
missed/invalid reveal; consensus-only resolution; fixed deadlines across retries;
at-most-once terminal resolution; individually idempotent claims/refunds;
curator cannot withdraw escrow; conserved accounting; temporary failures cannot
trap funds past the fixed refund deadline; deterministic VOID/cancellation
refunds; and no frontend/backend payload can inject an accepted culprit.
