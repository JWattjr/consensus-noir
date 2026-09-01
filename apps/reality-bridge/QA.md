# Reality Bridge — hands-on testing guide

This is the **manual** guide: how to sit in front of the app with a wallet and
try to break it. For the automated suites (contract lint, direct tests, hosted
integration, Vitest) see [`TESTING.md`](TESTING.md).

Everything below runs against **GenLayer StudioNet**, chain id `61999`. All
assets are test assets with no real-world value.

Commands are run from `apps/reality-bridge` unless stated otherwise.

---

## 1. Setup (about five minutes)

### 1.1 Start the app

```bash
npm --prefix frontend install
```

```bash
cp frontend/.env.example frontend/.env.local
```

Put the deployed contract in `.env.local` — the address is in
[`deployment/studionet.json`](deployment/studionet.json) under
`contractAddress`:

```text
NEXT_PUBLIC_REALITY_BRIDGE_CONTRACT=0x...
NEXT_PUBLIC_REALITY_BRIDGE_ROUND_ID=
```

Leave the round id blank so the lobby picks the most urgent round for you.

```bash
npm --prefix frontend run dev
```

### 1.2 Add StudioNet to your wallet

The app's **Switch to GenLayer StudioNet** button does this for you. To add it
by hand:

| Field | Value |
| ----- | ----- |
| Network name | GenLayer StudioNet |
| Chain id | `61999` (`0xf22f`) |
| RPC URL | `https://studio.genlayer.com/api` |
| Currency symbol | `GEN` |
| Decimals | 18 |

### 1.3 Fund your wallet

StudioNet accounts start empty and there is no public faucet page — the
simulator exposes one over JSON-RPC.

**From the app:** connect a wallet on StudioNet. If the balance cannot cover
the entry plus fee headroom, the page offers a **Get test GEN** button that
calls the simulator's faucet and reads the balance back. The reported balance
is what the chain returns afterwards, not the amount requested.

**By hand**, if you would rather not use the button — five GEN is plenty:

```bash
curl -s -X POST https://studio.genlayer.com/api -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"sim_fundAccount","params":["0xYOUR_ADDRESS",5000000000000000000],"id":1}'
```

Confirm it landed:

```bash
curl -s -X POST https://studio.genlayer.com/api -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"eth_getBalance","params":["0xYOUR_ADDRESS","latest"],"id":1}'
```

`0x4563918244f40000` is 5 GEN. **An unfunded account is the single most common
cause of a transaction that never decides** — it is submitted and then sits
forever. If something hangs, check the balance first.

### 1.4 Watch the chain independently

Keep this open in a second terminal. It reads the same state the interface
reads, so you can tell whether a disagreement is a UI bug or real chain state:

```bash
python genlayer/scripts/show_round.py --watch
```

**If the UI and this script ever disagree, the UI is wrong.** Note that
authoritative reads use the finalized transaction variant, so the board legit­
imately trails an accepted transaction by ten to forty seconds before catching
up. Anything longer than that is a bug.

---

## 1.4 Verify the submission's claims without playing anything

```bash
python genlayer/scripts/verify_submission.py
```

Reads the deployed contract from StudioNet, re-fetches each resolved panel's
evidence from its public source, recomputes every stored receipt from the
documented pre-image, re-derives each outcome from the evidence's own
timestamp, and reads the hosted client's JavaScript bundle to confirm which
contract it actually serves. `PASS`/`FAIL` per check; non-zero exit on any
failure.

## 2. Get a round you can actually play

Rounds carry real deadlines, so published ones expire. Publish your own with
the publisher key in the git-ignored `genlayer/.deployer.key`.

Take the contract address from the manifest and pick an unused round id.

### Recipe 0 — `--quick` (about five and a half minutes to resolvable)

The shortest round the contract's minimums permit. Joins close three minutes
after publishing and the panel becomes resolvable at five and a half. Use it
for a demo or a smoke test where you want the whole lifecycle in one sitting.

```bash
python genlayer/scripts/deploy_studionet.py --contract 0xYOUR_CONTRACT --round-id 10 --quick
```

That is `--join-window 180 --commit-window 60 --panel-window 120
--reveal-grace 30`. Any window flag you pass explicitly still wins, so
`--quick --join-window 600` gives you longer to gather players without
lengthening the rest.

