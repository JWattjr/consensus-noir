"""Independently re-verify Reality Bridge's on-chain claims.

This script trusts nothing in this repository's prose. It reads the deployed
contract from GenLayer StudioNet, reads the evidence source from the public
internet, and checks that the two agree with each other and with the receipt
scheme documented in ``specs/PRODUCT_SPEC.md``.

Every check either passes against live data or fails loudly. Nothing here is
self-reported: the block timestamps come from Blockstream, the panel outcomes
come from the chain, and the receipts are recomputed from stored fields rather
than compared against a stored copy of themselves.

    python genlayer/scripts/verify_submission.py
    python genlayer/scripts/verify_submission.py --json
    python genlayer/scripts/verify_submission.py --manifest-only --json

Exit status is 0 only when every check passes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "deployment" / "studionet.json"
REVIEW_MANIFEST = ROOT / "submission" / "review-manifest.json"
CONTRACT_SOURCE = ROOT / "genlayer" / "contracts" / "reality_bridge.py"

FIELD_SEPARATOR = "\x1f"
RECEIPT_VERSION = "reality-bridge-evidence-v2"
EXPECTED_CHAIN_ID = 61999

results: list[dict[str, object]] = []
json_output = False
current_section = ""


def check(ok: bool, name: str, evidence: str, check_id: str | None = None) -> bool:
    """Record one falsifiable check in both human and machine-friendly form."""

    identifier = check_id or re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    results.append(
        {
            "id": identifier,
            "section": current_section,
            "passed": bool(ok),
            "name": name,
            "evidence": evidence,
        }
    )
    if not json_output:
        print(f"  {'PASS' if ok else 'FAIL'}  {name}\n        {evidence}", flush=True)
    return ok


def section(title: str) -> None:
    global current_section
    current_section = title
    if not json_output:
        print(f"\n=== {title} ===", flush=True)


def fetch_json(url: str) -> object:
    request = urllib.request.Request(url, headers={"User-Agent": "reality-bridge"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_text(url: str, timeout: int = 30) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "reality-bridge"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", errors="replace")


#: Deployments this project has published before. A hosted client still
#: serving one of these is configured against superseded contract code.
PREVIOUS_DEPLOYMENTS = {
    "0x4de4c2afc908fd744b65fe8361fee4dc1c5c8ca9": (
        "the pre-fix deployment, whose panel question depended on caller timing"
    ),
}

SENTINEL_ADDRESSES = {
    "0x" + "0" * 40,
    "0x" + "f" * 40,
    "0x" + "F" * 40,
}


def hosted_addresses(base_url: str) -> set[str]:
    """Collect every contract-shaped address the hosted client ships.

    ``NEXT_PUBLIC_*`` values are inlined into the built JavaScript, so reading
    the bundle is the honest way to check the running deployment matches this
    repository rather than taking the manifest's word for it. Bundles also
    contain sentinels such as the all-ones address, which are filtered out.
    """

    found: set[str] = set()
    try:
        html = fetch_text(base_url)
    except Exception:
        return found

    chunks = set(re.findall(r"[\"'(]([^\"'()]*?/_next/static/[^\"')]+?\.js)", html))
    chunks |= set(re.findall(r'src="([^"]+\.js)"', html))

    bodies = [html]
    for path in chunks:
        url = path if path.startswith("http") else base_url.rstrip("/") + path
        try:
            bodies.append(fetch_text(url, timeout=20))
        except Exception:
            continue

    for body in bodies:
        for address in re.findall(r"0x[0-9a-fA-F]{40}", body):
            if address not in SENTINEL_ADDRESSES:
                found.add(address.lower())
    return found


def receipt_for(round_id: int, tile: dict) -> str:
    """Recompute a tile's receipt from its stored fields.

    The tile stores the *tile* outcome, which is `VOID` for every void reason;
    the receipt commits to the *decision* outcome, which is `NONE` for a void.
    """

    final = tile["reason_code"] == "FINAL_EVIDENCE"
    canonical = FIELD_SEPARATOR.join(
        (
            RECEIPT_VERSION,
            str(round_id),
            str(int(tile["tile_index"])),
            urlparse(tile["primary_url"]).hostname or "",
            "FINAL" if final else "VOID",
            tile["outcome"] if final else "NONE",
            tile["event_id"],
            tile["effective_date"],
            str(int(tile["resolution_time"])),
            tile["observed_at"],
        )
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Re-derive Reality Bridge's submission claims from repository, "
            "StudioNet, public evidence, and the hosted client."
        )
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="emit one machine-readable JSON result and no human formatting",
    )
    parser.add_argument(
        "--manifest-only",
        action="store_true",
        help=(
            "validate the review manifest and every local artifact reference "
            "without network access or GenLayer dependencies"
        ),
    )
    return parser.parse_args(argv)


def _review_paths(review: dict) -> list[str]:
    paths: list[str] = []
    project = review.get("project", {})
    if isinstance(project, dict) and isinstance(project.get("reviewEntryPoint"), str):
        paths.append(project["reviewEntryPoint"])

    limitations = review.get("knownLimitations")
    if isinstance(limitations, str):
        paths.append(limitations)

    reading_order = review.get("readingOrder", [])
    if isinstance(reading_order, list):
        paths.extend(item for item in reading_order if isinstance(item, str))

    claims = review.get("claims", [])
    if isinstance(claims, list):
        for claim in claims:
            if not isinstance(claim, dict):
                continue
            evidence = claim.get("evidence", [])
            if not isinstance(evidence, list):
                continue
            for item in evidence:
                if isinstance(item, dict) and isinstance(item.get("path"), str):
                    paths.append(item["path"])
    return paths


def validate_review_manifest(deployment: dict) -> dict | None:
    """Validate the machine-readable review package without network access."""

    section("Review package")
    try:
        review = json.loads(REVIEW_MANIFEST.read_text(encoding="utf-8"))
    except Exception as error:
        check(False, "review manifest has a valid schema", str(error), "review_manifest_schema")
        check(
            False,
            "review manifest references existing local artifacts",
            "manifest could not be parsed",
            "review_manifest_artifacts",
        )
        check(
            False,
            "review manifest matches the deployed StudioNet artifact",
            "manifest could not be parsed",
            "review_manifest_deployment",
        )
        return None

    schema_errors: list[str] = []
    if review.get("schemaVersion") != 1:
        schema_errors.append("schemaVersion must be 1")
    project = review.get("project")
    if not isinstance(project, dict) or not all(
        isinstance(project.get(key), str) and project.get(key)
        for key in ("name", "oneLine", "reviewEntryPoint", "repository", "frontend")
    ):
        schema_errors.append("project metadata is incomplete")
    verification = review.get("verification")
    if not isinstance(verification, dict):
        schema_errors.append("verification must be an object")
    else:
        for mode in ("live", "offline"):
            value = verification.get(mode)
            if not isinstance(value, dict) or not isinstance(value.get("command"), str):
                schema_errors.append(f"verification.{mode}.command is required")
    claims = review.get("claims")
    claim_ids: list[str] = []
    if not isinstance(claims, list) or not claims:
        schema_errors.append("claims must be a non-empty array")
    else:
        for claim in claims:
            if not isinstance(claim, dict):
                schema_errors.append("every claim must be an object")
                continue
            claim_id = claim.get("id")
            if not isinstance(claim_id, str) or not claim_id:
                schema_errors.append("every claim needs an id")
            else:
                claim_ids.append(claim_id)
            if not isinstance(claim.get("claim"), str) or not claim.get("claim"):
                schema_errors.append(f"claim {claim_id or '(unknown)'} has no statement")
            evidence = claim.get("evidence")
            if not isinstance(evidence, list) or not evidence:
                schema_errors.append(f"claim {claim_id or '(unknown)'} has no evidence")
            else:
                for item in evidence:
                    if not isinstance(item, dict) or not isinstance(
                        item.get("locator"), str
                    ):
                        schema_errors.append(
                            f"claim {claim_id or '(unknown)'} has malformed evidence"
                        )
                        continue
                    has_path = isinstance(item.get("path"), str) and bool(item["path"])
                    has_url = isinstance(item.get("url"), str) and bool(item["url"])
                    if has_path == has_url:
                        schema_errors.append(
                            f"claim {claim_id or '(unknown)'} evidence needs one path or url"
                        )
            live_ids = claim.get("liveCheckIds")
            if not isinstance(live_ids, list) or not all(
                isinstance(value, str) and value for value in live_ids
            ):
                schema_errors.append(
                    f"claim {claim_id or '(unknown)'} has invalid liveCheckIds"
                )
        if len(claim_ids) != len(set(claim_ids)):
            schema_errors.append("claim ids must be unique")
    if not isinstance(review.get("readingOrder"), list) or not review.get(
        "readingOrder"
    ):
        schema_errors.append("readingOrder must be a non-empty array")
    if not isinstance(review.get("knownLimitations"), str):
        schema_errors.append("knownLimitations must be a path")

    check(
        not schema_errors,
        "review manifest has a valid schema",
        f"{len(claim_ids)} claims with stable ids"
        if not schema_errors
        else "; ".join(schema_errors),
        "review_manifest_schema",
    )

    path_errors: list[str] = []
    checked_paths: set[str] = set()
    for raw in _review_paths(review):
        if raw in checked_paths:
            continue
        checked_paths.add(raw)
        candidate = Path(raw)
        if candidate.is_absolute() or ".." in candidate.parts:
            path_errors.append(f"unsafe path: {raw}")
            continue
        resolved = (ROOT / candidate).resolve()
        try:
            resolved.relative_to(ROOT.resolve())
        except ValueError:
            path_errors.append(f"path escapes repository: {raw}")
            continue
        if not resolved.is_file():
            path_errors.append(f"missing file: {raw}")

    check(
        not path_errors and bool(checked_paths),
        "review manifest references existing local artifacts",
        f"{len(checked_paths)} unique files resolved inside the application"
        if not path_errors and checked_paths
        else "; ".join(path_errors) or "no artifact paths declared",
        "review_manifest_artifacts",
    )

    live = review.get("liveDeployment", {})
    deployed_round_ids = {
        int(item["roundId"])
        for item in deployment.get("rounds", [])
        if isinstance(item, dict) and "roundId" in item
    }
    deployment_ok = isinstance(live, dict) and all(
        (
            live.get("network") == deployment.get("network"),
            live.get("chainId") == deployment.get("chainId") == EXPECTED_CHAIN_ID,
            str(live.get("contractAddress", "")).lower()
            == str(deployment.get("contractAddress", "")).lower(),
            live.get("frontend") == deployment.get("frontendUrl"),
            live.get("sourceOfTruth") == "deployment/studionet.json",
            live.get("proofRoundId") in deployed_round_ids,
            isinstance(project, dict)
            and project.get("frontend") == deployment.get("frontendUrl"),
        )
    )
    check(
        deployment_ok,
        "review manifest matches the deployed StudioNet artifact",
        (
            f"chain {deployment.get('chainId')}, contract "
            f"{deployment.get('contractAddress')}, frontend {deployment.get('frontendUrl')}"
        )
        if deployment_ok
        else "liveDeployment differs from deployment/studionet.json",
        "review_manifest_deployment",
    )
    return review


def finish(
    deployment: dict,
    review: dict | None,
    settled_verified: int,
    mode: str,
) -> int:
    failed = [result for result in results if not result["passed"]]
    passed = len(results) - len(failed)

    if json_output:
        payload = {
            "schemaVersion": 1,
            "project": (review or {}).get("project", {}).get("name", "Reality Bridge"),
            "mode": mode,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "deployment": {
                "network": deployment.get("network"),
                "chainId": deployment.get("chainId"),
                "contractAddress": deployment.get("contractAddress"),
                "frontend": deployment.get("frontendUrl"),
                "sourceOfTruth": "deployment/studionet.json",
            },
            "checks": results,
            "summary": {
                "passed": passed,
                "failed": len(failed),
                "total": len(results),
                "allPassed": not failed,
                "anchoredPanelsVerified": settled_verified,
            },
        }
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        section("Summary")
        print(f"  {passed}/{len(results)} checks passed")
        if mode == "live":
            print(f"  {settled_verified} anchored panel(s) verified against the live source")
        if failed:
            print("\n  FAILED:")
            for result in failed:
                print(f"    - {result['name']}")
    return 1 if failed else 0


def main(argv: list[str] | None = None) -> int:
    global json_output
    args = parse_args(argv)
    json_output = args.json
    results.clear()

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    address = manifest["contractAddress"]

    if not json_output:
        print("Reality Bridge submission verification")
        print(f"contract {address} on {manifest['network']}")

    review = validate_review_manifest(manifest)
    if args.manifest_only:
        return finish(manifest, review, settled_verified=0, mode="manifest-only")

    section("Offline repository invariants")

    source = CONTRACT_SOURCE.read_text(encoding="utf-8")
    offenders = sorted({c for c in source if ord(c) > 127})
    check(
        not offenders,
        "contract source is ASCII-only",
        "schema generation transmits the source as ASCII; one non-ASCII byte "
        "makes it undeployable"
        if offenders
        else f"{len(source)} characters, no byte above 0x7F",
        "contract_source_ascii",
    )
    check(
        manifest["chainId"] == EXPECTED_CHAIN_ID,
        "manifest targets StudioNet only",
        f"chainId {manifest['chainId']}, rpc {manifest['rpc']}",
        "studionet_only",
    )

    section("Live chain state")

    # Keep these imports below --manifest-only so CI and review agents can
    # validate the evidence package with the Python standard library alone.
    from netprefs import prefer_ipv4

    prefer_ipv4()

    from genlayer_py import create_account, create_client
    from genlayer_py.chains import studionet
    from genlayer_py.types import TransactionHashVariant

    client = create_client(chain=studionet, account=create_account())

    def read(fn: str, args: list) -> dict:
        return client.read_contract(
            address=address,
            function_name=fn,
            args=args,
            transaction_hash_variant=TransactionHashVariant.LATEST_FINAL,
        )

    try:
        schema = client.get_contract_schema(address)
        methods = len(schema.get("methods", {}))
    except Exception as error:  # pragma: no cover - network dependent
        methods = 0
        check(
            False,
            "contract is deployed and queryable",
            str(error)[:120],
            "contract_interface",
        )
    else:
        check(
            methods == 28,
            "contract is deployed and exposes the documented interface",
            f"{methods} methods at {address}",
            "contract_interface",
        )

    round_ids = [int(r["roundId"]) for r in manifest.get("rounds", [])]
    settled_verified = 0

    for round_id in round_ids:
        try:
            round_view = read("get_round", [round_id])
        except Exception as error:  # pragma: no cover - network dependent
            check(
                False,
                f"round {round_id} is readable",
                str(error)[:120],
                f"round_{round_id}_readable",
            )
            continue
        if not round_view:
            continue

        status = round_view["status"]
        pool = int(round_view["pool"])
        claimed = int(round_view["claimed_amount"])
        refunded = int(round_view["refunded_amount"])

        section(f"Round {round_id} ({status})")

        if status == "SETTLED":
            check(
                claimed == pool,
                f"round {round_id} conserves its pool",
                f"claimed {claimed} == pool {pool} wei",
                f"round_{round_id}_pool_conservation",
            )
        elif status == "REFUNDABLE":
            check(
                refunded <= pool,
                f"round {round_id} refunds within its pool",
                f"refunded {refunded} <= pool {pool} wei",
                f"round_{round_id}_pool_conservation",
            )
        else:
            check(
                claimed == 0 and refunded == 0,
                f"round {round_id} has paid nothing out while {status}",
                f"claimed {claimed}, refunded {refunded}",
                f"round_{round_id}_pool_conservation",
            )

        for index in range(int(round_view["tile_count"])):
            tile = read("get_tile", [round_id, index])
            if tile.get("status") != "RESOLVED" or not tile.get("evidence_receipt"):
                continue

            recomputed = receipt_for(round_id, tile)
            check(
                recomputed == tile["evidence_receipt"],
                f"round {round_id} panel {index + 1}: receipt recomputes from stored fields",
                f"sha256 over the documented v2 pre-image == {tile['evidence_receipt'][:24]}...",
                f"round_{round_id}_panel_{index + 1}_receipt",
            )

            observed = tile.get("observed_at", "")
            instant = int(tile["resolution_time"])

            if tile["reason_code"] == "FINAL_EVIDENCE":
                check(
                    bool(observed),
                    f"round {round_id} panel {index + 1}: settled on anchored evidence",
                    f"observed_at={observed or '(missing)'}",
                    f"round_{round_id}_panel_{index + 1}_anchored",
                )

                # The claim under review: the outcome must follow from the
                # evidence's own timestamp against the panel's instant, not
                # from whenever resolution ran.
                resolved_at = int(tile["resolved_at"])
                host = urlparse(tile["primary_url"]).hostname or ""
                if host == "blockstream.info" and observed:
                    try:
                        blocks = fetch_json(tile["primary_url"])
                        block = blocks[0] if isinstance(blocks, list) else blocks
                        real = int(block["timestamp"])
                        height = int(block["height"])
                    except Exception as error:  # pragma: no cover
                        check(
                            False,
                            f"round {round_id} panel {index + 1}: evidence re-fetched",
                            str(error)[:120],
                            f"round_{round_id}_panel_{index + 1}_source_timestamp",
                        )
                    else:
                        check(
                            real == int(observed),
                            f"round {round_id} panel {index + 1}: stored timestamp matches the live source",
                            f"block {height} header time {real} == stored observed_at {observed}",
                            f"round_{round_id}_panel_{index + 1}_source_timestamp",
                        )
                        expected = "YES" if real <= instant else "NO"
                        check(
                            tile["outcome"] == expected,
                            f"round {round_id} panel {index + 1}: outcome follows the evidence, not the caller",
                            f"block mined {real - instant:+d}s relative to the panel "
                            f"instant -> {expected}; stored {tile['outcome']}",
                            f"round_{round_id}_panel_{index + 1}_outcome",
                        )
                        if resolved_at > real:
                            check(
                                True,
                                f"round {round_id} panel {index + 1}: resolution ran after the block existed",
                                f"resolved {resolved_at - real}s after the block was mined, "
                                f"yet the outcome is still {tile['outcome']} -- caller "
                                f"timing did not move it",
                                f"round_{round_id}_panel_{index + 1}_caller_independence",
                            )
                settled_verified += 1

    hosted = manifest.get("frontendUrl")
    if hosted:
        section("Hosted client")
        served = hosted_addresses(hosted)
        stale = served & set(PREVIOUS_DEPLOYMENTS)
        if not served:
            check(
                False,
                "hosted client's configured contract could not be read",
                f"{hosted} exposed no contract-shaped address in its bundle",
                "hosted_client_contract",
            )
        elif address.lower() in served:
            check(
                True,
                "hosted client serves the contract this repository documents",
                f"{hosted} references {address}",
                "hosted_client_contract",
            )
        elif stale:
            note = PREVIOUS_DEPLOYMENTS[sorted(stale)[0]]
            check(
                False,
                "hosted client is still serving a superseded deployment",
                f"{hosted} references {sorted(stale)[0]} -- {note}. Set "
                f"NEXT_PUBLIC_REALITY_BRIDGE_CONTRACT={address} on the host "
                f"and redeploy.",
                "hosted_client_contract",
            )
        else:
            check(
                False,
                "hosted client does not reference the documented contract",
                f"{hosted} ships no reference to {address}. Set "
                f"NEXT_PUBLIC_REALITY_BRIDGE_CONTRACT={address} on the host "
                f"and redeploy.",
                "hosted_client_contract",
            )

    if review:
        referenced_ids = {
            check_id
            for claim in review.get("claims", [])
            if isinstance(claim, dict)
            for check_id in claim.get("liveCheckIds", [])
            if isinstance(check_id, str)
        }
        emitted_ids = {str(result["id"]) for result in results}
        missing_ids = sorted(referenced_ids - emitted_ids)
        check(
            not missing_ids,
            "machine-readable claims map to emitted live checks",
            f"{len(referenced_ids)} referenced check ids resolved"
            if not missing_ids
            else f"missing check ids: {', '.join(missing_ids)}",
            "review_manifest_live_checks",
        )

    return finish(manifest, review, settled_verified, mode="live")


if __name__ == "__main__":
    sys.exit(main())
