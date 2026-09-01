import { NATIVE_SYMBOL, NETWORK_LABEL, RPC_ENDPOINT } from "@/lib/network";

/**
 * StudioNet test-GEN top-up.
 *
 * StudioNet is a hosted simulator with no faucet page — it exposes
 * `sim_fundAccount` over JSON-RPC and nothing else. Without this, a new player
 * has to run a `curl` command from the docs before they can join anything,
 * which is the single hardest step in the funnel.
 *
 * This only ever mints **test** GEN on a simulator. It has no real-world value
 * and there is no equivalent on any network carrying value.
 */

/** Enough for several entries plus consensus fees. */
export const DEFAULT_TOP_UP_WEI = BigInt(5) * BigInt(10) ** BigInt(18);

/** Headroom kept above the entry so a join is not left unable to pay fees. */
export const FEE_HEADROOM_WEI = BigInt(10) ** BigInt(17); // 0.1 GEN

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(RPC_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });

  if (!response.ok) {
    // The simulator rate-limits; say so rather than reporting a generic failure.
    if (response.status === 429) {
      const retry = response.headers.get("Retry-After");
      throw new Error(
        retry
          ? `${NETWORK_LABEL} is rate limiting top-ups. Try again in ${retry}s.`
          : `${NETWORK_LABEL} is rate limiting top-ups. Try again shortly.`,
      );
    }
    throw new Error(`${NETWORK_LABEL} returned HTTP ${response.status}.`);
  }

  const payload: unknown = await response.json();
  const record =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};

  const error = record.error;
  if (error) {
    const message =
      error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message)
        : String(error);
    throw new Error(message);
  }
  return record.result;
}

/** Native balance in wei, or null when the endpoint cannot be read. */
export async function readBalance(address: string): Promise<bigint | null> {
  try {
    const result = await rpc("eth_getBalance", [address, "latest"]);
    if (typeof result !== "string") return null;
    return BigInt(result);
  } catch {
    return null;
  }
}

/**
 * Ask the simulator to top the account up, then read the balance back.
 *
 * The returned balance is what the chain reports afterwards, not what was
 * requested — the faucet is not assumed to have worked.
 */
export async function requestTestFunds(
  address: string,
  amountWei: bigint = DEFAULT_TOP_UP_WEI,
): Promise<{ ok: boolean; balance: bigint | null; message: string }> {
  try {
    await rpc("sim_fundAccount", [address, Number(amountWei)]);
  } catch (error) {
    return {
      ok: false,
      balance: await readBalance(address),
      message:
        error instanceof Error
          ? error.message
          : `Could not reach the ${NETWORK_LABEL} faucet.`,
    };
  }

  const balance = await readBalance(address);
  return {
    ok: true,
    balance,
    message: `Topped up with test ${NATIVE_SYMBOL} on ${NETWORK_LABEL}.`,
  };
}

/** True when this balance cannot cover the entry plus fee headroom. */
export function needsTopUp(
  balance: bigint | null,
  entryWei: bigint,
): boolean {
  if (balance === null) return false;
  return balance < entryWei + FEE_HEADROOM_WEI;
}
