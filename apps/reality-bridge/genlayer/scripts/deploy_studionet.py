"""Deploy Reality Bridge to GenLayer StudioNet and publish a durable round.

The script is the reproducible path from a clean checkout to a live, joinable
round. It never embeds a key. The publisher account comes from, in order:
``REALITY_BRIDGE_DEPLOYER_KEY`` in the environment, then the git-ignored
``genlayer/.deployer.key``, and only otherwise a freshly generated account —
which is written to that file, because the publisher role is the only way to
author further rounds on the deployment.

Usage::

    python genlayer/scripts/deploy_studionet.py                    # deploy + publish
    python genlayer/scripts/deploy_studionet.py --skip-round       # deploy only
    python genlayer/scripts/deploy_studionet.py --contract 0x... --round-id 2

Every transaction is waited on until StudioNet reports a decided state, and the
leader receipt is checked, so nothing is reported as deployed unless the chain
agrees. The result is written to ``deployment/studionet.json``.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from genlayer_py import create_account, create_client
from genlayer_py.chains import studionet

sys.path.insert(0, str(Path(__file__).resolve().parent))
from netprefs import prefer_ipv4  # noqa: E402  (must follow the sys.path setup)


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "contracts" / "reality_bridge.py"
MANIFEST_PATH = ROOT.parent / "deployment" / "studionet.json"
#: Git-ignored. A generated publisher key is written here so the contract can
#: still be administered later; losing it means no further rounds can ever be
#: authored on that deployment.
KEY_PATH = ROOT / ".deployer.key"

FUNDING_WEI = 20 * 10**18
POLL_SECONDS = 5
POLL_ATTEMPTS = 180

DECIDED = {
    "ACCEPTED",
    "FINALIZED",
    "UNDETERMINED",
    "CANCELED",
    "VALIDATORS_TIMEOUT",
    "LEADER_TIMEOUT",
}
STATUS_NAMES = {
    0: "UNINITIALIZED",
    1: "PENDING",
    2: "PROPOSING",
    3: "COMMITTING",
    4: "REVEALING",
    5: "ACCEPTED",
    6: "UNDETERMINED",
    7: "FINALIZED",
    8: "CANCELED",
    9: "APPEAL_REVEALING",
    10: "APPEAL_COMMITTING",
    11: "READY_TO_FINALIZE",
    12: "VALIDATORS_TIMEOUT",
    13: "LEADER_TIMEOUT",
}

# The published round must pose a question whose answer does not exist yet.
# A static fixture page can be read before committing, which demonstrates the
# consensus plumbing but not the product: predicting an unresolved event.
#
# The panel asks whether a *specific* future block was mined by a *fixed*
# instant, and reads it from a height-addressed URL.
#
# The obvious phrasing - "is the tip height above N" against the live tip
# endpoint - is broken, and was: tip height only ever rises, so the same panel
# answers NO to an early caller and YES to a late one, letting whoever chooses
# when to call resolution choose a payout. A block's header timestamp, by
# contrast, is fixed the moment it is mined and never changes, so the answer
# is the same whenever anyone asks. Until the block exists the panel is simply
# not answerable yet, which is the retryable UNRESOLVED state rather than an
# outcome.
EVIDENCE_HOST = "blockstream.info"
EVIDENCE_LABEL = "Blockstream public Bitcoin block explorer API"
#: Height-addressed and immutable once mined: /api/blocks/<height>.
EVIDENCE_PATH_TEMPLATE = "/api/blocks/{height}"

#: How far above the height at publish time the target block sits. Larger
#: means a later block and so a more likely NO; smaller means a more genuinely
#: uncertain prediction.
DEFAULT_BLOCK_MARGIN = 1

#: Fixture host used by the hosted integration test, kept registered so that
#: suite can author its own rounds against this deployment.
FIXTURE_HOST = "test-server.genlayer.com"
FIXTURE_LABEL = "GenLayer public test fixture server"

# A fast lifecycle schedule: publish to resolvable in about five and a half
# minutes, which is short enough to play in one sitting. Every value clears the
# contract's minimums (60s commit window, 30s reveal grace) and leaves the
# panel window wider than the commit window so a forfeit hands the panel on
# rather than voiding it.
QUICK_SCHEDULE = {
    "join_window": 180,
    "commit_window": 60,
    "panel_window": 120,
    "reveal_grace": 30,
}

# Real-time schedule for the published round, in seconds from deployment.
JOIN_WINDOW = 1800  # 30 minutes to take a seat
COMMIT_WINDOW = 1800  # 30 minutes per runner attempt
REVEAL_GRACE = 900  # 15 minutes to open a sealed choice
TERMINAL_HORIZON = 86400  # 24 hours before the round unwinds
ENTRY_WEI = 10**16  # 0.01 GEN


def log(message: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {message}", flush=True)


def status_name(transaction: dict) -> str:
    named = transaction.get("statusName")
    if isinstance(named, str) and named:
        return named.upper()
    status = transaction.get("status")
    if isinstance(status, int):
        return STATUS_NAMES.get(status, str(status))
    if isinstance(status, str) and status.isdigit():
        return STATUS_NAMES.get(int(status), status)
    return str(status)


def execution_result(transaction: dict) -> str | None:
    consensus = transaction.get("consensus_data") or {}
    receipts = consensus.get("leader_receipt") or []
    if isinstance(receipts, dict):
        receipts = [receipts]
    if not receipts:
        return None
    return str(receipts[0].get("execution_result", "")).upper() or None


def wait_for(client, tx_hash: str, label: str) -> dict:
    """Block until StudioNet decides, then insist the execution succeeded."""

    for attempt in range(POLL_ATTEMPTS):
        try:
            transaction = client.get_transaction(transaction_hash=tx_hash)
        except Exception as error:  # noqa: BLE001 - transient RPC noise
            log(f"  {label}: read failed ({type(error).__name__}), retrying")
            time.sleep(POLL_SECONDS)
            continue
        name = status_name(transaction)
        if name in DECIDED:
            result = execution_result(transaction)
            if name in ("ACCEPTED", "FINALIZED") and result == "SUCCESS":
                log(f"  {label}: {name} after {attempt * POLL_SECONDS}s")
                return transaction
            raise SystemExit(
                f"{label} did not succeed: status={name} execution={result}\n"
                f"{json.dumps(transaction, default=str)[:2000]}"
            )
        time.sleep(POLL_SECONDS)
    raise SystemExit(f"{label} never reached a decided state")


def send(client, account, address, method, args, label, value=0):
    log(f"{label} ...")
    tx_hash = client.write_contract(
        address=address,
        function_name=method,
        args=args,
        value=value,
        account=account,
    )
    wait_for(client, tx_hash, label)
    return str(tx_hash)


#: Live tip endpoint. Used once, at publish time, only to choose a target
#: block that does not exist yet. It is never the panel's evidence source -
#: that would reintroduce the timing dependency this question is built to
#: avoid.
TIP_HEIGHT_PATH = "/api/blocks/tip/height"


def current_block_height() -> int:
    """Read the live Bitcoin tip height, to pick a block that is still future."""

    import urllib.request

    url = f"https://{EVIDENCE_HOST}{TIP_HEIGHT_PATH}"
    request = urllib.request.Request(url, headers={"User-Agent": "reality-bridge"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return int(response.read().decode("utf-8").strip())


def iso(timestamp: int) -> str:
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--round-id", type=int, default=1, help="Round id to publish (default: 1)"
    )
    parser.add_argument(
        "--skip-round",
        action="store_true",
        help="Deploy and register sources only, without publishing a round.",
    )
    parser.add_argument(
        "--join-window",
        type=int,
        default=JOIN_WINDOW,
        help=f"Seconds players have to take a seat (default: {JOIN_WINDOW}).",
    )
    parser.add_argument(
        "--commit-window",
        type=int,
        default=COMMIT_WINDOW,
        help=f"Seconds each runner attempt lasts (default: {COMMIT_WINDOW}).",
    )
    parser.add_argument(
        "--reveal-grace",
        type=int,
        default=REVEAL_GRACE,
        help=f"Seconds to open a sealed choice (default: {REVEAL_GRACE}).",
    )
    parser.add_argument(
        "--quick",
        action="store_true",
        help=(
            "Fast lifecycle schedule: joins close in 3 minutes and the panel is "
            "resolvable about 5.5 minutes after publishing. Individual window "
            "flags still override it."
        ),
    )
    parser.add_argument(
        "--block-margin",
        type=int,
        default=DEFAULT_BLOCK_MARGIN,
        help=(
            "Threshold offset above the Bitcoin block height at publish time "
            f"(default: {DEFAULT_BLOCK_MARGIN})."
        ),
    )
    parser.add_argument(
        "--panel-window",
        type=int,
        default=0,
        help=(
            "Seconds from the join deadline to the panel's information "
            "cut-off. Defaults to the commit window, which makes the first "
            "runner's attempt exactly fill the panel. Set it larger to leave "
            "slack, so a forfeited runner hands the SAME panel to the next "
            "seat instead of voiding it for liveness."
        ),
    )
    parser.add_argument(
        "--contract",
        default="",
        help=(
            "Publish onto an existing deployment instead of deploying a new "
            "one. Requires the publisher key that owns that contract."
        ),
    )
    options = parser.parse_args()

    prefer_ipv4()

    key = os.environ.get("REALITY_BRIDGE_DEPLOYER_KEY", "").strip()
    if not key and KEY_PATH.exists():
        key = KEY_PATH.read_text(encoding="utf-8").strip()
        log(f"reusing the publisher key in {KEY_PATH.name}")
    if key:
        account = create_account(key)
    else:
        account = create_account()
        # A generated key must be persisted. Without it the publisher role is
        # lost the moment this process exits, and no further round can ever be
        # authored on the contract it is about to deploy.
        KEY_PATH.write_text(account.key.hex(), encoding="utf-8")
        log(f"generated a publisher key and saved it to {KEY_PATH}")
        log("KEEP THAT FILE. It is git-ignored and it is the only way to")
        log("author further rounds on this deployment.")
    log(f"publisher account {account.address}")

    client = create_client(chain=studionet, account=account)

    balance = client.get_balance(account.address)
    log(f"balance {balance}")
    if balance < ENTRY_WEI * 4:
        log("funding through the StudioNet faucet ...")
        client.fund_account(account.address, FUNDING_WEI)
        log(f"balance {client.get_balance(account.address)}")

    transactions: dict[str, str] = {}
    if options.contract:
        address = options.contract
        log(f"publishing onto the existing contract {address}")
    else:
        code = CONTRACT_PATH.read_bytes()
        log("deploying reality_bridge.py ...")
        deploy_hash = client.deploy_contract(code=code, args=[], account=account)
        deploy_tx = wait_for(client, str(deploy_hash), "deploy")
        address = (deploy_tx.get("data") or {}).get("contract_address")
        if not address:
            raise SystemExit("deployment returned no contract address")
        log(f"contract deployed at {address}")
        transactions["deploy"] = str(deploy_hash)

    # Re-registering an already-registered host is a no-op update, so this is
    # safe to run again when publishing onto an existing deployment.
    transactions["register_source"] = send(
        client,
        account,
        address,
        "register_source",
        [EVIDENCE_HOST, EVIDENCE_LABEL],
        "register_source",
    )
    transactions["register_fixture_source"] = send(
        client,
        account,
        address,
        "register_source",
        [FIXTURE_HOST, FIXTURE_LABEL],
        "register_source",
    )

    # Publishing onto an existing deployment must not erase the record of that
    # deployment, so a manifest for the same contract is merged into.
    manifest: dict = {}
    if MANIFEST_PATH.exists():
        try:
            previous = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            previous = {}
        if previous.get("contractAddress") == address:
            manifest = previous
            merged = dict(manifest.get("transactions") or {})
            merged.update(transactions)
            transactions = merged

    manifest.update(
        {
            "network": "GenLayer StudioNet",
            "networkKey": "studionet",
            "chainId": studionet.id,
            "rpc": studionet.rpc_urls["default"]["http"][0]
            if isinstance(getattr(studionet, "rpc_urls", None), dict)
            else "https://studio.genlayer.com/api",
            "runner": CONTRACT_PATH.read_text(encoding="utf-8").splitlines()[0],
            "contractAddress": address,
            "publisher": account.address,
            "transactions": transactions,
        }
    )
    manifest.setdefault("deployedAt", iso(int(time.time())))
    manifest.setdefault("rounds", [])
    manifest.setdefault("frontendUrl", None)

    if not options.skip_round:
        # --quick supplies defaults; anything passed explicitly still wins.
        given = set(sys.argv[1:])
        def chose(flag: str) -> bool:
            return any(arg == flag or arg.startswith(flag + "=") for arg in given)

        quick = QUICK_SCHEDULE if options.quick else {}
        join_window = (
            quick["join_window"]
            if quick and not chose("--join-window")
            else options.join_window
        )
        commit_window = (
            quick["commit_window"]
            if quick and not chose("--commit-window")
            else options.commit_window
        )
        reveal_grace = (
            quick["reveal_grace"]
            if quick and not chose("--reveal-grace")
            else options.reveal_grace
        )
        panel_window = (
            quick["panel_window"]
            if quick and not chose("--panel-window")
            else (options.panel_window or options.commit_window)
        )
        if panel_window < commit_window:
            raise SystemExit(
                "--panel-window must be at least the commit window, or the "
                "first runner cannot receive a full attempt."
            )
        now = int(time.time())
        join_deadline = now + join_window
        choice_deadline = join_deadline + panel_window
        resolution_time = choice_deadline + reveal_grace
        terminal_deadline = now + TERMINAL_HORIZON

        transactions["create_round"] = send(
            client,
            account,
            address,
            "create_round",
            [
                options.round_id,
                "Reality Bridge — will Bitcoin move past the line?",
                ENTRY_WEI,
                join_deadline,
                terminal_deadline,
                commit_window,
                reveal_grace,
            ],
            "create_round",
        )
        # The target block does not exist at publish time, so at the moment
        # players commit, the answer genuinely does not exist yet either.
        height_at_publish = current_block_height()
        threshold = height_at_publish + options.block_margin
        log(
            f"Bitcoin tip height at publish: {height_at_publish}; "
            f"panel block: {threshold}"
        )
        evidence_url = (
            f"https://{EVIDENCE_HOST}"
            f"{EVIDENCE_PATH_TEMPLATE.format(height=threshold)}"
        )
        question = (
            f"Was Bitcoin block {threshold} mined at or before "
            f"{iso(resolution_time)}?"
        )
        condition = (
            f"The registered source returns JSON for the block at height "
            f"{threshold}, including a `timestamp` field holding the block "
            f"header time as a Unix second. YES when that timestamp is less "
            f"than or equal to {resolution_time}. NO when it is greater than "
            f"{resolution_time}. A mined block's timestamp never changes, so "
            f"this answer is the same whenever it is asked. If the source "
            f"reports that no block exists at height {threshold}, the chain "
            f"has not reached that height yet and the answer is not available "
            f"yet: return UNRESOLVED rather than an outcome. Report "
            f"`observed_at` as that block's `timestamp`."
        )

        transactions["add_tile"] = send(
            client,
            account,
            address,
            "add_tile",
            [
                options.round_id,
                0,
                question,
                condition,
                evidence_url,
                "",
                "",
                choice_deadline,
                resolution_time,
            ],
            "add_tile",
        )
        transactions["open_round"] = send(
            client,
            account,
            address,
            "open_round",
            [options.round_id],
            "open_round",
        )

        published = {
            "roundId": options.round_id,
            "entryWei": str(ENTRY_WEI),
            "joinDeadline": join_deadline,
            "joinDeadlineIso": iso(join_deadline),
            "commitWindowSeconds": commit_window,
            "revealGraceSeconds": reveal_grace,
            "choiceDeadline": choice_deadline,
            "choiceDeadlineIso": iso(choice_deadline),
            "resolutionTime": resolution_time,
            "resolutionTimeIso": iso(resolution_time),
            "terminalDeadline": terminal_deadline,
            "terminalDeadlineIso": iso(terminal_deadline),
            "panelWindowSeconds": panel_window,
            "evidenceUrl": evidence_url,
            "question": question,
            "blockHeightAtPublish": height_at_publish,
            "targetBlockHeight": threshold,
            "evidenceAnchor": "block header timestamp, compared against resolutionTime",
            "transactions": {
                key: transactions[key]
                for key in ("create_round", "add_tile", "open_round")
                if key in transactions
            },
        }
        rounds = [
            entry
            for entry in manifest.get("rounds", [])
            if entry.get("roundId") != options.round_id
        ]
        rounds.append(published)
        rounds.sort(key=lambda entry: entry["roundId"])
        manifest["rounds"] = rounds

    manifest["transactions"] = transactions
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    log(f"manifest written to {MANIFEST_PATH}")

    print()
    print("NEXT_PUBLIC_REALITY_BRIDGE_CONTRACT=" + address)
    if not options.skip_round:
        print("NEXT_PUBLIC_REALITY_BRIDGE_ROUND_ID=" + str(options.round_id))
    return 0


if __name__ == "__main__":
    sys.exit(main())
