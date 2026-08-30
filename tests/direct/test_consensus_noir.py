"""Fast direct-mode coverage for Consensus Noir's deterministic boundaries."""

import hashlib
import json
import unicodedata
from pathlib import Path


CONTRACT = str(
    Path(__file__).resolve().parents[2] / "contracts" / "consensus_noir.py"
)
CASE_ID = "glasshouse-0217"
STAKE = 100
OPEN_TIME = "2030-01-01T00:00:00Z"
ACCUSATION_DEADLINE = 1893542400  # 2030-01-02
REVEAL_DEADLINE = 1893628800  # 2030-01-03
RESOLUTION_TIME = 1893715200  # 2030-01-04
REFUND_DEADLINE = 1893801600  # 2030-01-05

SUSPECTS = [
    {"id": "S1", "name": "Mara Vale", "profile": "Archivist with a perfect memory."},
    {"id": "S2", "name": "Ivo March", "profile": "Courier who knows every service door."},
    {"id": "S3", "name": "Lenore Quill", "profile": "Patron who financed the exhibition."},
]
STATEMENTS = [
    {"id": "S1-STMT-1", "suspect_id": "S1", "text": "I left before the clock stopped."},
    {"id": "S2-STMT-1", "suspect_id": "S2", "text": "I never entered the conservatory."},
    {"id": "S3-STMT-1", "suspect_id": "S3", "text": "The ledger was already missing."},
]
TIMELINE = [
    {"id": "T1", "at": "01:40", "event": "Rain begins."},
    {"id": "T2", "at": "02:00", "event": "The gallery lights flicker."},
    {"id": "T3", "at": "02:17", "event": "The conservatory clock stops."},
]
EVIDENCE = [
    {"id": "E1", "summary": "Wet footprints lead from the service door to the ledger plinth."},
    {"id": "E2", "summary": "A brass key has fresh scratches matching the archive lock."},
    {"id": "E3", "summary": "The stopped clock is twelve minutes slow against the hallway camera."},
    {"id": "E4", "summary": "A torn courier seal is caught under the plinth."},
    {"id": "E5", "summary": "The patron's umbrella is dry despite claiming to have crossed the garden."},
]
RUBRIC = (
    "Treat the frozen file as authoritative. Identify material contradictions, "
    "prefer independent corroboration, consider exculpatory evidence, reject "
    "invented facts, choose one suspect only when materially better supported, "
    "otherwise return VOID, and use UNRESOLVED for temporary failures."
)


def address_text(address) -> str:
    if hasattr(address, "as_hex"):
        return address.as_hex
    if isinstance(address, bytes):
        return "0x" + address.hex()
    return str(address)


def theory(seed: str) -> str:
    return (seed + " The chronology and physical traces converge on the accused. ") * 14


PICKS = ["E1", "E2", "E3"]
PICKS_JSON = json.dumps(PICKS, separators=(",", ":"))


