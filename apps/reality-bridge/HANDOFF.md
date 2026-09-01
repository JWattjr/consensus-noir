# Reality Bridge — handoff

The build is complete and every offline check passes. The source is committed,
round 4 is published on StudioNet, the frontend is hosted, and the funded
two-wallet journey has completed on the public URL. The only item not captured
by this environment is an uncut screen recording; the on-chain evidence is
recorded below and in `SUBMISSION.md`.

Read [`SUBMISSION.md`](SUBMISSION.md) for the full picture and
[`QA.md`](QA.md) for the hands-on procedures. This file is only the remaining
work.

## Current state

| | |
| --- | --- |
| Contract (StudioNet, chain `61999`) | `0x9fD62230aA1149bf443C0a447ffe9D1b2cF4b87E` |
| Publisher account | `0xf19AA039E52fC65A23f2f98FBA15081244C32d4d` |
| Publisher key | `genlayer/.deployer.key` — **git-ignored, local to the machine that deployed** |
| Published round 1 | expired unjoined; retained as historical manifest data |
| Published round 2 | expired unjoined; retained as historical manifest data |
| Published round 3 | historical `OPEN` round with one unclaimed seat; retained for auditability |
| Published round 4 | `SETTLED`, one panel, two seats, outcome `YES`, both claims paid |
| Git | source, hosted status, and the round-4 evidence are committed in this repository |
| `frontendUrl` in the manifest | `https://reality-bridge-beta.vercel.app` |

Passing now: contract lint + schema (28 methods), 61 direct tests, 104 frontend
tests, typecheck, lint, production build, `npm audit` clean, the hosted
StudioNet integration journey (192 s), the public URL smoke check, and the
signed two-wallet round-4 journey.

## Task 1 — Commit the source (done)

69 files across `apps/reality-bridge/` and `.github/`. Nothing in the tree
carries AI attribution; keep it that way — **no `Co-Authored-By`, no
"generated with" trailers, no tool names in commit messages.**

Confirm before committing that no secret is staged:

```bash
git ls-files | grep -E '\.env(\.local)?$|\.deployer\.key$'
```

That must print nothing. `.gitignore` already covers `.env.local`,
`.deployer.key`, `.genvmroot/`, `artifacts/` and `__pycache__/`.

CI (`.github/workflows/reality-bridge.yml`) runs on push: contract, frontend,
and a network-hygiene job that fails on any non-StudioNet GenLayer network or
a tracked secret.

## Task 2 — Publish a fresh, joinable round (done)

Rounds carry real deadlines and expire. Rounds 1–3 are historical; round 4 is
the settled public round that carries the payout evidence. Round 5 was
published to verify the `--quick` schedule and expired unjoined — it is
historical too. **Round ids 1–5 are used; start at 6.**

**If you are on the machine that holds `genlayer/.deployer.key`:**

```bash
python genlayer/scripts/deploy_studionet.py --contract 0x9fD62230aA1149bf443C0a447ffe9D1b2cF4b87E --round-id 6 --join-window 1200 --commit-window 300 --panel-window 600 --reveal-grace 120
```

For a demo you intend to play through in one sitting, `--quick` replaces every
window flag with a schedule that is resolvable about five and a half minutes
after publishing:

```bash
python genlayer/scripts/deploy_studionet.py --contract 0x9fD62230aA1149bf443C0a447ffe9D1b2cF4b87E --round-id 6 --quick
```

Have both wallets funded and connected first — joins close three minutes in.

**If you are not** — the key cannot be recovered, so deploy fresh:

```bash
python genlayer/scripts/deploy_studionet.py --join-window 1800 --commit-window 1800 --panel-window 3600 --reveal-grace 900
```

That writes a new key to `genlayer/.deployer.key`. **Keep it**: it is the only
way to author further rounds on that deployment. The manifest merges rather
than overwrites, so an existing deployment record survives.

The published question asks whether a specific future block was mined at or
before the panel's evidence instant. The target height is the live tip at
publish time plus `--block-margin` (default `+1`), so the answer genuinely
does not exist when players commit, and a mined block's header timestamp never
changes, so the answer is the same whenever anyone resolves it.

Two shapes of question are defects, and both have been published here before:

- A static fixture page, readable before committing.
- Anything read from a **live, moving** endpoint such as
  `/api/blocks/tip/height`. Tip height only rises, so a "greater than N"
  panel answers NO early and YES late, and resolution is permissionless —
  the caller would be choosing the payout. Bind the question to a datum that
  is fixed once it exists.

`--panel-window` larger than `--commit-window` leaves slack so a forfeited
runner hands the **same** panel to the next seat. Without it every forfeit
produces `VOID_LIVENESS`.

## Task 3 — Host the frontend (done)

```bash
cp frontend/.env.example frontend/.env.local     # set the two NEXT_PUBLIC_ vars
npm --prefix frontend run build
```

