import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ALICE, BOB, CONFIG, CONTRACT, NOW, player, round, tile } from "./fixtures";

/**
 * Component-level checks for the behaviour that must never regress:
 * live/simulation separation, network and wallet gating, honest transaction
 * reporting, and the empty / loading / error surfaces.
 */

const reads = vi.hoisted(() => ({
  readConfig: vi.fn(),
  readRoundIds: vi.fn(),
  readRoundSummaries: vi.fn(),
  readRoundBundle: vi.fn(),
  submitWrite: vi.fn(),
  watchTransaction: vi.fn(),
}));

vi.mock("@/lib/contract", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/contract")>("@/lib/contract");
  return {
    ...actual,
    CONTRACT_ADDRESS: "0x1111111111111111111111111111111111111111",
    IS_CONFIGURED: true,
    PINNED_ROUND_ID: "",
    readConfig: reads.readConfig,
    readRoundIds: reads.readRoundIds,
    readRoundSummaries: reads.readRoundSummaries,
    readRoundBundle: reads.readRoundBundle,
    submitWrite: reads.submitWrite,
    watchTransaction: reads.watchTransaction,
  };
});

const STUDIONET_CHAIN_ID = 61999;

function installWallet(options: { account?: string; chainId?: number } = {}) {
  const provider = {
    request: vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_accounts" || method === "eth_requestAccounts") {
        return options.account ? [options.account] : [];
      }
      if (method === "eth_chainId") {
        return `0x${(options.chainId ?? STUDIONET_CHAIN_ID).toString(16)}`;
      }
      return null;
    }),
    on: vi.fn(),
    removeListener: vi.fn(),
  };
  Object.defineProperty(window, "ethereum", {
    value: provider,
    configurable: true,
    writable: true,
  });
  return provider;
}

function liveRound() {
  return {
    round: round({ status: "ACTIVE", current_tile_index: 0 }),
    tiles: [tile(0), tile(1), tile(2)],
    players: [player(0, ALICE), player(1, BOB)],
  };
}

function rpcResponse(result: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({ result }),
  } as unknown as Response;
}

async function renderApp() {
  const { default: RealityBridgeApp } = await import(
    "@/components/RealityBridgeApp"
  );
  return render(<RealityBridgeApp />);
}

