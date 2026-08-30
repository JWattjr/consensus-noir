"""Guard: the hosted test must agree with the contract before it spends GEN.

The StudioNet test performs several network writes before it reaches the
reveal. A stale commitment helper there is only discovered after real money has
moved, so the agreement is checked here instead, in milliseconds.
"""

import ast
import builtins
import hashlib
import importlib.util
import json
from pathlib import Path

INTEGRATION = (
    Path(__file__).resolve().parents[1]
    / "integration"
    / "test_consensus_noir_studionet.py"
)


def _load():
    spec = importlib.util.spec_from_file_location("_studionet_probe", INTEGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_hosted_test_has_no_undefined_names():
    """Catches the exact failure mode where a patch lands half-applied."""
    tree = ast.parse(INTEGRATION.read_text(encoding="utf-8"))
    module = _load()
    known = set(dir(module)) | set(dir(builtins)) | {"__file__"}
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            known.update(a.arg for a in node.args.args)
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store):
            known.add(node.id)
        if isinstance(node, ast.ExceptHandler) and node.name:
            known.add(node.name)
    used = {
        n.id for n in ast.walk(tree)
        if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load)
    }
    assert not (used - known), f"undefined in hosted test: {sorted(used - known)}"


def test_hosted_commitment_matches_the_contract_preimage():
    module = _load()
    address = "0xAbC0000000000000000000000000000000000001"
    theory = "A settled chain of reasoning about the frozen file."
    salt = "a" * 32
    suspect = "SUSPECT-B"

    digest = hashlib.sha256(theory.encode("utf-8")).hexdigest()
    expected = hashlib.sha256(
        "\x1f".join(
            (
                "consensus-noir-accusation-v1",
                module.CASE_ID,
                address.lower(),
                suspect,
                digest,
                ",".join(sorted(module.PICKS)),
                salt,
            )
        ).encode("utf-8")
    ).hexdigest()

    assert module.commitment(address, suspect, theory, salt) == expected


def test_hosted_test_picks_exactly_three_valid_evidence_ids():
    module = _load()
    assert len(module.PICKS) == 3, module.PICKS
    assert len(set(module.PICKS)) == 3, module.PICKS
    known = {item["id"] for item in module.EVIDENCE}
    assert set(module.PICKS) <= known, (module.PICKS, known)
    assert json.loads(module.PICKS_JSON) == module.PICKS
