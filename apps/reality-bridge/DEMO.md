# Reality Bridge — walkthrough of one full round

One continuous take, no cuts, no edits. Everything below runs against **GenLayer
StudioNet** (chain id `61999`). Total wall time is about 12 minutes if you use
the pre-published round, or about 6 minutes if you run the scripted journey.

Have ready:

- A terminal in `apps/reality-bridge`.
- A browser with an injected EVM wallet.
- `frontend/.env.local` pointing at the deployed contract.

---

## 0 · Frame it (30 s)

> "Reality Bridge is a hidden-choice elimination game where every safe panel is
> a claim about the real world. The players commit before the evidence exists.
> GenLayer validators read the registered sources afterwards and settle it. No
> server picks a winner, and no keeper is needed to keep the game alive."

Show `specs/PRODUCT_SPEC.md` scrolled to **Economics**. Point at the two lines
that matter: survivor weight `1 + 3 × discovery_credits`, protocol fee `0`.

---

## 1 · Prove the contract is deterministic (60 s)

```bash
GENVMROOT=.genvmroot genvm-lint check genlayer/contracts/reality_bridge.py
```

Point at `✓ Lint passed` and `✓ Validation passed`, and at the pinned runner in
the contract's first line.

```bash
python -m pytest genlayer/tests/direct -q
```

56 tests, about 3 seconds. While it runs, call out the three that matter most:

- `test_missed_reveal_hands_the_same_panel_to_the_next_runner` — the liveness
  bug that made the old build unplayable.
- `test_repeated_missed_reveals_stay_recoverable_then_void_the_panel` — four
  runners fail in a row and the round still terminates.
- `test_malicious_page_instructions_do_not_change_the_stored_decision` — a page
  that tries to forge the evidence fence changes nothing in storage.

---

## 2 · Run the whole thing on the real network (4 min)

```bash
cd genlayer && python -m pytest tests/integration -q -s
```

Narrate the log as it streams. It deploys a fresh contract, funds two accounts
through the StudioNet faucet, authors and opens a round, joins twice, activates
permissionlessly, commits, reveals, and then:

```text
[11:59:02] resolve_tile accepted in 35s
[11:59:06] tile outcome=YES reason=FINAL_EVIDENCE event_id=NONE date=
```

> "That is real consensus. Five validators each rendered
> `test-server.genlayer.com/static/genvm/hello.html`, each derived the same
> status, outcome, event id, effective date and evidence receipt, and only then
> did the contract write `YES`."

It finishes by claiming for both players. Read the last line back from chain:

```bash
python - <<'EOF'
import sys; sys.path.insert(0, "genlayer/scripts")
from netprefs import prefer_ipv4; prefer_ipv4()
from genlayer_py import create_account, create_client
from genlayer_py.chains import studionet
c = create_client(chain=studionet, account=create_account())
A = "<contract from the test log>"
print(c.read_contract(address=A, function_name="get_round", args=[1]))
print("contract balance:", c.get_balance(A))
EOF
```

> "Round `SETTLED`, `claimed_amount` equals `pool`, and the contract's balance
> is zero. The runner with one discovery credit took weight 4, the passive
> survivor took weight 1, and every wei left the contract."

---

## 3 · Show the interface refusing to lie (3 min)

```bash
npm --prefix frontend run dev
```

**a. Network identity.** The pill reads *GenLayer StudioNet*; the footer reads
*chain 61999*. Search the page for any other chain id — nothing.

**b. Wrong network.** Switch the wallet to an unsupported network. A red `role="alert"`
banner appears, every write button disables with a reason, and a
*Switch to GenLayer StudioNet* button is offered. Switch back.

**c. Join with full disclosure.** Press *Review entry and join*. Read the
disclosure aloud: exact amount, maximum loss (exactly the entry), zero protocol
fee, the payout range, the refund conditions, the five transactions to expect,
what missing a deadline costs, the salt warning, and the contract address and
round id. Then sign.

> "Notice the transaction card. It says *Submitted*, then *Pending consensus*,
> then *Accepted*. It never said confirmed until StudioNet said so — and if the
> transaction had been accepted with a reverted execution, it would say
> *Failed on chain* with the contract's own message."

**d. Commit custody.** Pick YES. The recovery bundle appears with the salt,
commitment, network, contract, round, panel and account. Copy it, download it,
tick the box. Only now does *Commit sealed choice* enable.

**e. Recovery.** Open a private window, clear site data, reload. Press
*Restore bundle*, paste the JSON. It is validated against the wallet, contract,
round, panel and the commitment StudioNet already stores — then *Reveal choice*
enables.

> "The salt never touched a server. Losing the browser does not lose the game."

**f. Permissionless recovery.** Scroll to *Keep the round alive*. Point at
*Forfeit missed commit*, *Forfeit missed reveal* and *Expire round*, each with
its own countdown and each labelled *Permissionless — any wallet may send this*.

> "There is no keeper. If I disappear, anyone reading this page can move the
> round forward or unwind it."

---

## 4 · Show the simulation being honest about itself (60 s)

Scroll to *Simulation scenarios* and run **Void panel**.

The whole chrome changes: a hatched purple banner, a pill reading *Simulation —
no network*, a `SIMULATION` badge. Read the banner:

> "Panels, players, sources and payouts are fixtures. No wallet is used, no
> transaction is sent, no validator is consulted and no value moves. Outcomes
> are fixed by the scenario before you choose."

Pick either side and resolve. The panel comes back `VOID` regardless.

> "The old build set the outcome equal to whatever the player picked, then told
> them validators had agreed. This one decides first and can disagree with you.
> And a StudioNet failure shows an error — it never quietly drops you here."

---

## 5 · Close (30 s)

Show `deployment/studionet.json`: network, chain id, pinned runner, contract
address, publisher, every transaction hash and the round's real deadlines.

> "StudioNet only. Every rule in the spec is enforced by the contract, every
> permissionless path has a button, and nothing is called confirmed until the
> chain says so."

---

## Completed hosted evidence — round 4

The two-wallet lifecycle was completed against
[`https://reality-bridge-beta.vercel.app`](https://reality-bridge-beta.vercel.app)
on StudioNet (`61999`) using the published contract
`0x4DE4c2aFC908fd744b65Fe8361FEE4Dc1C5c8CA9` -- the previous deployment, before the resolution-timing fix. Wallet 1 joined, committed and
revealed `YES`; wallet 2 joined, started the round and requested permissionless
resolution. The panel settled `YES` with reason `FINAL_EVIDENCE` and receipt
`77839f48ea5854f466c6ff6ffbfa5de5a6b176bad3503173158316da44c23f4c`.

The finalized claim transactions paid `0.016 GEN` to wallet 1 and `0.004 GEN`
to wallet 2. The complete transaction list and hashes are in
[`SUBMISSION.md`](SUBMISSION.md) and `deployment/studionet.json`.

This section is an on-chain evidence record, not a video: the connected browser
surface did not expose a recorder. No screen recording is provided: the
evidence for every claim is reproducible from
`python genlayer/scripts/verify_submission.py`, which re-derives it from live
chain and source data rather than showing it.
