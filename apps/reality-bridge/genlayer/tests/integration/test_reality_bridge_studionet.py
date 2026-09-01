"""Hosted GenLayer StudioNet journey for Reality Bridge.

This suite runs against the real StudioNet consensus endpoint. It proves the
complete product path end to end: deployment, source registration, round
authoring, opening, two funded joins, activation, commit, reveal, a real
validator resolution against a stable public evidence fixture, deterministic
settlement, and a successful native GEN withdrawal.

Nothing here is mocked. Every assertion reads StudioNet state back through the
contract's own views or through an accepted transaction receipt.

Run it explicitly (it is slow — StudioNet transactions take minutes each):

    python -m pytest tests/integration -q -s

StudioNet accounts start empty, so the suite funds each account it uses
through the simulator faucet before it sends a transaction.
"""

import hashlib
import time
from pathlib import Path

import pytest
from gltest import get_contract_factory, get_default_account
from gltest.accounts import create_accounts
from gltest.assertions import tx_execution_succeeded
from gltest.clients import get_gl_client
from gltest_cli.config.general import get_general_config


CONTRACT = str(
    Path(__file__).resolve().parents[2] / "contracts" / "reality_bridge.py"
)

# StudioNet is slow; every wait below is sized for real consensus latency.
WAIT_INTERVAL_MS = 3000
WAIT_RETRIES = 240

BASE_TS = 2051222400  # 2035-01-01T00:00:00Z
BASE_ISO = "2035-01-01T00:00:00Z"

ENTRY = 10**16  # 0.01 GEN
FUNDING = 10 * 10**18  # 10 GEN per participant

COMMIT_WINDOW = 300
GRACE = 60
JOIN_DEADLINE = BASE_TS + 600
CHOICE_DEADLINE = BASE_TS + 900  # exactly join_deadline + commit window
RESOLUTION_TIME = BASE_TS + 960  # exactly choice_deadline + reveal grace
TERMINAL_DEADLINE = BASE_TS + 7200

# The panel must be answerable *as of a fixed instant*, which means the
# evidence has to carry its own timestamp. A static fixture page cannot: it
# says what is true whenever you happen to load it, so an answer derived from
# it is an answer about the moment resolution ran. This suite therefore
# exercises the same height-addressed, immutable source production uses.
#
# The block is long since mined, so the outcome is deterministic (its header
# time is far below the simulated 2035 resolution instant) while still
# travelling the real anchored path end to end.
EVIDENCE_HOST = "blockstream.info"
TARGET_BLOCK = 900000
EVIDENCE_URL = f"https://{EVIDENCE_HOST}/api/blocks/{TARGET_BLOCK}"
QUESTION = (
    f"Was Bitcoin block {TARGET_BLOCK} mined at or before "
    f"2035-01-01T00:16:00Z?"
)
YES_CONDITION = (
    f"The registered source returns JSON for the block at height "
    f"{TARGET_BLOCK}, including a `timestamp` field holding the block header "
    f"time as a Unix second. YES when that timestamp is less than or equal to "
    f"{BASE_TS + 960}. NO when it is greater. Report `observed_at` as that "
    f"block's `timestamp`."
)

SALT = "studionet-salt-v2"


def context(iso_datetime: str) -> dict:
    return {"genvm_datetime": iso_datetime}


def at(offset: int) -> str:
    hours, remainder = divmod(offset, 3600)
    minutes, seconds = divmod(remainder, 60)
    return f"2035-01-01T{hours:02d}:{minutes:02d}:{seconds:02d}Z"