The production URL is [`https://reality-bridge-beta.vercel.app`](https://reality-bridge-beta.vercel.app).
It is a static-capable Next.js deployment of the single client page. The host
has:

```text
NEXT_PUBLIC_REALITY_BRIDGE_CONTRACT=0x...
NEXT_PUBLIC_REALITY_BRIDGE_ROUND_ID=          # optional; blank picks the most urgent
```

The URL is recorded and verified in:

```jsonc
// deployment/studionet.json
"frontendUrl": "https://reality-bridge-beta.vercel.app"
```

## Task 4 — Two-wallet journey against the public URL (done)

The journey ran against the **hosted URL**, not localhost, with two real wallet
profiles on StudioNet chain `61999`. Round 4 settled `YES`; both claims were
accepted and the on-chain `claimed_amount` equals the round pool.

Hosted URL: [`https://reality-bridge-beta.vercel.app`](https://reality-bridge-beta.vercel.app)

| Step | Wallet / transaction |
| --- | --- |
| Wallet 1 joined | `0x957dfe74cbe381eeb16d48fb23202d1f824d9831ec25fa6afcdc6071a542e13b` |
| Wallet 2 joined | `0xcf3b802c4f45bbd731ee5cbd43d652a8c3354f168e3a300722766f610946a7ff` |
| Round started (wallet 2) | `0x979abe50000431985f4b3451ef65f2de5a292f87a1e41f3cbb193b591e96cffe` |
| Wallet 1 committed `YES` | `0xa8056890ce385a68da7bb5326b101fba5d4e5678996cb09f66297e2e5f9c27bf` |
| Wallet 1 revealed `YES` | `0x347f511c68e334c955feb81740e469e3c3bab3d53a5798f4c8527aa6142e4b6b` |
| Permissionless resolution requested (wallet 2) | `0x2c3c6bc33f3c37ebd407b4f0ed1d6eda0db37f4c21703d9e961ea0df71eb4994` |
| Wallet 1 claimed `0.016 GEN` | `0x717b661179c9b59809241686f87f9d9f72f22fd1b88d638cae8a9d5f34dfa04e` |
| Wallet 2 claimed `0.004 GEN` | `0x1ec88863e5d7c7a3d3f1b60ddf514c54552a5df395a0badcaa4a575843c6fa2a` |

Independent `show_round.py 4` reads confirmed `SETTLED`, panel outcome `YES`,
reason `FINAL_EVIDENCE`, one attempt, evidence receipt
`77839f48ea5854f466c6ff6ffbfa5de5a6b176bad3503173158316da44c23f4c`, pool
`0.020 GEN`, and `claimed_amount == pool`. The global contract still shows a
historical `0.010 GEN` reserve from round 3's unclaimed seat; that is unrelated
to round 4's fully claimed pool.

The connected browser surface has no video recorder, so this is a textual and
on-chain evidence record rather than an uncut video. Keep
`recordedDemonstration` false until an actual recording is attached.

The original manual setup is retained below for rerunning a fresh round.

Set up each wallet on StudioNet — chain `61999` (`0xf22f`), RPC
`https://studio.genlayer.com/api`, symbol `GEN`, 18 decimals. The app's
*Switch to GenLayer StudioNet* button does this.

Fund each. The app offers a **Get test GEN** button whenever a connected
wallet cannot cover the entry; the equivalent by hand (StudioNet has no faucet
page, only this RPC method) is:

```bash
curl -s -X POST https://studio.genlayer.com/api -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"sim_fundAccount","params":["0xYOUR_ADDRESS",5000000000000000000],"id":1}'
```

Then walk the journey (record it uncut if a recorder is available):

1. Wallet A joins — read the pre-signature disclosure aloud before signing.
2. Wallet B joins.
3. After the join window closes, press **Start the round** (permissionless —
   works from any wallet).
4. Runner picks a side. Copy **and** download the recovery bundle, tick the
   confirmation; only then does commit enable.
5. **Prove recovery**: clear site data or open a fresh profile, then restore
   the bundle before revealing. It is validated against wallet, contract,
   round, panel and the on-chain commitment.
6. Reveal.
7. After the evidence timestamp, **Ask validators to resolve**.
8. Claim from both wallets. Confirm a second claim is refused.

Verify each step against chain state in a second terminal:

```bash
python genlayer/scripts/show_round.py --watch
```

**If the UI and that script disagree, the UI is wrong.** The one legitimate
lag: authoritative reads use the finalized variant, so the board trails an
accepted transaction briefly.

After an actual uncut recording is attached, update `SUBMISSION.md` and set
`recordedDemonstration` to `true` in the manifest. Until then it remains
`false`; the signed journey itself is complete and already recorded in the
manifest.

## Gotchas that will otherwise waste your time

- **An unfunded account looks like a hang, not an error.** The transaction is
  submitted and never decides. Check the balance first.
- **Unroutable IPv6 adds ~43 s to every RPC call.** The Python tooling handles
  this via `genlayer/scripts/netprefs.py`. If a hosted run appears to hang for
  tens of minutes, that is the cause.
- **The integration suite must run from `genlayer/`** so `gltest.config.yaml`
  is found. It refuses to start elsewhere unless that StudioNet configuration
  is present:
  ```bash
  cd genlayer && python -m pytest tests/integration -q -s
  ```
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
- `next` pinned exactly at `16.3.3`. Read
  `node_modules/next/dist/docs/` before any framework change — this version has
  breaking changes relative to older training data.
- The published question must stay genuinely future-resolving.

## Full verification before submitting

```bash
python -m pytest genlayer/tests/direct -q                 # 61 passed
GENVMROOT=.genvmroot genvm-lint check genlayer/contracts/reality_bridge.py
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run test                            # 104 passed
npm --prefix frontend run build
npm --prefix frontend audit --audit-level=high            # 0 vulnerabilities
cd genlayer && python -m pytest tests/integration -q -s   # ~3 min, real network
```
