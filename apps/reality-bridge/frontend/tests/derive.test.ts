import { describe, expect, it } from "vitest";

import {
  actionById,
  deriveState,
  filterRounds,
  preferredRound,
  sortRounds,
} from "@/lib/derive";
import {
  ALICE,
  BOB,
  CAROL,
  CONFIG,
  NOW,
  player,
  players,
  round,
  tile,
  tiles,
} from "./fixtures";

function derive(overrides: Partial<Parameters<typeof deriveState>[0]> = {}) {
  return deriveState({
    round: round(),
    tiles: tiles(),
    players: players(),
    config: CONFIG,
    account: ALICE,
    networkOk: true,
    nowSeconds: NOW,
    txPending: false,
    hasRecoveryBundle: true,
    commitmentReady: true,
    ...overrides,
  });
}

describe("action availability", () => {
  it("lets the active runner commit and blocks everyone else", () => {
    const runner = derive();
    expect(actionById(runner, "commit_choice").enabled).toBe(true);
    expect(runner.role).toBe("runner");

    const bystander = derive({ account: BOB });
    expect(actionById(bystander, "commit_choice").enabled).toBe(false);
    expect(actionById(bystander, "commit_choice").blockedReason).toMatch(
      /only the active runner/i,
    );
    expect(bystander.role).toBe("player");
  });

  it("blocks every write when the wallet is on the wrong network", () => {
    const state = derive({ networkOk: false });
    expect(state.role).toBe("wrong-network");
    for (const entry of state.actions) {
      expect(entry.enabled).toBe(false);
      expect(entry.blockedReason).toMatch(/StudioNet/);
    }
    expect(state.headline).toMatch(/wrong network/i);
  });

  it("blocks every write while a transaction from this session is pending", () => {
    const state = derive({ txPending: true });
    expect(
      state.actions.every((entry) => entry.blockedReason !== null),
    ).toBe(true);
    expect(actionById(state, "commit_choice").blockedReason).toMatch(/pending/i);
  });

  it("keeps commit disabled until the recovery bundle is acknowledged", () => {
    const ready = derive({ commitmentReady: true });
    expect(actionById(ready, "commit_choice").enabled).toBe(true);

    const notReady = derive({ commitmentReady: false });
    expect(actionById(notReady, "commit_choice").enabled).toBe(false);
    expect(actionById(notReady, "commit_choice").blockedReason).toMatch(
      /save the recovery bundle and confirm it/i,
    );
  });

  it("requires a recovery bundle before the reveal button unlocks", () => {
    const committed = [
      player(0, ALICE, { committed: true, commitment: "a".repeat(64) }),
      player(1, BOB),
      player(2, CAROL),
    ];
    const withBundle = derive({ players: committed, hasRecoveryBundle: true });
    expect(actionById(withBundle, "reveal_choice").enabled).toBe(true);

    const withoutBundle = derive({
      players: committed,
      hasRecoveryBundle: false,
    });
    expect(actionById(withoutBundle, "reveal_choice").enabled).toBe(false);
    expect(actionById(withoutBundle, "reveal_choice").blockedReason).toMatch(
      /recovery bundle/i,
    );
  });

  it("opens the missed-commit forfeit to anyone once the window lapses", () => {
    const before = derive({ account: BOB, nowSeconds: NOW + 300 });
    expect(actionById(before, "forfeit_missed_commit").enabled).toBe(false);

    const after = derive({ account: BOB, nowSeconds: NOW + 301 });
    const forfeit = actionById(after, "forfeit_missed_commit");
    expect(forfeit.enabled).toBe(true);
    expect(forfeit.permissionless).toBe(true);
  });

  it("opens the missed-reveal forfeit only after the grace period", () => {
    const committed = [
      player(0, ALICE, { committed: true, commitment: "b".repeat(64) }),
      player(1, BOB),
      player(2, CAROL),
    ];
    const during = derive({
      account: BOB,
      players: committed,
      nowSeconds: NOW + 360,
    });
    expect(actionById(during, "forfeit_missed_reveal").enabled).toBe(false);

    const after = derive({
      account: BOB,
      players: committed,
      nowSeconds: NOW + 361,
    });
    expect(actionById(after, "forfeit_missed_reveal").enabled).toBe(true);
    // The missed-commit path is hidden once a commitment exists.
    expect(actionById(after, "forfeit_missed_commit").hidden).toBe(true);
  });

  it("gates resolution on the reveal and the evidence timestamp", () => {
    const revealed = [
      player(0, ALICE, { committed: true, revealed: true, choice: "YES" }),
      player(1, BOB),
      player(2, CAROL),
    ];
    const early = derive({ players: revealed, nowSeconds: NOW + 1859 });
    expect(actionById(early, "resolve_tile").enabled).toBe(false);
    expect(actionById(early, "resolve_tile").blockedReason).toMatch(
      /evidence timestamp/i,
    );

    const ready = derive({ players: revealed, nowSeconds: NOW + 1860 });
    expect(actionById(ready, "resolve_tile").enabled).toBe(true);
  });

  it("only offers expiry after the terminal deadline", () => {
    const before = derive({ nowSeconds: NOW + 7200 });
    expect(actionById(before, "expire_round").enabled).toBe(false);
    const after = derive({ nowSeconds: NOW + 7201 });
    expect(actionById(after, "expire_round").enabled).toBe(true);
  });
});
describe("join gating", () => {
  const openRound = round({ status: "OPEN", player_count: 1 });

  it("hides the join action outside the OPEN state", () => {
    expect(actionById(derive(), "join_round").hidden).toBe(true);
  });

  it("refuses a second seat for the same wallet", () => {
    const state = deriveState({
      round: openRound,
      tiles: tiles(),
      players: [player(0, ALICE)],
      config: CONFIG,
      account: ALICE,
      networkOk: true,
      nowSeconds: NOW,
      txPending: false,
      hasRecoveryBundle: false,
      commitmentReady: false,
    });
    expect(actionById(state, "join_round").blockedReason).toMatch(
      /already hold a seat/i,
    );
  });

  it("refuses a join after the deadline and allows a permissionless start", () => {
    const state = deriveState({
      round: openRound,
      tiles: tiles(),
      players: [player(0, ALICE)],
      config: CONFIG,
      account: BOB,
      networkOk: true,
      nowSeconds: NOW + 600,
      txPending: false,
      hasRecoveryBundle: false,
      commitmentReady: false,
    });
    expect(actionById(state, "join_round").blockedReason).toMatch(
      /join window has closed/i,
    );
    expect(actionById(state, "start_round").enabled).toBe(true);
  });

  it("refuses a join when every seat is taken", () => {
    const full = round({ status: "OPEN", player_count: 8 });
    const state = deriveState({
      round: full,
      tiles: tiles(),
      players: [],
      config: CONFIG,
      account: BOB,
      networkOk: true,
      nowSeconds: NOW,
      txPending: false,
      hasRecoveryBundle: false,
      commitmentReady: false,
    });
    expect(actionById(state, "join_round").blockedReason).toMatch(
      /every seat is taken/i,
    );
  });
});

