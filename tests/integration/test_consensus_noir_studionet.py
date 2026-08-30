"""Opt-in hosted test for the complete Consensus Noir consensus boundary.

This test deliberately uses the real GenLayer validators: no mocked model,
web-render, or payout response is injected. It is skipped by default because
it spends a hosted consensus transaction and requires two funded StudioNet
accounts in the local gltest configuration.
"""

import hashlib
import json
import os
import re
from pathlib import Path

import pytest
from gltest import get_accounts, get_contract_factory
from gltest.assertions import tx_execution_succeeded


CONTRACT = str(Path(__file__).resolve().parents[2] / "contracts" / "consensus_noir.py")
CASE_ID = "glasshouse-0217-integration"
BASE_ISO = "2035-01-01T00:00:00Z"
BASE_TS = 2051222400
ACCUSATION_DEADLINE = BASE_TS + 60
REVEAL_DEADLINE = BASE_TS + 120
RESOLUTION_TIME = BASE_TS + 180
REFUND_DEADLINE = BASE_TS + 900
ENTRY_STAKE = 1
# Hosted validator rotations can legitimately take several minutes. Keep the
# short default for ordinary transactions but allow the opt-in resolve step to
# wait long enough for real StudioNet consensus to finish.
RESOLVE_WAIT_RETRIES = int(os.environ.get("CONSENSUS_NOIR_RESOLVE_WAIT_RETRIES", "1800"))

SUSPECTS = [
    {"id": "SUSPECT-A", "name": "Mara Voss", "profile": "Night curator"},
    {"id": "SUSPECT-B", "name": "Elias Quill", "profile": "Restoration lead"},
    {"id": "SUSPECT-C", "name": "Inez Calder", "profile": "Security liaison"},
]
STATEMENTS = [
    {"id": "STATEMENT-A", "suspect_id": "SUSPECT-A", "text": "I left before the lights failed."},
    {"id": "STATEMENT-B", "suspect_id": "SUSPECT-B", "text": "The east door stayed locked."},
    {"id": "STATEMENT-C", "suspect_id": "SUSPECT-C", "text": "I was in the archive corridor."},
]
TIMELINE = [
    {"id": "TIME-01", "at": "02:02", "event": "The gallery cameras enter maintenance mode."},
    {"id": "TIME-02", "at": "02:17", "event": "The glasshouse alarm reports a forced latch."},
    {"id": "TIME-03", "at": "02:26", "event": "A service badge opens the east corridor."},
]
EVIDENCE = [
    {"id": "EVIDENCE-01", "kind": "log", "text": "The 02:17 latch sensor records an interior release."},
    {"id": "EVIDENCE-02", "kind": "badge", "text": "Badge C-19 opens the east corridor at 02:26."},
    {"id": "EVIDENCE-03", "kind": "camera", "text": "A reflection places a silver repair case beside the latch."},
    {"id": "EVIDENCE-04", "kind": "inventory", "text": "Only the restoration lead signed out a silver repair case."},
    {"id": "EVIDENCE-05", "kind": "radio", "text": "The security desk heard a request from the east corridor."},
]


def tx_context(iso_datetime: str) -> dict:
    return {"genvm_datetime": iso_datetime}


def theory(player_hint: str) -> str:
    return (
        f"{player_hint} The latch log, service-badge timing, reflected repair case, "
        "inventory record, and security radio call form one consistent chain. "
        "The explanation should identify which suspect can account for all five "
        "items while treating the other statements as claims to test, not facts. "
        "No single timestamp is enough on its own; the material inference comes "
        "from the independent overlap between the physical object and access trail."
    )


PICKS = ["EVIDENCE-01", "EVIDENCE-02", "EVIDENCE-04"]
PICKS_JSON = json.dumps(PICKS, separators=(",", ":"))


