"""Test-suite compatibility shim for genlayer-test on Windows.

The direct runner dup2s a temporary calldata file onto stdin and then tries to
unlink it while that handle is still open. Windows rejects that unlink (the
runner's own cleanup bug), so leave the short-lived file for the process exit
cleanup while preserving all contract behavior.
"""

import os

import pytest


@pytest.fixture(autouse=True, scope="session")
def tolerate_windows_calldata_cleanup():
    try:
        from gltest.direct import loader
    except ImportError:
        yield
        return

    original_inject = loader._inject_message_to_fd0
    original_unlink = os.unlink

    def patched_inject(vm):
        def tolerant_unlink(path):
            try:
                original_unlink(path)
            except PermissionError:
                pass

        os.unlink = tolerant_unlink
        try:
            return original_inject(vm)
        finally:
            os.unlink = original_unlink

    loader._inject_message_to_fd0 = patched_inject
    yield
    loader._inject_message_to_fd0 = original_inject
