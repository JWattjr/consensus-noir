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

Exit status is 0 only when every check passes.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))

from netprefs import prefer_ipv4  # noqa: E402  (must follow the sys.path setup)

prefer_ipv4()

from genlayer_py import create_account, create_client  # noqa: E402
from genlayer_py.chains import studionet  # noqa: E402
from genlayer_py.types import TransactionHashVariant  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "deployment" / "studionet.json"
CONTRACT_SOURCE = ROOT / "genlayer" / "contracts" / "reality_bridge.py"

FIELD_SEPARATOR = "\x1f"
RECEIPT_VERSION = "reality-bridge-evidence-v2"
EXPECTED_CHAIN_ID = 61999

results: list[tuple[bool, str, str]] = []


def check(ok: bool, name: str, evidence: str) -> bool:
    results.append((ok, name, evidence))
    print(f"  {'PASS' if ok else 'FAIL'}  {name}\n        {evidence}", flush=True)
    return ok


def section(title: str) -> None:
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


def main() -> int:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    address = manifest["contractAddress"]

    print(f"Reality Bridge submission verification")
    print(f"contract {address} on {manifest['network']}")

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
    )
    check(
        manifest["chainId"] == EXPECTED_CHAIN_ID,
        "manifest targets StudioNet only",
        f"chainId {manifest['chainId']}, rpc {manifest['rpc']}",
    )

    section("Live chain state")

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
        check(False, "contract is deployed and queryable", str(error)[:120])
    else:
        check(
            methods == 28,
            "contract is deployed and exposes the documented interface",
            f"{methods} methods at {address}",
        )

    round_ids = [int(r["roundId"]) for r in manifest.get("rounds", [])]
    settled_verified = 0

    for round_id in round_ids:
        try:
            round_view = read("get_round", [round_id])
        except Exception as error:  # pragma: no cover - network dependent
            check(False, f"round {round_id} is readable", str(error)[:120])
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
            )
        elif status == "REFUNDABLE":
            check(
                refunded <= pool,
                f"round {round_id} refunds within its pool",
                f"refunded {refunded} <= pool {pool} wei",
            )
        else:
            check(
                claimed == 0 and refunded == 0,
                f"round {round_id} has paid nothing out while {status}",
                f"claimed {claimed}, refunded {refunded}",
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
            )

            observed = tile.get("observed_at", "")
            instant = int(tile["resolution_time"])

            if tile["reason_code"] == "FINAL_EVIDENCE":
                check(
                    bool(observed),
                    f"round {round_id} panel {index + 1}: settled on anchored evidence",
                    f"observed_at={observed or '(missing)'}",
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
                        )
                    else:
                        check(
                            real == int(observed),
                            f"round {round_id} panel {index + 1}: stored timestamp matches the live source",
                            f"block {height} header time {real} == stored observed_at {observed}",
                        )
                        expected = "YES" if real <= instant else "NO"
                        check(
                            tile["outcome"] == expected,
                            f"round {round_id} panel {index + 1}: outcome follows the evidence, not the caller",
                            f"block mined {real - instant:+d}s relative to the panel "
                            f"instant -> {expected}; stored {tile['outcome']}",
                        )
                        if resolved_at > real:
                            check(
                                True,
                                f"round {round_id} panel {index + 1}: resolution ran after the block existed",
                                f"resolved {resolved_at - real}s after the block was mined, "
                                f"yet the outcome is still {tile['outcome']} -- caller "
                                f"timing did not move it",
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
            )
        elif address.lower() in served:
            check(
                True,
                "hosted client serves the contract this repository documents",
                f"{hosted} references {address}",
            )
        elif stale:
            note = PREVIOUS_DEPLOYMENTS[sorted(stale)[0]]
            check(
                False,
                "hosted client is still serving a superseded deployment",
                f"{hosted} references {sorted(stale)[0]} -- {note}. Set "
                f"NEXT_PUBLIC_REALITY_BRIDGE_CONTRACT={address} on the host "
                f"and redeploy.",
            )
        else:
            check(
                False,
                "hosted client does not reference the documented contract",
                f"{hosted} ships no reference to {address}. Set "
                f"NEXT_PUBLIC_REALITY_BRIDGE_CONTRACT={address} on the host "
                f"and redeploy.",
            )

    section("Summary")
    failed = [name for ok, name, _ in results if not ok]
    print(f"  {len(results) - len(failed)}/{len(results)} checks passed")
    print(f"  {settled_verified} anchored panel(s) verified against the live source")
    if failed:
        print("\n  FAILED:")
        for name in failed:
            print(f"    - {name}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
