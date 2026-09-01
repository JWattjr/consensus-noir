import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_TOP_UP_WEI,
  FEE_HEADROOM_WEI,
  needsTopUp,
  readBalance,
  requestTestFunds,
} from "@/lib/faucet";

/**
 * The faucet is the first thing a new player touches, and it is the only place
 * in the product that asks the simulator to mint. It must never report success
 * it has not read back from the chain.
 */

const ENTRY = BigInt(10) ** BigInt(16); // 0.01 GEN

function jsonResponse(body: unknown, init: { status?: number } = {}) {
  return {
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    headers: new Headers(),
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("top-up eligibility", () => {
  it("asks for funds when the balance cannot cover entry plus fees", () => {
    expect(needsTopUp(BigInt(0), ENTRY)).toBe(true);
    expect(needsTopUp(ENTRY, ENTRY)).toBe(true);
  });

  it("leaves a funded wallet alone", () => {
    expect(needsTopUp(ENTRY + FEE_HEADROOM_WEI, ENTRY)).toBe(false);
    expect(needsTopUp(DEFAULT_TOP_UP_WEI, ENTRY)).toBe(false);
  });

  it("stays silent rather than nagging when the balance is unknown", () => {
    // A failed read must not be rendered as "you are broke".
    expect(needsTopUp(null, ENTRY)).toBe(false);
  });
});

describe("reading a balance", () => {
  it("parses the hex quantity the node returns", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ result: "0x2386f26fc10000" })),
    );
    expect(await readBalance("0xabc")).toBe(BigInt("0x2386f26fc10000"));
  });

  it("reports unknown instead of zero when the endpoint fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    // Zero would wrongly trigger the top-up banner on a healthy wallet.
    expect(await readBalance("0xabc")).toBeNull();
  });
});

describe("requesting funds", () => {
  it("reports the balance the chain confirms, not the amount requested", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      if (body.method === "sim_fundAccount") return jsonResponse({ result: null });
      return jsonResponse({ result: "0x1" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestTestFunds("0xabc");
    expect(result.ok).toBe(true);
    // One wei, not the five GEN that was asked for.
    expect(result.balance).toBe(BigInt(1));
  });

  it("does not claim success when the faucet rejects the call", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error: { message: "account already funded" } }),
      ),
    );

    const result = await requestTestFunds("0xabc");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/already funded/i);
  });

  it("names rate limiting rather than reporting a generic failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, { status: 429 })));

    const result = await requestTestFunds("0xabc");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/rate limit/i);
  });
});
