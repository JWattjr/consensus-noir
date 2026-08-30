# Consensus Noir

**A detective game where nobody knows the answer — not even the people who built it.**

Every online deduction game today has a trusted server holding a secret answer key.
You are trusting the operator not to move the goalposts and not to pay their friends.

Consensus Noir removes the answer key. A frozen case file is published, players stake
GEN on a suspect behind a hash commitment, and when the windows close, GenLayer's
validators independently read the same evidence and decide who did it. **The contract
has no `set_culprit` function.** That absence is the product.

| | |
|---|---|
| **Live app** | https://frontend-nu-one-15.vercel.app/ |
| **Contract** | [`0x3133B01d4EB7e1022913dF5fb1219cAE77D3f4a6`](https://genlayer-explorer.vercel.app/address/0x3133B01d4EB7e1022913dF5fb1219cAE77D3f4a6) |
| **Network** | GenLayer StudioNet — chain `61999`, RPC `https://studio.genlayer.com/api` |
| **Playable case** | `glasshouse-0217-live` |
| **Runner** | `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` |

---

<!-- Before final submission: add the walkthrough video link to the fact table above. -->

## Why this needs GenLayer

A verdict over ambiguous prose is not something an oracle can feed you or a Solidity
`if` can compute. It needs many independent reasoners looking at the same evidence and
agreeing on a discrete answer. That is the one thing GenLayer does that no other chain
does, and it is the only reason this game can exist without a trusted operator.

The Intelligent Contract is not a feature bolted onto a dapp. Remove it and there is no
game — only a quiz with no grader.

**Payouts depend on the validators' reasoning, not just their verdict.** Players commit
to a suspect *and the three exhibits that prove it*. Correct accusers split the pool
weighted by `1 + (their exhibits the validators also cited)`. Naming the right suspect
for the right reasons pays more than guessing it.

---

## Reviewer walkthrough (~5 minutes)

You need a browser wallet and a little StudioNet GEN. The stake is 1 GEN.

1. **Open** https://frontend-nu-one-15.vercel.app/ — you should see the case file
   *The Glasshouse at 02:17* with a live countdown, not a preview banner. The footer
   shows the contract address.
2. **Connect your wallet.** If you are on the wrong chain the header turns into a
   *Switch to GenLayer StudioNet* button; it registers chain `61999` automatically if
   your wallet does not know it yet.
3. **Read the dossier** — three suspects, their statements, the timeline, and the
   evidence board. Everything the validators will read, and nothing more.
4. **Make an accusation.** Pick a suspect, pick exactly three exhibits, write a theory
   (300–2,000 bytes), then press **Create key** — this signs a message (no funds, no
   transaction) that deterministically derives your reveal key, so you can regenerate
   it on any device with the same wallet. Read the stake summary, then stake.
5. **Watch the lifecycle.** The status stays neutral through `PENDING → ACCEPTED` and
   only turns green at `FINALIZED`. Payouts are emitted `on="finalized"`, so this is
   not cosmetic — GEN genuinely does not move before then.
6. **Reveal** after the accusation window closes. Anyone can press *Advance this case*
   to move it on; no curator is involved.
7. **Request the verdict.** Any wallet can trigger it. The validators return a culprit
   plus exactly three cited exhibits.
8. **Claim.** Correct accusers split the pool, weighted by exhibit agreement.

**Verify the central claim yourself:** open
[`contracts/consensus_noir.py`](contracts/consensus_noir.py) and search for
`set_culprit`. There isn't one. The only writer of `Resolution` is `resolve_case`, and
the only source of a culprit is `gl.vm.run_nondet_unsafe`. A direct test asserts this
(`test_open_material_is_immutable_and_no_culprit_setter`).

---

## Proof on chain

### Production deployment — the contract behind the live app

| Step | Transaction |
|---|---|
| Deploy | `0x404196801da41706ac008537b89223bcec4dc8d281902ed92691bf892f36c2c7` |
| `create_case` | `0x339864e4809f5873055398706e0e85e1333c988f4c906f7ef89b50e9a1a00dd3` |
| `publish_case` | `0xab1154b0523426d47c7b04eb6bcfd89a392bd2e6910ba7ee0621cbd4ff67c6e9` |

Case `glasshouse-0217-live` is published and **open for entries** — this is the case a
reviewer plays. Its own settlement hashes are recorded here once players run it to a
verdict.

### Full lifecycle, already run against real validators

The complete cycle has been exercised end to end on StudioNet with **no mocks** — a
real leader, real validators, a real consensus verdict and a real payout — on a sibling
deployment of the identical contract,
[`0x08219e9d65F14412Df3496b63035d052B9D44005`](https://genlayer-explorer.vercel.app/address/0x08219e9d65F14412Df3496b63035d052B9D44005),
case `glasshouse-0217-integration`:

| Step | Transaction |
|---|---|
| Owner entry | `0xc917d5746080ebb53d0bd2fc193cadb0206034d187535028ea19cec83d9fcb88` |
| Second entry | `0xef40b273f220b9db3700acf38dd759279cfbe9c1cde87be836af6a2638499c3b` |
| Open reveal | `0x8405bc5308c825ad96295a0c8b3f0804f9f3680a563fa6af0a970e6b893bcd2d` |
| Owner reveal | `0x5a8dd1a1a9db845ce0e1bcfa50ae5d0065285026aea1f07c9aa46349286c55ac` |
| Second reveal | `0xeb237f1b505b66d8d8c72cf2cc2ea5341a5301dd10c49fe13eff258a209a7f7c` |
| Advance to resolvable | `0xc5daf336b134ed62d7f6e42134d42e0270be20ce5b17bf5ae04b4f1fabee658e` |
| `resolve_case` | `0x0c47c68ba0cd4b66a4f8e054307e03abe7a6831168378fa001793f30e14d39cc` |
| `claim_case` | `0x95ca84ffbc1016b12095f50e09374dbb1b4bad35a78731f0ea9645b462a949b1` |

**Validator outcome:** `FINAL` / `MAJORITY_AGREE`. Culprit `SUSPECT-B`, cited evidence
`EVIDENCE-01`, `EVIDENCE-03`, `EVIDENCE-04`, reason `convergent_evidence`.

Full records, including a note on a client-side wait timeout during `resolve_case`
(the transaction was confirmed `FINALIZED` by read-only poll before the claim), are in
[`deployment/studionet.json`](deployment/studionet.json).

---

## Reproduce it locally

```powershell
# Contract: AST lint + semantic validation against the pinned runner
$env:PYTHONIOENCODING = "utf-8"      # Windows consoles cannot encode the linter's check mark
genvm-lint check contracts/consensus_noir.py --json

# 26 deterministic tests: lifecycle, commit/reveal, settlement, evidence weighting
python -m pytest tests/direct -v

# Frontend
cd frontend
npm install
npm run lint
npm run typecheck
npm run build
npm run dev            # http://localhost:3000
```

To point a local frontend at the deployed contract, copy `frontend/.env.example` to
`frontend/.env.local` and set:

```
NEXT_PUBLIC_CONSENSUS_NOIR_CONTRACT=0x3133B01d4EB7e1022913dF5fb1219cAE77D3f4a6
```

Without it the app runs in an explicitly-labelled preview mode against sample data. It
never presents sample data as chain data.

### The hosted consensus test

This one spends real GEN, so it is opt-in and needs two funded StudioNet accounts in
`gltest.config.yaml` (that file ships inert; **never commit keys**).

```powershell
python -m pytest tests/direct/test_integration_contract_parity.py -q   # run this FIRST
$env:CONSENSUS_NOIR_RUN_INTEGRATION = "1"
python -m pytest tests/integration -m integration -v -s
```

The parity guard exists because the hosted test performs several network writes before
it reaches the reveal — a stale commitment there would only surface after money had
moved. The guard recomputes its commitment against the contract preimage in
milliseconds.

---

## How it works

```
DRAFT ──publish──► OPEN ──advance──► REVEAL ──advance──► RESOLVABLE ──resolve──► RESOLVED
                     │                  │                     │                     │
                     └──────────────────┴─────────────────────┴──► CANCELLED / VOID / REFUNDABLE
```

- **Curators** publish a complete dossier in one call. Publishing freezes it forever —
  3–5 suspects, 5–12 exhibits, statements, timeline, rubric, four absolute deadlines.
- **Players** stake the exact case amount with a SHA-256 commitment binding domain,
  case, wallet, suspect, theory digest, sorted exhibit IDs and salt. One entry per wallet.
- **Anyone** can advance the lifecycle or request the verdict. No operator is required
  after publication, and there is no curator withdraw path anywhere in the contract.
- **Validators** reach agreement on `case_id`, `status`, `culprit_id` and
  `material_evidence_ids` — the four fields that decide money. `confidence_bucket` and
  `reason_code` are leader-reported notes, and the UI labels them as not
  consensus-checked rather than dressing them up as a consensus record.
- **Settlement** pays correct accusers `escrow × weight ÷ total_weight`, remainder wei
  one each to the lowest addresses, so the pool always distributes exactly. If a FINAL
  verdict names a suspect nobody accused, every entrant recovers their stake.
- **Liveness:** past the refund deadline with no verdict, anyone can open the refund
  branch. Underfilled cases can be cancelled. No balance can be stranded.

Sources, when a case uses them, are fetched **once at publication** with an HTTP status
check and stored with a content hash. Adjudication then reads frozen text, so a page
that changes later cannot alter a verdict or break validator agreement.

Design details: [`specs/ARCHITECTURE.md`](specs/ARCHITECTURE.md),
[`specs/PRODUCT_SPEC.md`](specs/PRODUCT_SPEC.md),
[`docs/REPRODUCTION.md`](docs/REPRODUCTION.md).

---

## Limitations

- StudioNet only. GEN here is testnet-only and carries no real-world value.
- Case creation is curator-only in this MVP. Community submission — judged by a second
  Intelligent Contract call on *structure only*, never the solution — is the intended
  next step.
- There is no protocol fee. The entire pool goes to players.
- Reveal keys are derived from a wallet signature and can be regenerated on any device,
  with a downloadable backup and an import path as a fallback. If you lose both and
  cannot sign with the same wallet, the reveal is impossible and the stake is forfeit.