beforeEach(() => {
  vi.useRealTimers();
  reads.readConfig.mockResolvedValue(CONFIG);
  reads.readRoundIds.mockResolvedValue(["1"]);
  reads.readRoundSummaries.mockResolvedValue([liveRound().round]);
  reads.readRoundBundle.mockResolvedValue(liveRound());
  reads.watchTransaction.mockResolvedValue({
    phase: "accepted",
    action: "join_round",
    hash: "0xabc",
    statusName: "ACCEPTED",
    message: null,
    startedAt: 0,
    updatedAt: 0,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "ethereum");
});

describe("live StudioNet surface", () => {
  it("names StudioNet as the only network and no other", async () => {
    installWallet({ account: ALICE });
    await renderApp();

    await waitFor(() =>
      expect(screen.getAllByText("The Weather Line").length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText(/GenLayer StudioNet/i).length).toBeGreaterThan(0);

    // Any GenLayer network other than StudioNet is a defect. Assert on the
    // chain id itself rather than naming a specific obsolete network, so the
    // check keeps working as the SDK's chain list changes.
    const text = document.body.textContent ?? "";
    const chainIds = [...text.matchAll(/chain (\d+)/gi)].map((match) => match[1]);
    expect(chainIds.length).toBeGreaterThan(0);
    expect(new Set(chainIds)).toEqual(new Set(["61999"]));

    // Derive the forbidden set from the SDK's own chain list rather than
    // naming networks here: the assertion then keeps working as that list
    // changes, and spelling the names out would defeat the repository-wide
    // hygiene check that forbids them.
    const chains = await import("genlayer-js/chains");
    const others = Object.values(chains)
      .map((chain) => ({ id: chain.id, name: chain.name }))
      .filter((chain) => chain.id !== 61999);

    expect(others.length).toBeGreaterThan(0);
    for (const chain of others) {
      expect(text).not.toContain(chain.name);
      expect(text).not.toContain(String(chain.id));
    }
  });

  it("shows the live badge and the round lobby once state loads", async () => {
    installWallet({ account: ALICE });
    await renderApp();

    await waitFor(() => expect(screen.getByText("LIVE STUDIONET")).toBeTruthy());
    expect(screen.getByRole("heading", { name: /published crossings/i })).toBeTruthy();
    expect(screen.queryByText("SIMULATION")).toBeNull();
  });

  it("offers a StudioNet test top-up to a connected wallet that cannot pay the entry", async () => {
    installWallet({ account: ALICE });
    const user = userEvent.setup();
    let funded = false;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      if (body.method === "sim_fundAccount") {
        funded = true;
        return rpcResponse(null);
      }
      return rpcResponse(funded ? "0x4563918244f40000" : "0x0");
    });
    vi.stubGlobal("fetch", fetchMock);

    await renderApp();

    const topUp = await screen.findByRole("button", { name: /get test gen/i });
    expect(screen.getByText(/will not cover the/i)).toBeTruthy();
    await user.click(topUp);

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([, init]) => {
          const body = JSON.parse(String((init as RequestInit | undefined)?.body));
          return body.method === "sim_fundAccount";
        }),
      ).toBe(true),
    );
    expect(await screen.findByText(/topped up with test gen/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /get test gen/i })).toBeNull();
  });

  it("blocks writes and explains why when the wallet is on another chain", async () => {
    installWallet({ account: ALICE, chainId: 1 });
    await renderApp();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/connected to chain 1/i);
    expect(alert.textContent).toMatch(/Every write is blocked/i);
    expect(
      screen.getByRole("button", { name: /switch to GenLayer StudioNet/i }),
    ).toBeTruthy();

    await waitFor(() =>
      expect(screen.getAllByText("The Weather Line").length).toBeGreaterThan(0),
    );
    const commit = screen.getByRole("button", { name: /commit sealed choice/i });
    expect(commit.hasAttribute("disabled")).toBe(true);
  });

  it("treats a wallet that never joined as a spectator", async () => {
    installWallet({ account: "0xdddddddddddddddddddddddddddddddddddddddd" });
    await renderApp();

    await waitFor(() =>
      expect(screen.getByText(/Spectator view/i)).toBeTruthy(),
    );
    const commit = screen.getByRole("button", { name: /commit sealed choice/i });
    expect(commit.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/Only the active runner may commit/i)).toBeTruthy();
  });

  it("reports a read failure instead of quietly showing fixtures", async () => {
    installWallet({ account: ALICE });
    reads.readConfig.mockRejectedValue(new Error("RPC unreachable"));
    reads.readRoundIds.mockRejectedValue(new Error("RPC unreachable"));
    await renderApp();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/StudioNet is not answering/i);
    expect(alert.textContent).toMatch(/RPC unreachable/);
    expect(alert.textContent).toMatch(/never substituted for live data/i);
    expect(screen.queryByText("The Weather Line")).toBeNull();
    // Entering the simulation stays an explicit choice.
    expect(
      screen.getByRole("button", { name: /open the simulation instead/i }),
    ).toBeTruthy();
  });

  it("shows an empty state rather than an imaginary round", async () => {
    installWallet({ account: ALICE });
    reads.readRoundIds.mockResolvedValue([]);
    reads.readRoundSummaries.mockResolvedValue([]);
    await renderApp();

    await waitFor(() =>
      expect(screen.getByText(/No rounds published yet/i)).toBeTruthy(),
    );
  });

  it("reconciles a transaction left pending by a previous session", async () => {
    installWallet({ account: ALICE });
    window.localStorage.setItem(
      "reality-bridge:pending-tx:v1",
      JSON.stringify([
        {
          hash: "0xdeadbeef",
          action: "commit_choice",
          roundId: "1",
          account: ALICE,
          startedAt: 1,
        },
      ]),
    );
    reads.watchTransaction.mockResolvedValue({
      phase: "accepted",
      action: "commit_choice",
      hash: "0xdeadbeef",
      statusName: "ACCEPTED",
      message: null,
      startedAt: 1,
      updatedAt: 2,
    });

    await renderApp();

    await waitFor(() =>
      expect(reads.watchTransaction).toHaveBeenCalledWith(
        "0xdeadbeef",
        "commit_choice",
        expect.anything(),
      ),
    );
    await waitFor(() =>
      expect(screen.getByText(/Reconciled a pending/i)).toBeTruthy(),
    );
    expect(window.localStorage.getItem("reality-bridge:pending-tx:v1")).toBe("[]");
  });
});