def commitment(
    case_id: str,
    player: str,
    suspect_id: str,
    text: str,
    salt: str,
    picks=None,
) -> str:
    normalized = " ".join(text.split())
    theory_digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    canonical = "\x1f".join(
        (
            "consensus-noir-accusation-v1",
            case_id,
            player.lower(),
            suspect_id,
            theory_digest,
            ",".join(sorted(PICKS if picks is None else picks)),
            salt,
        )
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def create(contract, source_urls="[]"):
    contract.create_case(
        CASE_ID,
        "The Glasshouse at 02:17",
        "A rain-slick conservatory and one vanished ledger.",
        "At 02:17 the clock stopped, the ledger vanished, and three alibis collided.",
        "Which suspect is materially best supported as responsible?",
        json.dumps(SUSPECTS, separators=(",", ":")),
        json.dumps(STATEMENTS, separators=(",", ":")),
        json.dumps(TIMELINE, separators=(",", ":")),
        json.dumps(EVIDENCE, separators=(",", ":")),
        source_urls,
        RUBRIC,
        ACCUSATION_DEADLINE,
        REVEAL_DEADLINE,
        RESOLUTION_TIME,
        REFUND_DEADLINE,
        STAKE,
        2,
        4,
    )


def open_case(direct_vm, contract, source_urls="[]"):
    direct_vm.warp(OPEN_TIME)
    create(contract, source_urls=source_urls)
    contract.publish_case(CASE_ID)


def enter(direct_vm, contract, player, suspect_id, salt):
    player_text = address_text(player)
    text = theory(player_text)
    direct_vm.sender = player
    direct_vm.value = STAKE
    contract.enter_case(
        CASE_ID,
        commitment(CASE_ID, player_text, suspect_id, text, salt),
    )
    return text


def test_only_owner_can_create_and_publish(
    direct_vm, direct_deploy, direct_alice, direct_owner
):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(OPEN_TIME)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("Only curator"):
        create(contract)

    direct_vm.sender = direct_owner
    create(contract)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("Only curator"):
        contract.publish_case(CASE_ID)


def test_open_material_is_immutable_and_no_culprit_setter(
    direct_vm, direct_deploy, direct_owner
):
    contract = direct_deploy(CONTRACT)
    open_case(direct_vm, contract)
    before = contract.get_case(CASE_ID)
    assert before["status"] == "OPEN"
    assert before["title"] == "The Glasshouse at 02:17"
    assert not hasattr(contract, "set_culprit")
    direct_vm.sender = direct_owner
    with direct_vm.expect_revert("Case is not a draft"):
        contract.publish_case(CASE_ID)
    after = contract.get_case(CASE_ID)
    assert after["evidence"] == before["evidence"]
    assert after["rubric"] == before["rubric"]


def test_one_entry_and_exact_value_are_enforced(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    open_case(direct_vm, contract)
    direct_vm.sender = direct_alice
    direct_vm.value = STAKE - 1
    with direct_vm.expect_revert("Entry value must equal the case stake"):
        contract.enter_case(CASE_ID, "0" * 64)
    direct_vm.value = STAKE
    text = enter(direct_vm, contract, direct_alice, "S1", "a" * 32)
    assert len(text.encode("utf-8")) >= 300
    with direct_vm.expect_revert("Player already entered"):
        contract.enter_case(CASE_ID, "1" * 64)
    assert contract.get_case(CASE_ID)["player_count"] == 1
    assert contract.get_accounting(CASE_ID)["total_escrow"] == STAKE


def test_reveal_must_match_commitment_and_missed_reveal_cannot_win(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy(CONTRACT)
    open_case(direct_vm, contract)
    alice_text = enter(direct_vm, contract, direct_alice, "S1", "a" * 32)
    enter(direct_vm, contract, direct_bob, "S2", "b" * 32)
    direct_vm.warp("2030-01-02T01:00:00Z")
    contract.advance_case(CASE_ID)

    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("Reveal does not match commitment"):
        contract.reveal_accusation(CASE_ID, "S1", alice_text + "changed", PICKS_JSON, "a" * 32)
    contract.reveal_accusation(CASE_ID, "S1", alice_text, PICKS_JSON, "a" * 32)
    assert contract.get_entry(CASE_ID, address_text(direct_alice))["revealed"] is True
    assert contract.get_entry(CASE_ID, address_text(direct_alice))["theory"] == " ".join(alice_text.split())
    assert contract.get_entry(CASE_ID, address_text(direct_alice)).get("salt") is None


def _prepare_resolvable(direct_vm, contract, alice, bob):
    open_case(direct_vm, contract)
    alice_text = enter(direct_vm, contract, alice, "S1", "a" * 32)
    bob_text = enter(direct_vm, contract, bob, "S2", "b" * 32)
    direct_vm.warp("2030-01-02T01:00:00Z")
    contract.advance_case(CASE_ID)
    direct_vm.sender = alice
    contract.reveal_accusation(CASE_ID, "S1", alice_text, PICKS_JSON, "a" * 32)
    direct_vm.sender = bob
    contract.reveal_accusation(CASE_ID, "S2", bob_text, PICKS_JSON, "b" * 32)
    direct_vm.warp("2030-01-03T01:00:00Z")
    contract.advance_case(CASE_ID)
    direct_vm.warp("2030-01-04T01:00:00Z")


def _mock_result(direct_vm, status="FINAL", culprit="S1", reason="convergent_evidence"):
    direct_vm.mock_llm(
        r".*Return JSON only with exactly.*",
        json.dumps(
            {
                "case_id": CASE_ID,
                "status": status,
                "culprit_id": culprit,
                "material_evidence_ids": ["E1", "E2", "E3"] if status == "FINAL" else [],
                "contradicted_statement_ids": ["S2-STMT-1"] if status == "FINAL" else [],
                "confidence_bucket": "HIGH" if status == "FINAL" else "NONE",
                "reason_code": reason,
            }
        ),
    )


def test_final_consensus_persists_only_stable_result_fields(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy(CONTRACT)
    _prepare_resolvable(direct_vm, contract, direct_alice, direct_bob)
    direct_vm.mock_llm(
        r".*Return JSON only with exactly.*",
        json.dumps(
            {
                "case_id": CASE_ID,
                "status": "FINAL",
                "culprit_id": "S1",
                "material_evidence_ids": ["E3", "E2", "E1", "E1"],
                "contradicted_statement_ids": ["S2-STMT-1"],
                "confidence_bucket": "HIGH",
                "reason_code": "convergent_evidence",
            }
        ),
    )
    contract.resolve_case(CASE_ID)
    result = contract.get_resolution(CASE_ID)
    assert result["status"] == "FINAL"
    assert result["culprit_id"] == "S1"
    assert result["material_evidence_ids"] == ["E1", "E2", "E3"]
    assert result["contradicted_statement_ids"] == ["S2-STMT-1"]
    assert contract.get_case(CASE_ID)["status"] == "RESOLVED"


def test_validator_rechecks_substantive_fields_and_rejects_disagreement(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy(CONTRACT)
    _prepare_resolvable(direct_vm, contract, direct_alice, direct_bob)
    _mock_result(direct_vm, culprit="S1")
    contract.resolve_case(CASE_ID)

    # Re-run the validator against a materially different model answer. The
    # stable culprit/evidence fields must disagree even though both are valid JSON.
    direct_vm.clear_mocks()
    _mock_result(direct_vm, culprit="S2")
    assert direct_vm.run_validator() is False


def test_correct_claims_split_pool_and_incorrect_or_unrevealed_cannot_claim(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = direct_deploy(CONTRACT)
    open_case(direct_vm, contract)
    alice_text = enter(direct_vm, contract, direct_alice, "S1", "a" * 32)
    bob_text = enter(direct_vm, contract, direct_bob, "S1", "b" * 32)
    enter(direct_vm, contract, direct_charlie, "S2", "c" * 32)
    direct_vm.warp("2030-01-02T01:00:00Z")
    contract.advance_case(CASE_ID)
    direct_vm.sender = direct_alice
    contract.reveal_accusation(CASE_ID, "S1", alice_text, PICKS_JSON, "a" * 32)
    direct_vm.sender = direct_bob
    contract.reveal_accusation(CASE_ID, "S1", bob_text, PICKS_JSON, "b" * 32)
    direct_vm.warp("2030-01-03T01:00:00Z")
    contract.advance_case(CASE_ID)
    direct_vm.warp("2030-01-04T01:00:00Z")
    _mock_result(direct_vm)
    contract.resolve_case(CASE_ID)

    direct_vm.sender = direct_alice
    contract.claim_case(CASE_ID)
    direct_vm.sender = direct_bob
    contract.claim_case(CASE_ID)
    assert contract.get_accounting(CASE_ID)["paid_out"] == STAKE * 3
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("not a correct revealed accusation"):
        contract.claim_case(CASE_ID)


def test_underfilled_case_can_be_cancelled_and_refunded(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    open_case(direct_vm, contract)
    enter(direct_vm, contract, direct_alice, "S1", "a" * 32)
    direct_vm.warp("2030-01-02T01:00:00Z")
    contract.cancel_case(CASE_ID)
    assert contract.get_case(CASE_ID)["status"] == "CANCELLED"
    direct_vm.sender = direct_alice
    contract.refund_case(CASE_ID)
    assert contract.get_accounting(CASE_ID)["paid_out"] == STAKE


def test_malformed_result_forces_disagreement_and_does_not_settle(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy(CONTRACT)
    _prepare_resolvable(direct_vm, contract, direct_alice, direct_bob)
    direct_vm.mock_llm(r".*Return JSON only with exactly.*", "not json")
    with direct_vm.expect_revert("[LLM_ERROR]"):
        contract.resolve_case(CASE_ID)
    assert contract.get_case(CASE_ID)["status"] == "RESOLVABLE"
    assert contract.get_accounting(CASE_ID)["paid_out"] == 0


def test_void_result_refunds_individual_entries(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy(CONTRACT)
    _prepare_resolvable(direct_vm, contract, direct_alice, direct_bob)
    direct_vm.mock_llm(
        r".*Return JSON only with exactly.*",
        json.dumps(
            {
                "case_id": CASE_ID,
                "status": "VOID",
                "culprit_id": "",
                "material_evidence_ids": [],
                "contradicted_statement_ids": [],
                "confidence_bucket": "NONE",
                "reason_code": "underdetermined",
            }
        ),
    )
    contract.resolve_case(CASE_ID)
    assert contract.get_case(CASE_ID)["status"] == "VOID"
    direct_vm.sender = direct_alice
    contract.refund_case(CASE_ID)
    assert contract.get_entry(CASE_ID, address_text(direct_alice))["refunded"] is True
    assert contract.get_accounting(CASE_ID)["paid_out"] == STAKE
    with direct_vm.expect_revert("Entry already settled"):
        contract.refund_case(CASE_ID)


def test_unresolved_attempt_never_extends_refund_deadline(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy(CONTRACT)
    _prepare_resolvable(direct_vm, contract, direct_alice, direct_bob)
    _mock_result(direct_vm, status="UNRESOLVED", culprit="", reason="execution_unavailable")
    contract.resolve_case(CASE_ID)
    assert contract.get_case(CASE_ID)["status"] == "RESOLVABLE"
    assert contract.get_case(CASE_ID)["resolution_attempts"] == 1
    assert contract.get_case(CASE_ID)["refund_deadline"] == REFUND_DEADLINE


def test_terminal_resolution_is_single_shot_and_has_no_curator_withdraw_path(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy(CONTRACT)
    _prepare_resolvable(direct_vm, contract, direct_alice, direct_bob)
    _mock_result(direct_vm)
    contract.resolve_case(CASE_ID)
    with direct_vm.expect_revert("Case is not resolvable"):
        contract.resolve_case(CASE_ID)
    assert not hasattr(contract, "withdraw_escrow")


def test_nfkc_theory_normalization_is_part_of_the_commitment(
    direct_vm, direct_deploy, direct_alice
):
    contract = direct_deploy(CONTRACT)
    open_case(direct_vm, contract)
    raw = ("Ａ chain\nwith\tfull-width evidence. ") * 12
    normalized = " ".join(unicodedata.normalize("NFKC", raw).split())
    direct_vm.sender = direct_alice
    direct_vm.value = STAKE
    contract.enter_case(
        CASE_ID,
        commitment(CASE_ID, address_text(direct_alice), "S1", normalized, "a" * 32),
    )
    direct_vm.warp("2030-01-02T01:00:00Z")
    contract.advance_case(CASE_ID)
    contract.reveal_accusation(CASE_ID, "S1", raw, PICKS_JSON, "a" * 32)
    assert contract.get_entry(CASE_ID, address_text(direct_alice))["theory"] == normalized


def test_unavailable_source_blocks_publication_not_resolution(
    direct_vm, direct_deploy, direct_owner
):
    """Sources are captured once at publication, so an outage stops the case
    being published rather than corrupting a later verdict."""
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(OPEN_TIME)
    direct_vm.mock_web(
        r".*evidence\.example\.com/glasshouse.*",
        {"status": 503, "body": "temporary source outage"},
    )
    create(
        contract,
        source_urls=json.dumps(
            ["https://evidence.example.com/glasshouse"], separators=(",", ":")
        ),
    )
    with direct_vm.expect_revert():
        contract.publish_case(CASE_ID)
    assert contract.get_case(CASE_ID)["status"] == "DRAFT"


def test_transient_failure_and_fixed_deadline_still_unlocks_refunds(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy(CONTRACT)
    _prepare_resolvable(direct_vm, contract, direct_alice, direct_bob)
    _mock_result(
        direct_vm,
        status="UNRESOLVED",
        culprit="",
        reason="execution_unavailable",
    )
    contract.resolve_case(CASE_ID)
    assert contract.get_resolution(CASE_ID)["status"] == "UNRESOLVED"
    assert contract.get_resolution(CASE_ID)["reason_code"] == "execution_unavailable"

    direct_vm.warp("2030-01-05T01:00:00Z")
    with direct_vm.expect_revert("Refund deadline has passed"):
        contract.resolve_case(CASE_ID)
    contract.make_refundable(CASE_ID)
    assert contract.get_case(CASE_ID)["status"] == "REFUNDABLE"
    direct_vm.sender = direct_alice
    contract.refund_case(CASE_ID)
    direct_vm.sender = direct_bob
    contract.refund_case(CASE_ID)
    assert contract.get_accounting(CASE_ID)["paid_out"] == STAKE * 2
