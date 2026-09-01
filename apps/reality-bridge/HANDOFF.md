# Reality Bridge — operator runbook

Everything needed to run, republish, and re-verify this deployment. For what
the submission claims and the evidence behind it, read
[`SUBMISSION.md`](SUBMISSION.md). For the security model, read
[`SECURITY.md`](SECURITY.md).

## Current state

| | |
| --- | --- |
| Contract (StudioNet, chain `61999`) | `0x9fD62230aA1149bf443C0a447ffe9D1b2cF4b87E` |
| Deployment transaction | `0x88d553046d34a8bb7aee59b36b047231746d61c98c8a85e42ad9f3c5ef4ae881` |
| Publisher account | `0xf19AA039E52fC65A23f2f98FBA15081244C32d4d` |
| Publisher key | `genlayer/.deployer.key` — **git-ignored, local to the machine that deployed** |
| Round 1 | expired unjoined; retained as historical manifest data |
| Round 2 | `SETTLED` — the anchored-resolution evidence, see `SUBMISSION.md` |
| Round 3 | latest published round; deadline-bound, so check its live state before presenting it as joinable |

An earlier deployment, `0x4DE4c2aFC908fd744b65Fe8361FEE4Dc1C5c8CA9`, carried
rounds 1–4 under the **defective tip-height question**. It is retained for
auditability and is not the submission contract. The redeploy was required
because the stored panel gained a field and the receipt scheme moved to v2.

## Verify the whole submission in one command

```bash
python genlayer/scripts/verify_submission.py
```

It trusts nothing in this repository's prose. It reads the deployed contract
from StudioNet, re-fetches each panel's evidence from the public source,
recomputes every stored receipt from the documented pre-image, and checks that
each outcome follows from the evidence's own timestamp rather than from when
resolution happened to run. Exit status is 0 only if every check passes.

## Offline checks

```bash
python -m pytest genlayer/tests/direct -q                 # 61 passed
python genlayer/scripts/make_genvmroot.py
GENVMROOT=.genvmroot genvm-lint check genlayer/contracts/reality_bridge.py
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run test                            # 104 passed
npm --prefix frontend run build
npm --prefix frontend audit --audit-level=high            # 0 vulnerabilities
```

The hosted journey sends real transactions and is run by hand:

```bash
cd genlayer && python -m pytest tests/integration -q -s   # ~3 min
```

## Publish a fresh round

Rounds carry real deadlines and expire, so a published round eventually stops
being joinable.

**If you hold `genlayer/.deployer.key`:**

```bash
python genlayer/scripts/deploy_studionet.py --contract 0x9fD62230aA1149bf443C0a447ffe9D1b2cF4b87E --round-id 4 --join-window 7200 --commit-window 1800 --panel-window 5400 --reveal-grace 900 --block-margin 12
```

**If you do not** — the key cannot be recovered, so deploy fresh:

```bash
python genlayer/scripts/deploy_studionet.py --join-window 1800 --commit-window 1800 --panel-window 3600 --reveal-grace 900
```

That writes a new key to `genlayer/.deployer.key`. **Keep it**: it is the only
way to author further rounds on that deployment. The manifest merges rather
than overwrites, so existing records survive.

`--quick` publishes a demo-paced round (joins close in 3 minutes, resolvable
at about 5.5). Any window flag you pass explicitly still wins.

### Choosing `--block-margin`

The panel asks whether block `tip + margin` was mined at or before the panel's
instant. Bitcoin averages a block every ten minutes, so a margin near
`minutes_until_resolution / 10` makes the question genuinely uncertain. A much
smaller margin trends to a certain `YES`; a much larger one to a certain `NO`.

`--panel-window` larger than `--commit-window` leaves slack so a forfeited
runner hands the **same** panel to the next seat. Without it every forfeit
produces `VOID_LIVENESS`.

## Host the frontend

```bash
cp frontend/.env.example frontend/.env.local
npm --prefix frontend run build
```

The host needs:

```text
NEXT_PUBLIC_REALITY_BRIDGE_CONTRACT=0x9fD62230aA1149bf443C0a447ffe9D1b2cF4b87E
NEXT_PUBLIC_REALITY_BRIDGE_ROUND_ID=          # blank picks the joinable round
```

## Play a round by hand

Set up each wallet on StudioNet — chain `61999` (`0xf22f`), RPC
`https://studio.genlayer.com/api`, symbol `GEN`, 18 decimals. The app's
*Switch to GenLayer StudioNet* button does this, and its top-up button funds a
connected wallet that cannot cover the entry.

1. Wallet A joins; read the pre-signature disclosure before signing.
2. Wallet B joins. **Two seats are required for a round to start.**
3. After the join window closes, press **Start the round** — permissionless.
4. The runner picks a side, copies **and** downloads the recovery bundle, and
   ticks the confirmation; only then does commit enable.
5. **Prove recovery**: clear site data or open a fresh profile, then restore
   the bundle before revealing. It is validated against wallet, contract,
   round, panel and the on-chain commitment.
6. Reveal.
7. After the panel's instant, **Ask validators to resolve**. If the target
   block is not mined yet the panel stays `PENDING` and the call is retryable;
   that is correct behaviour, not a failure.
8. Claim from both wallets. Confirm a second claim is refused.

Watch chain state in a second terminal:

```bash
python genlayer/scripts/show_round.py --watch
```

**If the UI and that script disagree, the UI is wrong.** The one legitimate
lag: authoritative reads use the finalized variant, so the board trails an
accepted transaction briefly.

## Gotchas that will otherwise waste your time

- **An unfunded account looks like a hang, not an error.** The transaction is
  submitted and never decides. Check the balance first.
- **Unroutable IPv6 adds ~43 s to every RPC call.** The Python tooling handles
  this via `genlayer/scripts/netprefs.py`. If a hosted run appears to hang for
  tens of minutes, that is the cause.
- **A non-ASCII character in the contract source breaks deployment.** Schema
  generation transmits the source as ASCII, so a single em dash in a docstring
  fails every client with an opaque "failed to get schema" that never mentions
  encoding. Asserted by `test_contract_source_is_pure_ascii`.
- **The integration suite must run from `genlayer/`** so `gltest.config.yaml`
  is found.
- **`genvm-lint validate` needs `GENVMROOT`.** The latest artifact bundle no
  longer ships the pinned runner:
  ```bash
  python genlayer/scripts/make_genvmroot.py
  GENVMROOT=.genvmroot genvm-lint check genlayer/contracts/reality_bridge.py
  ```
- On Windows prefix the linter with `PYTHONUTF8=1`.

## Do not change

- The pinned runner in the contract header
  (`py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`). If
  validation fails, fix `GENVMROOT`, not the pin.
- StudioNet as the only network. CI fails on any other GenLayer network
  appearing anywhere, including documentation.
- `next` pinned exactly at `16.3.3`. Read `node_modules/next/dist/docs/`
  before any framework change — this version has breaking changes relative to
  older training data.
- **The shape of the published question.** It must rest on a datum that is
  fixed once it exists, so the answer cannot depend on when resolution runs.
  A live, moving value — a current tip height, a "latest" reading, a score in
  progress — reintroduces the defect corrected in `48839ee`. See
  *Caller-chosen outcomes through resolution timing* in `SECURITY.md`.