describe("simulation surface", () => {
  it("is only entered on purpose and is labelled as a simulation throughout", async () => {
    installWallet({ account: ALICE });
    const user = userEvent.setup();
    await renderApp();

    await waitFor(() => expect(screen.getByText("LIVE STUDIONET")).toBeTruthy());

    const launcher = screen
      .getByRole("heading", { name: /simulation scenarios/i })
      .closest("section") as HTMLElement;
    await user.click(
      within(launcher).getAllByRole("button", { name: /run simulation/i })[0],
    );

    await waitFor(() =>
      expect(screen.getByText(/You are in a simulation\./i)).toBeTruthy(),
    );
    expect(screen.getByText("SIMULATION")).toBeTruthy();
    expect(screen.getByText(/Simulation — no network/i)).toBeTruthy();

    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/on-chain/i);
    expect(text).not.toMatch(/validators agreed/i);
    expect(text).toMatch(/no transaction is sent/i);
    expect(text).toMatch(/Outcomes are fixed by the scenario before you choose/i);
  });

  it("never sends a transaction while simulating", async () => {
    installWallet({ account: ALICE });
    const user = userEvent.setup();
    await renderApp();

    await waitFor(() => expect(screen.getByText("LIVE STUDIONET")).toBeTruthy());
    const launcher = screen
      .getByRole("heading", { name: /simulation scenarios/i })
      .closest("section") as HTMLElement;
    await user.click(
      within(launcher).getAllByRole("button", { name: /run simulation/i })[0],
    );

    await waitFor(() =>
      expect(screen.getByRole("radio", { name: /YES/i })).toBeTruthy(),
    );
    await user.click(screen.getByRole("radio", { name: /YES/i }));
    await waitFor(() =>
      expect(screen.getByLabelText(/recovery bundle contents/i)).toBeTruthy(),
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: /I have saved this recovery bundle/i,
      }),
    );
    await user.click(
      screen.getByRole("button", { name: /seal simulated choice/i }),
    );

    expect(reads.submitWrite).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByText(/Sealed a simulated YES choice/i)).toBeTruthy(),
    );
  });
});

describe("commit custody", () => {
  it("will not sign a commitment until the recovery bundle is acknowledged", async () => {
    installWallet({ account: ALICE });
    const user = userEvent.setup();
    await renderApp();

    await waitFor(() =>
      expect(screen.getByRole("radio", { name: /YES/i })).toBeTruthy(),
    );
    await user.click(screen.getByRole("radio", { name: /YES/i }));

    await waitFor(() =>
      expect(screen.getByText(/Losing it means you cannot reveal/i)).toBeTruthy(),
    );

    // The control is disabled, not merely inert: an enabled button the player
    // cannot actually use would be a misleading affordance.
    const commit = screen.getByRole("button", { name: /commit sealed choice/i });
    expect(commit.hasAttribute("disabled")).toBe(true);
    expect(
      screen.getByText(/save the recovery bundle and confirm it/i),
    ).toBeTruthy();

    await user.click(commit);
    expect(reads.submitWrite).not.toHaveBeenCalled();

    // Acknowledging the export is what unlocks it.
    await user.click(
      screen.getByRole("checkbox", {
        name: /I have saved this recovery bundle/i,
      }),
    );
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: /commit sealed choice/i })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
  });

  it("exports a bundle that names StudioNet, the contract, the round and the panel", async () => {
    installWallet({ account: ALICE });
    const user = userEvent.setup();
    await renderApp();

    await waitFor(() =>
      expect(screen.getByRole("radio", { name: /NO/i })).toBeTruthy(),
    );
    await user.click(screen.getByRole("radio", { name: /NO/i }));

    const textarea = (await screen.findByLabelText(
      /recovery bundle contents/i,
    )) as HTMLTextAreaElement;
    const bundle = JSON.parse(textarea.value);
    expect(bundle).toMatchObject({
      version: 1,
      network: "studionet",
      chainId: 61999,
      contract: CONTRACT.toLowerCase(),
      roundId: "1",
      tileIndex: 0,
      account: ALICE.toLowerCase(),
      choice: "NO",
    });
    expect(bundle.salt).toMatch(/^[0-9a-f]{64}$/);
    expect(bundle.commitment).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("transaction reporting", () => {
  it("shows the chain-reported failure instead of a success message", async () => {
    installWallet({ account: ALICE });
    reads.readRoundBundle.mockResolvedValue({
      round: round({ status: "SETTLED" }),
      tiles: [tile(0, { status: "RESOLVED", outcome: "YES", reason_code: "FINAL_EVIDENCE" })],
      players: [
        player(0, ALICE, { claim_amount: "2000000000000000000" }),
        player(1, BOB),
      ],
    });
    reads.readRoundSummaries.mockResolvedValue([round({ status: "SETTLED" })]);
    reads.submitWrite.mockImplementation(async (_request, options) => {
      const failed = {
        phase: "failed" as const,
        action: "claim",
        hash: "0xfeed",
        statusName: "ACCEPTED",
        message: "Claim already collected",
        startedAt: NOW,
        updatedAt: NOW,
      };
      options?.onUpdate?.(failed);
      return failed;
    });

    const user = userEvent.setup();
    await renderApp();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /claim payout/i })).toBeTruthy(),
    );
    await user.click(screen.getByRole("button", { name: /claim payout/i }));

    await waitFor(() =>
      expect(screen.getAllByText(/Claim already collected/i).length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText(/Failed on chain/i).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/Claim complete/i);
  });
});
