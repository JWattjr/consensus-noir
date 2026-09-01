"""Cache the official GenVM runner bundle under the name gltest expects.

``genlayer-test==0.29.2`` looks for ``genvm-universal.tar.xz`` in the
``v0.3.0-rc7`` release. That release publishes the same archive as
``genvm-runners-all.tar.xz`` instead. A clean CI runner therefore receives a
404 before any direct test can load the deliberately pinned contract runner.

This script downloads the official release asset, verifies its published
SHA-256 digest, and stores it under gltest's cache filename. It never changes
the contract dependency header.
"""

from __future__ import annotations

import hashlib
import os
import sys
import tempfile
import urllib.request
from pathlib import Path


GENVM_VERSION = "v0.3.0-rc7"
ARCHIVE_NAME = "genvm-runners-all.tar.xz"
ARCHIVE_SHA256 = "e218a1854214681560351051f76fe2b878545cf3409455ef372d57014a88ca67"
ARCHIVE_URL = (
    "https://github.com/genlayerlabs/genvm/releases/download/"
    f"{GENVM_VERSION}/{ARCHIVE_NAME}"
)
CACHE_DIR = Path.home() / ".cache" / "gltest-direct"
CACHE_PATH = CACHE_DIR / f"genvm-universal-{GENVM_VERSION}.tar.xz"


def digest(path: Path) -> str:
    checksum = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            checksum.update(chunk)
    return checksum.hexdigest()


def download() -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if CACHE_PATH.exists() and digest(CACHE_PATH) == ARCHIVE_SHA256:
        print(f"verified cached GenVM bundle: {CACHE_PATH}")
        return CACHE_PATH

    request = urllib.request.Request(
        ARCHIVE_URL,
        headers={"User-Agent": "reality-bridge-ci"},
    )
    temporary_name = ""
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            with tempfile.NamedTemporaryFile(
                mode="wb", dir=CACHE_DIR, delete=False, suffix=".download"
            ) as temporary:
                temporary_name = temporary.name
                while chunk := response.read(1024 * 1024):
                    temporary.write(chunk)

        temporary_path = Path(temporary_name)
        actual = digest(temporary_path)
        if actual != ARCHIVE_SHA256:
            raise SystemExit(
                "Downloaded GenVM bundle failed SHA-256 verification: "
                f"expected {ARCHIVE_SHA256}, got {actual}"
            )
        temporary_path.replace(CACHE_PATH)
    finally:
        if temporary_name:
            leftover = Path(temporary_name)
            if leftover.exists():
                os.unlink(leftover)

    print(f"downloaded and verified GenVM bundle: {CACHE_PATH}")
    return CACHE_PATH


def main() -> int:
    download()
    return 0


if __name__ == "__main__":
    sys.exit(main())
