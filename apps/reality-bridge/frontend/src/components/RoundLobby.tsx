"use client";

import { ChevronRight, Users } from "lucide-react";
import { useMemo, useState } from "react";

import type { RoundView } from "@/lib/contract";
import type { LobbyFilter } from "@/lib/derive";
import { formatAmount, formatCountdown } from "@/lib/format";
import { EmptyState, StatusPill } from "@/components/ui";

const FILTERS: { id: LobbyFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "active", label: "Active" },
  { id: "upcoming", label: "Upcoming" },
  { id: "settled", label: "Settled" },
  { id: "refundable", label: "Refundable" },
  { id: "mine", label: "My rounds" },
];

const STATUS_TONE: Record<
  RoundView["status"],
  "neutral" | "good" | "warn" | "bad" | "busy"
> = {
  DRAFT: "neutral",
  OPEN: "good",
  ACTIVE: "busy",
  SETTLED: "good",
  REFUNDABLE: "warn",
  CANCELLED: "bad",
};

export function deadlineLabel(round: RoundView, now: number): string {
  if (round.status === "OPEN") {
    // An OPEN round whose join window has already lapsed is not joinable; it
    // is waiting for someone to start it. "Joins close in elapsed" read as a
    // glitch rather than as a state.
    if (now >= round.join_deadline) {
      return round.player_count === 0
        ? "No seats — historical round"
        : "Join window closed — anyone can start it";
    }
    return `Joins close in ${formatCountdown(round.join_deadline, now)}`;
  }
  if (round.status === "ACTIVE") {
    if (now >= round.terminal_deadline) {
      return "Terminal deadline passed — anyone can expire it";
    }
    return `Terminal deadline in ${formatCountdown(round.terminal_deadline, now)}`;
  }
  if (round.status === "SETTLED") {
    return round.player_count === 0
      ? "Historical round — no payouts"
      : "Payouts finalized";
  }
  if (round.status === "REFUNDABLE") {
    return round.player_count === 0
      ? "Historical round — no refunds"
      : "Refunds available";
  }
  if (round.status === "CANCELLED") return "Cancelled before start";
  return "Not open yet";
}

export default function RoundLobby({
  rounds,
  filter,
  onFilter,
  selectedRoundId,
  onSelect,
  joinedRoundIds,
  actionableRoundIds,
  now,
}: {
  rounds: RoundView[];
  filter: LobbyFilter;
  onFilter: (value: LobbyFilter) => void;
  selectedRoundId: string | null;
  onSelect: (roundId: string) => void;
  joinedRoundIds: ReadonlySet<string>;
  actionableRoundIds: ReadonlySet<string>;
  now: number;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const { featuredRounds, historicalRounds } = useMemo(() => {
    if (filter !== "all") {
      return { featuredRounds: rounds, historicalRounds: [] as RoundView[] };
    }

    const featuredIds = new Set<string>();
    if (
      selectedRoundId &&
      rounds.some((round) => round.round_id === selectedRoundId)
    ) {
      featuredIds.add(selectedRoundId);
    }
    for (const round of rounds) {
      if (
        round.status === "ACTIVE" ||
        round.status === "DRAFT" ||
        // A lapsed OPEN round that holds seats is not history: the join
        // window has closed but anyone can still start it. Filing it under
        // past crossings hides a live, permissionless action.
        (round.status === "OPEN" &&
          (now < round.join_deadline || round.player_count > 0)) ||
        // Never collapse a round this wallet is committed to or can act on.
        // Those carry a seat or an unclaimed payout, and a collapsed toggle
        // is the wrong place to discover either.
        joinedRoundIds.has(round.round_id) ||
        actionableRoundIds.has(round.round_id)
      ) {
        featuredIds.add(round.round_id);
      }
    }

    let featured = rounds.filter((round) => featuredIds.has(round.round_id));
    if (featured.length === 0) {
      const proofRound = rounds.find((round) => round.status === "SETTLED");
      if (proofRound) featured = [proofRound];
    }
    // With nothing to feature, show what there is rather than an empty lobby
    // whose only control is "show past crossings".
    if (featured.length === 0) featured = rounds;
    const ids = new Set(featured.map((round) => round.round_id));
    return {
      featuredRounds: featured,
      historicalRounds: rounds.filter((round) => !ids.has(round.round_id)),
    };
  }, [
    actionableRoundIds,
    filter,
    joinedRoundIds,
    now,
    rounds,
    selectedRoundId,
  ]);
  const displayedRounds = showHistory ? rounds : featuredRounds;
  const countLabel =
    filter === "all" && historicalRounds.length > 0 && !showHistory
      ? `${featuredRounds.length} current · ${historicalRounds.length} past`
      : `${displayedRounds.length} shown`;

  return (
    <section className="panel lobby-panel" aria-labelledby="lobby-heading">
      <div className="panel-heading">
        <div>
          <span className="panel-kicker">ROUND LOBBY</span>
          <h3 id="lobby-heading">Published crossings</h3>
        </div>
        <span className="count-badge">{countLabel}</span>
      </div>

      <div className="lobby-filters" role="group" aria-label="Filter rounds">
        {FILTERS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={filter === entry.id ? "filter-chip active" : "filter-chip"}
            aria-pressed={filter === entry.id}
            onClick={() => onFilter(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {rounds.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          body="No published round matches this filter. Try another filter, or refresh to pull the latest StudioNet state."
        />
      ) : (
        <ul className="lobby-list">
          {displayedRounds.map((round) => {
            const selected = round.round_id === selectedRoundId;
            return (
              <li key={round.round_id}>
                <button
                  type="button"
                  className={selected ? "lobby-row selected" : "lobby-row"}
                  aria-current={selected ? "true" : undefined}
                  onClick={() => onSelect(round.round_id)}
                >
                  <span className="lobby-row-main">
                    <span className="lobby-row-title">
                      <strong>{round.title}</strong>
                      <StatusPill tone={STATUS_TONE[round.status]}>
                        {round.status}
                      </StatusPill>
                      {joinedRoundIds.has(round.round_id) && (
                        <StatusPill tone="neutral">Joined</StatusPill>
                      )}
                      {actionableRoundIds.has(round.round_id) && (
                        <StatusPill tone="warn">Action for you</StatusPill>
                      )}
                    </span>
                    <span className="lobby-row-meta">
                      Round {round.round_id} · {round.tile_count}{" "}
                      {round.tile_count === 1 ? "panel" : "panels"} ·{" "}
                      <Users size={12} aria-hidden="true" /> {round.player_count}{" "}
                      · pool {formatAmount(round.pool)}
                    </span>
                    <span className="lobby-row-deadline">
                      {deadlineLabel(round, now)}
                    </span>
                  </span>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {filter === "all" && historicalRounds.length > 0 && (
        <button
          className="history-toggle"
          type="button"
          aria-expanded={showHistory}
          onClick={() => setShowHistory((visible) => !visible)}
        >
          {showHistory
            ? "Hide past crossings"
            : `Show ${historicalRounds.length} past ${historicalRounds.length === 1 ? "crossing" : "crossings"}`}
        </button>
      )}
    </section>
  );
}