def commitment(address: str, choice: str = "YES") -> str:
    canonical = "\x1f".join(
        (
            "reality-bridge-choice-v1",
            "1",
            "0",
            address.lower(),
            choice,
            SALT,
        )
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def evidence_receipt(
    host: str,
    status: str,
    outcome: str,
    event_id: str,
    date: str,
    observed_at: str,
) -> str:
    canonical = "".join(
        (
            "reality-bridge-evidence-v2",
            "1",
            "0",
            host,
            status,
            outcome,
            event_id,
            date,
            str(RESOLUTION_TIME),
            observed_at,
        )
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def log(message: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {message}", flush=True)


def fund(client, address: str) -> None:
    """StudioNet accounts start empty; top them up through the faucet."""

    client.fund_account(address, FUNDING)
    log(f"funded {address}")


def send(call, label: str, **kwargs):
    started = time.time()
    receipt = call.transact(
        wait_interval=WAIT_INTERVAL_MS,
        wait_retries=WAIT_RETRIES,
        **kwargs,
    )
    assert tx_execution_succeeded(receipt), f"{label} failed: {receipt}"
    log(f"{label} accepted in {time.time() - started:.0f}s")
    return receipt


def require_studionet() -> None:
    """Refuse to run anywhere but StudioNet.

    ``gltest`` reads ``gltest.config.yaml`` from the *current* directory. The
    selected network is checked explicitly, so a run without the StudioNet
    configuration fails loudly instead of claiming a hosted result it never
    obtained.
    """

    network = get_general_config().get_network_name()
    if network != "studionet":
        pytest.fail(
            f"This suite must run against StudioNet, but gltest selected "
            f"'{network}'. Run it from apps/reality-bridge/genlayer so that "
            f"gltest.config.yaml is picked up: "
            f"cd apps/reality-bridge/genlayer "
            f"&& python -m pytest tests/integration -q -s",
            pytrace=False,
        )


@pytest.mark.integration
def test_studionet_round_from_deployment_to_withdrawal():
    require_studionet()
    client = get_gl_client()
    publisher = get_default_account()
    challenger = create_accounts(1)[0]

    fund(client, publisher.address)
    fund(client, challenger.address)

    factory = get_contract_factory(contract_file_path=CONTRACT)
    started = time.time()
    contract = factory.deploy(
        args=[],
        account=publisher,
        wait_interval=WAIT_INTERVAL_MS,
        wait_retries=WAIT_RETRIES,
    )
    log(f"deployed at {contract.address} in {time.time() - started:.0f}s")

    send(
        contract.register_source(
            args=[EVIDENCE_HOST, "Blockstream public Bitcoin block explorer API"]
        ),
        "register_source",
        transaction_context=context(BASE_ISO),
    )
    send(
        contract.create_round(
            args=[
                1,
                "StudioNet Reality Bridge",
                ENTRY,
                JOIN_DEADLINE,
                TERMINAL_DEADLINE,
                COMMIT_WINDOW,
                GRACE,
            ]
        ),
        "create_round",
        transaction_context=context(BASE_ISO),
    )
    send(
        contract.add_tile(
            args=[
                1,
                0,
                QUESTION,
                YES_CONDITION,
                EVIDENCE_URL,
                "",
                "",
                CHOICE_DEADLINE,
                RESOLUTION_TIME,
            ]
        ),
        "add_tile",
        transaction_context=context(BASE_ISO),
    )
    send(
        contract.open_round(args=[1]),
        "open_round",
        transaction_context=context(BASE_ISO),
    )

    send(
        contract.join_round(args=[1]),
        "join_round(publisher)",
        value=ENTRY,
        transaction_context=context(at(60)),
    )
    challenger_contract = contract.connect(challenger)
    send(
        challenger_contract.join_round(args=[1]),
        "join_round(challenger)",
        value=ENTRY,
        transaction_context=context(at(60)),
    )

    round_view = contract.get_round(args=[1]).call()
    assert round_view["player_count"] == 2
    assert round_view["pool"] == 2 * ENTRY

    # Activation is permissionless: the second player starts the round.
    send(
        challenger_contract.start_round(args=[1]),
        "start_round",
        transaction_context=context(at(600)),
    )
    round_view = contract.get_round(args=[1]).call()
    assert round_view["status"] == "ACTIVE"
    assert round_view["attempt_deadline"] == CHOICE_DEADLINE

    send(
        contract.commit_choice(args=[1, commitment(publisher.address)]),
        "commit_choice",
        transaction_context=context(at(620)),
    )
    send(
        contract.reveal_choice(args=[1, "YES", SALT]),
        "reveal_choice",
        transaction_context=context(at(640)),
    )
    player_view = contract.get_player(args=[1, publisher.address]).call()
    assert player_view["revealed"] is True
    assert player_view["choice"] == "YES"

    # The real consensus step: validators independently render the registered
    # evidence source and must derive the same decision fields.
    send(
        contract.resolve_tile(args=[1]),
        "resolve_tile",
        consensus_max_rotations=5,
        transaction_context=context(at(960)),
    )

    tile = contract.get_tile(args=[1, 0]).call()
    log(f"tile outcome={tile['outcome']} reason={tile['reason_code']} "
        f"event_id={tile['event_id']} date={tile['effective_date']} "
        f"observed_at={tile['observed_at']}")
    assert tile["status"] == "RESOLVED"
    assert tile["outcome"] == "YES"
    assert tile["reason_code"] == "FINAL_EVIDENCE"
    # The panel settled on evidence that carried its own timestamp, and that
    # timestamp is inside the receipt: the record says when the answer was
    # true, not merely what it was.
    assert tile["observed_at"], "a settled panel must record when its evidence was true"
    assert int(tile["observed_at"]) <= RESOLUTION_TIME
    assert tile["evidence_receipt"] == evidence_receipt(
        EVIDENCE_HOST,
        "FINAL",
        "YES",
        tile["event_id"],
        tile["effective_date"],
        tile["observed_at"],
    )

    round_view = contract.get_round(args=[1]).call()
    assert round_view["status"] == "SETTLED"

    publisher_view = contract.get_player(args=[1, publisher.address]).call()
    challenger_view = contract.get_player(args=[1, challenger.address]).call()
    assert publisher_view["discovery_credits"] == 1
    # Weights 1 + 3*1 = 4 and 1 over a pool of 2 * ENTRY.
    assert publisher_view["claim_amount"] + challenger_view["claim_amount"] == 2 * ENTRY
    assert publisher_view["claim_amount"] > challenger_view["claim_amount"]

    balance_before = client.get_balance(challenger.address)
    send(
        challenger_contract.claim(args=[1]),
        "claim(challenger)",
        transaction_context=context(at(1000)),
    )
    assert contract.get_player(args=[1, challenger.address]).call()["claimed"] is True
    balance_after = client.get_balance(challenger.address)
    log(f"challenger balance {balance_before} -> {balance_after}")

    send(
        contract.claim(args=[1]),
        "claim(publisher)",
        transaction_context=context(at(1000)),
    )
    round_view = contract.get_round(args=[1]).call()
    assert round_view["claimed_amount"] == round_view["pool"]
    log(f"StudioNet journey complete for contract {contract.address}")