describe("claim and refund eligibility", () => {
  const settled = round({ status: "SETTLED" });

  function settledState(account: string, list = [
    player(0, ALICE, { claim_amount: "2500000000000000000", discovery_credits: 3 }),
    player(1, BOB, { claim_amount: "250000000000000000" }),
    player(2, CAROL, { status: "ELIMINATED" }),
  ]) {
    return deriveState({
      round: settled,
      tiles: tiles(),
      players: list,
      config: CONFIG,
      account,
      networkOk: true,
      nowSeconds: NOW + 4000,
      txPending: false,
      hasRecoveryBundle: false,
      commitmentReady: false,
    });
  }

  it("enables the claim only for a wallet with a payout", () => {
    expect(actionById(settledState(ALICE), "claim").enabled).toBe(true);
    expect(actionById(settledState(CAROL), "claim").blockedReason).toMatch(
      /no payout/i,
    );
  });

  it("does not offer a claim to a visitor who never joined", () => {
    const visitor = settledState("0xdddddddddddddddddddddddddddddddddddddddd");
    expect(actionById(visitor, "claim").enabled).toBe(false);
    expect(actionById(visitor, "claim").blockedReason).toMatch(/did not join/i);
    expect(visitor.role).toBe("spectator");
  });

  it("reports an already-collected payout instead of offering it again", () => {
    const state = settledState(ALICE, [
      player(0, ALICE, { claim_amount: "2500000000000000000", claimed: true }),
      player(1, BOB),
      player(2, CAROL),
    ]);
    expect(actionById(state, "claim").blockedReason).toMatch(
      /already collected/i,
    );
    expect(state.headline).toMatch(/already collected/i);
  });

  it("offers refunds to every joined seat, including eliminated ones", () => {
    const refundable = round({ status: "REFUNDABLE" });
    const state = deriveState({
      round: refundable,
      tiles: tiles(),
      players: [
        player(0, ALICE, { status: "ELIMINATED", refund_amount: "1000000000000000000" }),
        player(1, BOB, { refund_amount: "1000000000000000000" }),
      ],
      config: CONFIG,
      account: ALICE,
      networkOk: true,
      nowSeconds: NOW + 8000,
      txPending: false,
      hasRecoveryBundle: false,
      commitmentReady: false,
    });
    expect(actionById(state, "refund").enabled).toBe(true);
    expect(actionById(state, "claim").hidden).toBe(true);
  });
});

