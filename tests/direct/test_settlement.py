"""Settlement coverage: payouts must emit a real native transfer, and every
terminal state must be reachable without a prior side effect.

Direct mode does not simulate value movement for either payout primitive, so
these tests assert the emitted GenVM call rather than a balance. The
authoritative balance check lives in the StudioNet integration test.
"""

import json

import test_consensus_noir as base
from test_consensus_noir import (
    CASE_ID,
    CONTRACT,
    STAKE,
    _mock_result,
    _prepare_resolvable,
    address_text,
    PICKS_JSON,
    enter,
    open_case,
)


def capture_calls(direct_vm, work):
    """Record every GenVM call the direct harness does not handle itself."""
    seen = []
    direct_vm._gl_call_hook = lambda vm, request: seen.append(request) or None
    try:
        work()
    finally:
        direct_vm._gl_call_hook = None
    return seen


def only_transfer(seen):
    messages = [item["PostMessage"] for item in seen if "PostMessage" in item]
    assert len(messages) == 1, f"expected one native transfer, saw {seen}"
    assert not any("EthSend" in item for item in seen), "no EVM send may remain"
    assert messages[0]["on"] == "finalized"
    return int(messages[0]["value"])


def reach_verdict(direct_vm, contract, alice, bob, bob_suspect, culprit="S1"):
    open_case(direct_vm, contract)
    alice_text = enter(direct_vm, contract, alice, "S1", "a" * 32)
    bob_text = enter(direct_vm, contract, bob, bob_suspect, "b" * 32)
    direct_vm.warp("2030-01-02T01:00:00Z")
    contract.advance_case(CASE_ID)
    direct_vm.sender = alice
    contract.reveal_accusation(CASE_ID, "S1", alice_text, PICKS_JSON, "a" * 32)
    direct_vm.sender = bob
    contract.reveal_accusation(CASE_ID, bob_suspect, bob_text, PICKS_JSON, "b" * 32)
    direct_vm.warp("2030-01-03T01:00:00Z")
    contract.advance_case(CASE_ID)
    direct_vm.warp("2030-01-04T01:00:00Z")
    _mock_result(direct_vm, culprit=culprit)
    contract.resolve_case(CASE_ID)