def commitment(account_address: str, suspect_id: str, normalized_theory: str, salt: str) -> str:
    theory_digest = hashlib.sha256(normalized_theory.encode("utf-8")).hexdigest()
    canonical = "\x1f".join(
        (
            "consensus-noir-accusation-v1",
            CASE_ID,
            account_address.lower(),
            suspect_id,
            theory_digest,
            ",".join(sorted(PICKS)),
            salt,
        )
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def transaction_id(receipt: dict) -> str:
    for key in ("hash", "transaction_hash", "tx_hash", "id"):
        if receipt.get(key):
            return str(receipt[key])
    return "unavailable"


@pytest.mark.integration
def test_real_studionet_consensus_resolves_frozen_dossier():
    if os.environ.get("CONSENSUS_NOIR_RUN_INTEGRATION") != "1":
        pytest.skip("Set CONSENSUS_NOIR_RUN_INTEGRATION=1 to spend a hosted consensus transaction")
    config_text = Path("gltest.config.yaml").read_text(encoding="utf-8")
    if not re.search(r"(?m)^[ \t]*accounts\s*:", config_text):
        pytest.skip("Add two funded StudioNet account keys under studionet.accounts before opting in")

    try:
        accounts = get_accounts()
    except Exception as error:
        pytest.skip(f"StudioNet account configuration is unavailable: {error}")
    if len(accounts) < 2:
        pytest.skip("StudioNet integration needs two configured funded accounts")
    owner, second = accounts[:2]

    factory = get_contract_factory(contract_file_path=CONTRACT)
    try:
        contract = factory.deploy(args=[], account=owner, wait_interval=1000, wait_retries=8)
    except Exception as error:
        message = str(error)
        if any(
            marker in message
            for marker in (
                "Request to ",
                "Max retries exceeded",
                "Connection refused",
                "WinError 10013",
            )
        ):
            pytest.skip(f"StudioNet RPC is unavailable in this environment: {message}")
        raise

    create = contract.create_case(
        args=[
            CASE_ID,
            "The Glasshouse at 02:17",
            "A darkened conservatory contains a broken display and one impossible access trail.",
            "At 02:17, the glasshouse alarm reports a forced latch while the cameras are in maintenance mode.",
            "Which suspect could have staged the incident, and which evidence makes the alternatives fail?",
            json.dumps(SUSPECTS, separators=(",", ":")),
            json.dumps(STATEMENTS, separators=(",", ":")),
            json.dumps(TIMELINE, separators=(",", ":")),
            json.dumps(EVIDENCE, separators=(",", ":")),
            json.dumps([], separators=(",", ":")),
            "Return FINAL only when a suspect is materially better supported by multiple independent evidence items; otherwise return VOID.",
            ACCUSATION_DEADLINE,
            REVEAL_DEADLINE,
            RESOLUTION_TIME,
            REFUND_DEADLINE,
            ENTRY_STAKE,
            2,
            2,
        ]
    ).transact(transaction_context=tx_context(BASE_ISO), wait_interval=1000, wait_retries=8)
    assert tx_execution_succeeded(create), create

    published = contract.publish_case(args=[CASE_ID]).transact(
        transaction_context=tx_context(BASE_ISO), wait_interval=1000, wait_retries=8
    )
    assert tx_execution_succeeded(published), published

    suspect_id = "SUSPECT-B"
    theory_a = theory("Independent note A.")
    theory_b = theory("Independent note B.")
    salt_a = "a" * 32
    salt_b = "b" * 32
    joined = []
    for account, accusation, salt in ((owner, theory_a, salt_a), (second, theory_b, salt_b)):
        joined.append(
            commitment(account.address, suspect_id, accusation, salt)
        )
    first_entry = contract.enter_case(args=[CASE_ID, joined[0]]).transact(
        value=ENTRY_STAKE, transaction_context=tx_context(BASE_ISO), wait_interval=1000, wait_retries=8
    )
    assert tx_execution_succeeded(first_entry), first_entry
    second_entry = contract.connect(second).enter_case(args=[CASE_ID, joined[1]]).transact(
        value=ENTRY_STAKE, transaction_context=tx_context(BASE_ISO), wait_interval=1000, wait_retries=8
    )
    assert tx_execution_succeeded(second_entry), second_entry

    opened_reveal = contract.advance_case(args=[CASE_ID]).transact(
        transaction_context=tx_context("2035-01-01T00:01:01Z"), wait_interval=1000, wait_retries=8
    )
    assert tx_execution_succeeded(opened_reveal), opened_reveal
    revealed_a = contract.reveal_accusation(args=[CASE_ID, suspect_id, theory_a, PICKS_JSON, salt_a]).transact(
        transaction_context=tx_context("2035-01-01T00:01:30Z"), wait_interval=1000, wait_retries=8
    )
    assert tx_execution_succeeded(revealed_a), revealed_a
    revealed_b = contract.connect(second).reveal_accusation(
        args=[CASE_ID, suspect_id, theory_b, PICKS_JSON, salt_b]
    ).transact(
        transaction_context=tx_context("2035-01-01T00:01:30Z"), wait_interval=1000, wait_retries=8
    )
    assert tx_execution_succeeded(revealed_b), revealed_b

    resolvable = contract.advance_case(args=[CASE_ID]).transact(
        transaction_context=tx_context("2035-01-01T00:03:01Z"), wait_interval=1000, wait_retries=8
    )
    assert tx_execution_succeeded(resolvable), resolvable
    resolved = contract.resolve_case(args=[CASE_ID]).transact(
        consensus_max_rotations=5,
        transaction_context=tx_context("2035-01-01T00:04:01Z"),
        wait_interval=1000,
        wait_retries=RESOLVE_WAIT_RETRIES,
    )
    assert tx_execution_succeeded(resolved), resolved

    settlement = "skipped"
    frozen_case_pre = contract.get_case(args=[CASE_ID]).call()
    if frozen_case_pre["status"] == "RESOLVED":
        # The contract's own balance is the honest measure: the claimant pays
        # gas, so their balance can fall even on a correct payout.
        before = int(contract.get_accounting(args=[CASE_ID]).call()["paid_out"])
        claim = contract.claim_case(args=[CASE_ID]).transact(
            wait_interval=1000, wait_retries=30
        )
        assert tx_execution_succeeded(claim), claim
        after = int(contract.get_accounting(args=[CASE_ID]).call()["paid_out"])
        assert after > before, (before, after)
        entry_after = contract.get_entry(
            args=[CASE_ID, owner.address]
        ).call()
        assert entry_after["claimed"] is True, entry_after
        settlement = transaction_id(claim)

    frozen_case = contract.get_case(args=[CASE_ID]).call()
    resolution = contract.get_resolution(args=[CASE_ID]).call()
    assert frozen_case["status"] in ("RESOLVED", "VOID"), frozen_case
    assert resolution["status"] in ("FINAL", "VOID"), resolution
    assert frozen_case["refund_deadline"] == REFUND_DEADLINE
    print(
        "CONSENSUS_NOIR_STUDIONET_RESULT="
        + json.dumps(
            {
                "network": "studionet",
                "contractAddress": contract.address,
                "createTransaction": transaction_id(create),
                "publishTransaction": transaction_id(published),
                "ownerEntryTransaction": transaction_id(first_entry),
                "secondEntryTransaction": transaction_id(second_entry),
                "openRevealTransaction": transaction_id(opened_reveal),
                "ownerRevealTransaction": transaction_id(revealed_a),
                "secondRevealTransaction": transaction_id(revealed_b),
                "resolvableTransaction": transaction_id(resolvable),
                "resolutionTransaction": transaction_id(resolved),
                "claimTransaction": settlement,
                "caseId": CASE_ID,
                "status": frozen_case["status"],
                "resolution": resolution,
            },
            separators=(",", ":"),
        )
    )