describe("lobby ordering and filters", () => {
  const list = [
    round({ round_id: "1", status: "SETTLED" }),
    round({ round_id: "2", status: "OPEN", join_deadline: NOW + 900 }),
    round({ round_id: "3", status: "ACTIVE" }),
    round({ round_id: "4", status: "OPEN", join_deadline: NOW + 300 }),
    round({ round_id: "5", status: "CANCELLED" }),
  ];

  it("puts live rounds first rather than trusting the published order", () => {
    expect(sortRounds(list).map((entry) => entry.round_id)).toEqual([
      "3",
      "4",
      "2",
      "1",
      "5",
    ]);
  });

  it("filters by lifecycle and by the wallet's own rounds", () => {
    expect(
      filterRounds(list, "open", new Set()).map((entry) => entry.round_id),
    ).toEqual(["4", "2"]);
    expect(
      filterRounds(list, "refundable", new Set()).map((entry) => entry.round_id),
    ).toEqual(["5"]);
    expect(
      filterRounds(list, "mine", new Set(["3"])).map((entry) => entry.round_id),
    ).toEqual(["3"]);
  });
});

describe("headlines", () => {
  it("tells a runner exactly what to do next", () => {
    expect(derive().headline).toMatch(/commit your sealed choice/i);
    const committed = derive({
      players: [player(0, ALICE, { committed: true }), player(1, BOB), player(2, CAROL)],
    });
    expect(committed.headline).toMatch(/reveal your choice/i);
  });

  it("describes an unresolved evidence panel without claiming success", () => {
    const state = deriveState({
      round: round({ current_tile_index: 1 }),
      tiles: [
        tile(0, { status: "RESOLVED", outcome: "VOID", reason_code: "VOID_LIVENESS" }),
        tile(1),
        tile(2),
      ],
      players: players(),
      config: CONFIG,
      account: CAROL,
      networkOk: true,
      nowSeconds: NOW,
      txPending: false,
      hasRecoveryBundle: false,
      commitmentReady: false,
    });
    expect(state.currentTile?.tile_index).toBe(1);
    expect(state.headline).toMatch(/crossing is live/i);
  });

  it("defaults to a joinable or proven round instead of an expired empty one", () => {
    const expiredEmpty = round({
      round_id: "1",
      status: "OPEN",
      player_count: 0,
      join_deadline: NOW - 1,
    });
    const settledProof = round({ round_id: "2", status: "SETTLED" });
    const joinable = round({
      round_id: "3",
      status: "OPEN",
      join_deadline: NOW + 600,
    });

    expect(preferredRound([expiredEmpty, settledProof], "", NOW)?.round_id).toBe(
      "2",
    );
    expect(
      preferredRound([expiredEmpty, settledProof, joinable], "", NOW)?.round_id,
    ).toBe("3");
    expect(
      preferredRound([expiredEmpty, settledProof, joinable], "2", NOW)?.round_id,
    ).toBe("2");
  });
});