def test_claim_emits_a_finalized_native_transfer(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy(CONTRACT)
    reach_verdict(direct_vm, contract, direct_alice, direct_bob, "S1")
    direct_vm.sender = direct_alice
    paid = only_transfer(
        capture_calls(direct_vm, lambda: contract.claim_case(CASE_ID))
    )
    assert paid == STAKE, "two correct accusers split a two-stake pool"


def test_sole_winner_is_paid_the_whole_pool(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy(CONTRACT)
    reach_verdict(direct_vm, contract, direct_alice, direct_bob, "S2")
    direct_vm.sender = direct_alice
    paid = only_transfer(
        capture_calls(direct_vm, lambda: contract.claim_case(CASE_ID))
    )
    assert paid == STAKE * 2
    assert contract.get_accounting(CASE_ID)["unpaid_obligation"] == 0


def test_refund_emits_a_finalized_native_transfer(
    direct_vm, direct_deploy, direct_alice
):
    contract = direct_deploy(CONTRACT)
    open_case(direct_vm, contract)
    enter(direct_vm, contract, direct_alice, "S1", "a" * 32)
    direct_vm.warp("2030-01-02T01:00:00Z")
    contract.cancel_case(CASE_ID)
    direct_vm.sender = direct_alice
    paid = only_transfer(
        capture_calls(direct_vm, lambda: contract.refund_case(CASE_ID))
    )
    assert paid == STAKE


def test_verdict_with_no_correct_accuser_opens_refunds_immediately(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    """A FINAL verdict naming an unaccused suspect must be settleable without
    anyone having to call claim_case first to unlock the flag."""
    contract = direct_deploy(CONTRACT)
    _prepare_resolvable(direct_vm, contract, direct_alice, direct_bob)
    _mock_result(direct_vm, culprit="S3")
    contract.resolve_case(CASE_ID)

    case = contract.get_case(CASE_ID)
    assert case["status"] == "RESOLVED"
    assert case["no_winner_refund"] is True, "flag must be set by the verdict"

    for player in (direct_alice, direct_bob):
        direct_vm.sender = player
        paid = only_transfer(
            capture_calls(direct_vm, lambda: contract.claim_case(CASE_ID))
        )
        assert paid == STAKE
    assert contract.get_accounting(CASE_ID)["unpaid_obligation"] == 0


def test_no_winner_entries_can_also_take_the_refund_path(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy(CONTRACT)
    _prepare_resolvable(direct_vm, contract, direct_alice, direct_bob)
    _mock_result(direct_vm, culprit="S3")
    contract.resolve_case(CASE_ID)
    direct_vm.sender = direct_alice
    contract.refund_case(CASE_ID)
    assert contract.get_entry(CASE_ID, address_text(direct_alice))["refunded"] is True
    with direct_vm.expect_revert("Entry already settled"):
        contract.refund_case(CASE_ID)


def _reveal_with(direct_vm, contract, player, suspect_id, text, picks, salt):
    direct_vm.sender = player
    contract.reveal_accusation(
        CASE_ID, suspect_id, text, json.dumps(picks, separators=(",", ":")), salt
    )


def test_evidence_agreement_weights_the_split(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    """Both accusers are right, but only one cites the evidence the validators
    found decisive. Equal-suspect no longer means equal-payout."""
    contract = direct_deploy(CONTRACT)
    open_case(direct_vm, contract)
    sharp = base.theory("Sharp reading.")
    dull = base.theory("Dull reading.")
    sharp_picks = ["E1", "E2", "E3"]      # matches the verdict exactly -> weight 4
    dull_picks = ["E3", "E4", "E5"]       # one overlap             -> weight 2
    direct_vm.sender = direct_alice
    direct_vm.value = STAKE
    contract.enter_case(
        CASE_ID,
        base.commitment(
            CASE_ID, address_text(direct_alice), "S1", sharp, "a" * 32, sharp_picks
        ),
    )
    direct_vm.sender = direct_bob
    direct_vm.value = STAKE
    contract.enter_case(
        CASE_ID,
        base.commitment(
            CASE_ID, address_text(direct_bob), "S1", dull, "b" * 32, dull_picks
        ),
    )
    direct_vm.warp("2030-01-02T01:00:00Z")
    contract.advance_case(CASE_ID)
    _reveal_with(direct_vm, contract, direct_alice, "S1", sharp, sharp_picks, "a" * 32)
    _reveal_with(direct_vm, contract, direct_bob, "S1", dull, dull_picks, "b" * 32)
    direct_vm.warp("2030-01-03T01:00:00Z")
    contract.advance_case(CASE_ID)
    direct_vm.warp("2030-01-04T01:00:00Z")
    _mock_result(direct_vm)               # FINAL, S1, cites E1/E2/E3
    contract.resolve_case(CASE_ID)

    payouts = {}
    for player, label in ((direct_alice, "sharp"), (direct_bob, "dull")):
        direct_vm.sender = player
        payouts[label] = only_transfer(
            capture_calls(direct_vm, lambda: contract.claim_case(CASE_ID))
        )

    # weights 4 and 2 over a 200 pool -> 133 and 66, remainder 1 wei assigned
    assert payouts["sharp"] > payouts["dull"], payouts
    assert payouts["sharp"] + payouts["dull"] == STAKE * 2, payouts
    assert contract.get_accounting(CASE_ID)["unpaid_obligation"] == 0


def test_reveal_requires_exactly_three_distinct_evidence_picks(
    direct_vm, direct_deploy, direct_alice
):
    contract = direct_deploy(CONTRACT)
    open_case(direct_vm, contract)
    text = base.theory("Two picks only.")
    picks = ["E1", "E2"]
    direct_vm.sender = direct_alice
    direct_vm.value = STAKE
    contract.enter_case(
        CASE_ID,
        base.commitment(
            CASE_ID, address_text(direct_alice), "S1", text, "a" * 32, picks
        ),
    )
    direct_vm.warp("2030-01-02T01:00:00Z")
    contract.advance_case(CASE_ID)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("Pick exactly three distinct evidence items"):
        contract.reveal_accusation(
            CASE_ID, "S1", text, json.dumps(picks, separators=(",", ":")), "a" * 32
        )


def test_final_verdict_must_cite_exactly_three_evidence_items(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy(CONTRACT)
    base._prepare_resolvable(direct_vm, contract, direct_alice, direct_bob)
    direct_vm.mock_llm(
        r".*Return JSON only with exactly.*",
        json.dumps(
            {
                "case_id": CASE_ID,
                "status": "FINAL",
                "culprit_id": "S1",
                "material_evidence_ids": ["E1", "E2"],
                "contradicted_statement_ids": [],
                "confidence_bucket": "HIGH",
                "reason_code": "convergent_evidence",
            }
        ),
    )
    with direct_vm.expect_revert("[LLM_ERROR]"):
        contract.resolve_case(CASE_ID)
    assert contract.get_case(CASE_ID)["status"] == "RESOLVABLE"
    assert contract.get_accounting(CASE_ID)["paid_out"] == 0
