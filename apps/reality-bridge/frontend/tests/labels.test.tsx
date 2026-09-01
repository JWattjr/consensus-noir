import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { PlayerView, RoundStatus } from "@/lib/contract";
import RoundLobby from "@/components/RoundLobby";
import { BridgeBoard, PlayerRail } from "@/components/RoundBoard";
import { ALICE, BOB, NOW, player, round, tile } from "./fixtures";

/**
 * A finished round must not read as though it were still running, and a
 * lapsed deadline must not render as a broken countdown.
 */

function lobby(rounds: Parameters<typeof RoundLobby>[0]["rounds"], now = NOW) {
  return render(
    <RoundLobby
      rounds={rounds}
      filter="all"
      onFilter={() => undefined}
      selectedRoundId={null}
      onSelect={() => undefined}
      joinedRoundIds={new Set()}
      actionableRoundIds={new Set()}
      now={now}
    />,
  );
}

describe("lobby deadline labels", () => {
  it("counts down while the join window is genuinely open", () => {
    lobby([round({ status: "OPEN", join_deadline: NOW + 600 })]);
    expect(screen.getByText(/joins close in/i)).toBeTruthy();
    expect(screen.queryByText(/elapsed/i)).toBeNull();
  });

  it("says a lapsed OPEN round is startable instead of 'closes in elapsed'", () => {
    lobby([round({ status: "OPEN", join_deadline: NOW - 1 })]);
    expect(screen.getByText(/join window closed/i)).toBeTruthy();
    expect(screen.queryByText(/joins close in/i)).toBeNull();
    expect(screen.queryByText(/elapsed/i)).toBeNull();
  });

  it("marks a lapsed empty round as history instead of offering a dead action", () => {
    lobby([
      round({ status: "OPEN", join_deadline: NOW - 1, player_count: 0 }),
    ]);
    expect(screen.getByText(/no seats.*historical round/i)).toBeTruthy();
  });

  it("says a lapsed ACTIVE round is expirable instead of counting down", () => {
    lobby([round({ status: "ACTIVE", terminal_deadline: NOW - 1 })]);
    expect(screen.getByText(/terminal deadline passed/i)).toBeTruthy();
    expect(screen.queryByText(/elapsed/i)).toBeNull();
  });
});

describe("seat labels", () => {
  function rail(status: RoundStatus, players: PlayerView[]) {
    return render(
      <PlayerRail
        round={round({ status, active_player_index: 0 })}
        players={players}
        account=""
      />,
    );
  }

  it("marks the runner and the waiting seat while a round is live", () => {
    rail("ACTIVE", [player(0, ALICE), player(1, BOB)]);
    expect(screen.getByText("CROSSING")).toBeTruthy();
    expect(screen.getByText("WAITING")).toBeTruthy();
  });

  it("does not leave settled seats reading as 'WAITING'", () => {
    rail("SETTLED", [
      player(0, ALICE, { claim_amount: "1000", discovery_credits: 1 }),
      player(1, BOB, { claim_amount: "500", claimed: true }),
      player(2, "0xcccccccccccccccccccccccccccccccccccccccc", {
        status: "ELIMINATED",
      }),
    ]);
    expect(screen.queryByText("WAITING")).toBeNull();
    expect(screen.queryByText("CROSSING")).toBeNull();
    expect(screen.getByText("CAN CLAIM")).toBeTruthy();
    expect(screen.getByText("PAID")).toBeTruthy();
    expect(screen.getByText("OUT")).toBeTruthy();
  });

  it("distinguishes a survivor with no payout from one who can claim", () => {
    rail("SETTLED", [
      player(0, ALICE, { claim_amount: "0" }),
      player(1, BOB, { claim_amount: "500" }),
    ]);
    expect(screen.getByText("NO PAYOUT")).toBeTruthy();
    expect(screen.getByText("CAN CLAIM")).toBeTruthy();
  });

  it("shows refund state on an unwound round", () => {
    rail("REFUNDABLE", [
      player(0, ALICE, { refund_amount: "1000" }),
      player(1, BOB, { refund_amount: "1000", refunded: true }),
    ]);
    expect(screen.getByText("CAN REFUND")).toBeTruthy();
    expect(screen.getByText("REFUNDED")).toBeTruthy();
    expect(screen.queryByText("WAITING")).toBeNull();
  });

  it("says seated, not waiting, before a round starts", () => {
    rail("OPEN", [player(0, ALICE), player(1, BOB)]);
    expect(screen.getAllByText("SEATED")).toHaveLength(2);
    expect(screen.queryByText("CROSSING")).toBeNull();
  });

  it("labels a finished round by its survivors, not an active crossing", () => {
    rail("SETTLED", [
      player(0, ALICE, { claim_amount: "1000", claimed: true }),
      player(1, BOB, { claim_amount: "500", claimed: true }),
    ]);
    expect(screen.getByText("2 survivors")).toBeTruthy();
    expect(screen.queryByText(/still crossing/i)).toBeNull();
  });
});

describe("historical and settled presentation", () => {
  it("keeps historical crossings collapsed until requested", async () => {
    const user = userEvent.setup();
    lobby([
      round({ round_id: "1", status: "SETTLED" }),
      round({
        round_id: "2",
        status: "OPEN",
        player_count: 0,
        join_deadline: NOW - 1,
      }),
    ]);
    expect(screen.getByText(/show 1 past crossing/i)).toBeTruthy();
    expect(screen.queryByText(/no seats.*historical round/i)).toBeNull();

    await user.click(screen.getByRole("button", { name: /show 1 past crossing/i }));
    expect(screen.getByText(/no seats.*historical round/i)).toBeTruthy();
  });

  it("does not describe a fully resolved board as having a current panel", () => {
    render(
      <BridgeBoard
        round={round({ status: "SETTLED", tile_count: 1 })}
        tiles={[tile(0, { status: "RESOLVED", outcome: "YES" })]}
      />,
    );
    expect(screen.queryByText("Current panel")).toBeNull();
    expect(screen.queryByText("Evidence not yet due")).toBeNull();
    expect(screen.getByText(/settled by validator consensus/i)).toBeTruthy();
  });
});