It is genuinely tight: **have both wallets funded and connected before you
publish.** Three minutes is enough to join twice and no more. For a first
run through the flow, prefer recipe A.

### Recipe A — fast full cycle (about 12 minutes to settlement)

Good for the join → commit → reveal → resolve → claim path.

```bash
python genlayer/scripts/deploy_studionet.py --contract 0xYOUR_CONTRACT --round-id 10 --join-window 300 --commit-window 300 --reveal-grace 60
```

### Recipe B — hand-over rehearsal

`--panel-window` sets how long the panel stays answerable, independently of a
single runner's attempt. Making it much larger than the commit window leaves
slack, so a forfeited runner hands the **same panel** to the next seat instead
of the panel being voided for liveness. Without it the first attempt exactly
fills the panel and every forfeit produces `VOID_LIVENESS`.

```bash
python genlayer/scripts/deploy_studionet.py --contract 0xYOUR_CONTRACT --round-id 11 --join-window 300 --commit-window 120 --panel-window 1800 --reveal-grace 60
```

Here the first runner has two minutes to commit and one more to reveal, but the
panel stays open for thirty — so you can deliberately miss your window and
watch the next seat inherit the same question.

### Recipe C — forced void

Leave `--panel-window` out and use a short commit window. The first attempt
fills the panel, so any forfeit voids it.

```bash
python genlayer/scripts/deploy_studionet.py --contract 0xYOUR_CONTRACT --round-id 12 --join-window 300 --commit-window 60 --reveal-grace 30
```

You need **two** seats for a round to start, so have a second wallet ready, or
join from a second browser profile.

---

## 3. Scenarios

Each one lists what to do, what you should see, and what would count as a bug.

### 3.1 Read-only, no wallet

**Do.** Open the app without connecting.

**Expect.** The lobby lists real rounds with live countdowns. The network pill
reads *GenLayer StudioNet*; the footer says *chain 61999*. Every action button
is disabled and says *Connect a wallet first.*

**Bug if.** Any write button is enabled, any round data appears without a
network read, or any chain id other than `61999` appears anywhere.

### 3.2 Wrong network

**Do.** Connect a wallet, then switch it to an unsupported network in the wallet.

**Expect.** A red banner appears immediately naming the chain you are on.
Every write disables with *Switch the wallet to GenLayer StudioNet.* A
**Switch to GenLayer StudioNet** button is offered and works.

**Bug if.** Anything remains clickable, or the app lets a transaction reach the
wallet from the wrong chain.

### 3.3 Pre-signature disclosure and joining

**Do.** On an open round press **Review entry and join** and read the panel
before signing.

**Expect.** Exact amount at full precision, maximum loss equal to the entry,
protocol fee stated as zero, a payout range, refund conditions, the list of
transactions to expect, deadline consequences, the salt warning, and the
contract address and round id. Then sign.

Watch the transaction card: *Awaiting wallet signature* → *Submitted* →
*Pending consensus* → *Accepted*. The seat appears in the crossing order and
the pool grows by exactly one entry.

**Bug if.** The card says accepted before the chain does, the amount shown
differs from what the wallet asks for, or the pool moves by the wrong amount.

### 3.4 Second seat and permissionless start

**Do.** Join from a second wallet. Wait for the join window to close, then
press **Start the round** — from *either* wallet, or a third that never joined.

**Expect.** The button is disabled with *The join window is still open* until
the deadline passes, then works from any wallet. The round becomes `ACTIVE`,
seat 1 shows `CROSSING`, and five countdowns appear: commit window, reveal
cut-off, panel cut-off, resolution opens, terminal deadline.

**Bug if.** A non-player cannot start it. Starting is permissionless by design.

### 3.5 Commit, and the recovery bundle gate

**Do.** As the active runner, pick YES or NO.

**Expect.** A recovery bundle appears containing version, network, chain id,
contract, round, panel, account, choice, salt, commitment and timestamp. The
commit button is **disabled** with *Pick a side, then save the recovery bundle
and confirm it.* Copy it and download the `.json`. Tick the confirmation — only
now does commit enable. Sign it.

