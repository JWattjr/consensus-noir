import { webcrypto } from "node:crypto";

import { configure } from "@testing-library/dom";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

// jsdom does not ship Web Crypto; the commitment and salt code requires a real
// CSPRNG and SHA-256, so the Node implementation is installed once here.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}

// The default 1s async budget is tight for the heaviest suites, which render
// the whole app and settle several rounds of state. The real cause of the
// intermittent failures was worker thrashing, fixed by capping the pool in
// vitest.config.mts; this is headroom, not a workaround. A wait ends as soon
// as its element appears, so it costs passing runs nothing.
configure({ asyncUtilTimeout: 5000 });

if (!("clipboard" in navigator)) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
}

if (!globalThis.URL.createObjectURL) {
  globalThis.URL.createObjectURL = vi.fn(() => "blob:reality-bridge");
  globalThis.URL.revokeObjectURL = vi.fn();
}

// No test may touch the network. The app reads a wallet balance from the
// StudioNet RPC as soon as a wallet is connected, so without this the suite
// makes real requests to a shared simulator — slow, flaky under parallel
// load, and dependent on someone else's uptime. Tests that exercise a
// request stub `fetch` themselves; this default catches everything else.
beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      throw new Error(
        `Unexpected network request in a test: ${String(input)}. ` +
          "Stub fetch in the test that needs it.",
      );
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
