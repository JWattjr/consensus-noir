"""Build a local ``GENVMROOT`` so ``genvm-lint validate`` can load the pinned SDK.

``genvm-lint validate`` resolves the runner named in the contract header from
the *latest* GenVM artifact bundle. Newer bundles no longer ship the runner this
contract pins, so validation fails with "Failed to load SDK" even though the
contract is correct and the pin is deliberate.

The GenLayer test harness (``genlayer-test``) already downloads and extracts the
matching ``py-lib-genlayer-std`` for the pinned runner. This script mirrors that
extracted SDK into ``.genvmroot/runners/py-lib-genlayer-std/src``, which is the
layout ``genvm-lint`` looks for when ``GENVMROOT`` is set.

Usage (from the app root)::

    python scripts/make_genvmroot.py
    GENVMROOT=.genvmroot genvm-lint check contracts/consensus_noir.py

Relaxing the pinned runner is not an acceptable alternative.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parents[1]
TARGET = APP_ROOT / ".genvmroot" / "runners" / "py-lib-genlayer-std" / "src"
CACHE = Path.home() / ".cache" / "gltest-direct" / "extracted"


def find_sdk() -> Path:
    """Locate an extracted py-lib-genlayer-std that contains ``genlayer/``."""

    if not CACHE.exists():
        raise SystemExit(
            f"No extracted GenVM SDK under {CACHE}.\n"
            "Run the direct test suite once so genlayer-test downloads it:\n"
            "  python -m pytest tests/direct -q"
        )
    candidates = sorted(CACHE.glob("*/py-lib-genlayer-std/*/genlayer"))
    if not candidates:
        raise SystemExit(f"No py-lib-genlayer-std SDK found under {CACHE}")
    return candidates[-1].parent


def main() -> int:
    source = find_sdk()
    if TARGET.exists():
        shutil.rmtree(TARGET)
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, TARGET, ignore=shutil.ignore_patterns("__pycache__"))
    print(f"copied {source}\n    -> {TARGET}")
    print()
    print("Now run:")
    print(f"  GENVMROOT={TARGET.parents[2]} genvm-lint check "
          "contracts/consensus_noir.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