**Bug if.** Commit is enabled before you confirm, the salt is not 64 hex
characters, or the same salt appears twice across two commits.

### 3.6 Recovery after losing the browser — the important one

**Do.** After committing, destroy your local state, then try to reveal:

1. Open your browser's dev tools → Application → clear site data for
   `localhost:3112`. Reload. **Or** open a completely fresh browser profile and
   import the same wallet.
2. Go back to the round.

**Expect.** Reveal is disabled with *Import your recovery bundle to reveal.*
Paste the JSON you saved (or load the file) into **Restore a recovery bundle**.
It is checked against your wallet, this contract, this round, this panel and
the commitment StudioNet already stores, then reveal enables. Sign it.

Then try to break the import:

| Try | Expect |
| --- | ------ |
| Edit one character of the salt | *The salt and choice in this bundle do not reproduce its own commitment.* |
| Import from the other wallet | *The bundle belongs to a different wallet address.* |
| Change `roundId` or `tileIndex` | Names the round or panel it actually belongs to |
| Change `network` to something else | *The bundle was created for … not StudioNet.* |
| Paste truncated JSON | A parse error naming the missing field |

**Bug if.** A bundle that fails any of those checks still enables reveal, or a
valid bundle is rejected.

### 3.7 Resolution

**Do.** Wait for *Resolution opens*, then press **Ask validators to resolve**.
Any wallet may send it, including one with no seat.

**Expect.** Validators independently render
`test-server.genlayer.com/static/genvm/hello.html` and must agree. Takes fifteen
to forty seconds. Panel resolves `YES`; the evidence receipt card fills in with
reason `FINAL_EVIDENCE`, an event id, a receipt hash and an attempt count.

**Bug if.** The receipt is a fixed constant rather than a hash that changes with
the extracted fields, or the UI claims validators agreed before the transaction
decided.

If it comes back `UNRESOLVED`, that is the retryable path working: press it
again. Nothing changed and no deadline moved — confirm with `show_round.py`
that the attempt count went up and every deadline is identical.

### 3.8 Settlement and claiming

**Do.** After the last panel resolves, claim from each wallet.

**Expect.** The round is `SETTLED`. A correct runner has one discovery credit
and weight `1 + 3 × credits`; a passive survivor has weight 1. With two seats
and a 0.02 GEN pool that is 0.016 and 0.004. The claim panel shows your exact
amount and *Eligible*. After claiming it says *Already collected* and the button
disables.

Now check the negatives:

- Claim from a wallet that never joined → *This wallet did not join the round.*
- Claim twice → the button is gone; if you force the transaction it reverts
  with *Claim already collected.*
- Run `show_round.py` and confirm `claimed` equals `pool`, and that the
  contract's own balance reached zero once everyone withdrew.

**Bug if.** An enabled claim button appears for a visitor, the amounts do not
sum to the pool, or a second claim succeeds.

### 3.9 Missed commit — permissionless forfeit

**Do.** Use a round from recipe B or C. As the runner, **do nothing**. Watch the
commit window elapse.

**Expect.** Once it lapses, **Forfeit missed commit** becomes available to
*anyone*, labelled *Permissionless — any wallet may send this to keep the round
alive.* Send it from a wallet with no seat. The runner is eliminated.

- With recipe B (slack), the next seat inherits the **same panel** with a fresh
  commit window. This is the headline liveness fix.
- With recipe C (no slack), the panel is voided with `VOID_LIVENESS` and the
  round advances instead — a late commitment would let someone answer with
  knowledge, so the panel is not reused.

**Bug if.** The next runner is handed a panel whose deadline has already passed,
so nobody can act. That was the original defect this build exists to fix.

### 3.10 Missed reveal

**Do.** Commit, then let the reveal cut-off pass without revealing.

**Expect.** **Forfeit missed commit** is hidden (you did commit) and **Forfeit
missed reveal** becomes available to anyone once the grace period ends. Same
hand-over or void behaviour as above.

**Bug if.** Both forfeit buttons are offered at once, or either is offered while
its window is still open.

### 3.11 Under-subscribed round

**Do.** Publish a round, join with **one** wallet only, let the join window
close, then press **Start the round**.

**Expect.** The round does not activate. It unwinds to `REFUNDABLE` and the
single player can reclaim exactly their entry. A one-player round has no
counterparty, so it is not allowed to run.

### 3.12 Terminal expiry

**Do.** Find a round past its terminal deadline — `show_round.py` shows the
countdown — and press **Expire round**.

**Expect.** Permissionless. The round becomes `REFUNDABLE` and every joined
seat, **including eliminated ones**, can reclaim exactly its own entry, once.
Nobody profits from an expiry.

### 3.13 Simulation is never mistaken for live play

**Do.** Scroll to **Simulation scenarios** and run *Void panel*.

**Expect.** The chrome changes completely: hatched banner, a pill reading
*Simulation — no network*, a `SIMULATION` badge. Play through it. Then search
the page (Ctrl+F) for "on-chain", "validators agreed", "LIVE STUDIONET" and
"Confirmed" — none should appear.

Now the real test: pick the side the scenario is scripted **against**. In *Void
panel* the outcome is `VOID` no matter what you choose; in *Runner eliminated*
panel 1 resolves against you.

**Bug if.** The simulation agrees with whatever you picked, uses live-network
vocabulary, sends any transaction, or is ever entered without you clicking.

### 3.14 A StudioNet failure must not become a simulation

**Do.** Break the connection — disable your network, or point
`NEXT_PUBLIC_GENLAYER_RPC` at a dead host and restart the dev server.

**Expect.** *StudioNet is not answering* with the underlying error, no round
shown, and the simulation offered only as an explicit button.

**Bug if.** Fixtures are shown as though they were live data.

### 3.15 Reload reconciliation

**Do.** Send a transaction and close the tab while it is still pending. Reopen.

**Expect.** The app picks the pending hash back up, follows it to a decided
state, records it in the transaction history and refreshes the board. If it
succeeded you get *Reconciled a pending … transaction from a previous session.*

**Bug if.** The transaction is silently forgotten.

### 3.16 Duplicate submission

**Do.** While a transaction is in flight, try to press anything else.

**Expect.** Every action disables with *A transaction from this session is still
pending.*

---

## 4. Accessibility and responsive pass

- **Keyboard only.** Tab from the top. The skip link appears first and jumps to
  the round. Every control is reachable and has a visible 3px focus ring. You
  can complete a whole commit without a mouse.
- **Widths.** Check 360px, 768px and 1440px. The page must never scroll
  sideways. Wide content — the bundle JSON, transaction history — scrolls inside
  its own box.
- **Touch targets.** On a phone or with device emulation, no button or link
  should be under 44px tall.
- **Reduced motion.** Turn on "reduce motion" in your OS. Spinners and
  transitions stop animating; nothing becomes unreadable.
- **Announcements.** With a screen reader, the transaction card should announce
  status changes (it is a polite live region) and the wrong-network banner
  should announce immediately (it is an alert).
- **Awkward content.** Long addresses, 18-decimal amounts and long questions
  must wrap, never overflow.

---

## 5. Troubleshooting

| Symptom | Cause and fix |
| ------- | ------------- |
| A transaction never decides | The account is unfunded. See §1.3. |
| Every RPC call takes ~43 seconds | Unroutable IPv6 records. The Python tools handle this via `genlayer/scripts/netprefs.py`; in a browser, prefer a network with working IPv6 or disable IPv6 locally. |
| Board looks stale right after a transaction | Expected for ten to forty seconds — authoritative reads use the finalized variant. The app re-reads automatically. Longer than a minute is a bug. |
| Cannot join any round | The join windows have elapsed. Publish a new round — §2. |
| Cannot publish a round | `genlayer/.deployer.key` is missing. Only the publisher may author rounds and the key cannot be recovered; deploy a fresh contract instead. |
| `NameError: name 'gl' is not defined` in tests | The app's `genlayer/` directory is shadowing the SDK. Already handled in `conftest.py`; if you see it, you are running an old checkout. |
| Integration suite says it must run against StudioNet | Run it from `apps/reality-bridge/genlayer` so `gltest.config.yaml` is picked up. It refuses to run without that StudioNet configuration. |

---

## 6. What to report

A useful report has: the round id and contract, what you did, what the UI said,
and what `show_round.py` said at the same moment. That last part separates a
display bug from a contract bug, and they need very different fixes.
