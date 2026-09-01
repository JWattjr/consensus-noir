"use client";

import { Check, Info, LockKeyhole, Zap } from "lucide-react";

import type { PlayerView, RoundView, TileView } from "@/lib/contract";
import { formatAmount, sameAddress, shortAddress, shortHash } from "@/lib/format";
import { ExternalLinkOut, StatusPill } from "@/components/ui";

const REASON_COPY: Record<string, string> = {
  FINAL_EVIDENCE: "Validators agreed the registered evidence settles this panel.",
  VOID_EVIDENCE: "Validators agreed the evidence cannot answer this panel.",
  VOID_CONTRADICTION:
    "A corroborating source contradicted the primary source, so the panel was voided.",
  VOID_LIVENESS:
    "No runner produced a valid sealed choice before this panel's information cut-off, so it was voided.",
};

/** The simulation must never borrow live-consensus vocabulary. */
const SIMULATED_REASON_COPY: Record<string, string> = {
  FINAL_EVIDENCE: "The scenario had already fixed this panel's outcome.",
  VOID_EVIDENCE: "The scenario marked this panel unanswerable.",
  VOID_CONTRADICTION:
    "The scenario's corroborating fixture disagreed with the primary one, so the panel was voided.",
  VOID_LIVENESS:
    "No sealed choice existed before this panel's cut-off, so it was voided.",
};

function tileState(
  tile: TileView,
  index: number,
  currentIndex: number,
  roundActive: boolean,
): "resolved" | "active" | "locked" {
  if (tile.status === "RESOLVED") return "resolved";
  if (roundActive && index === currentIndex) return "active";
  return "locked";
}

export function BridgeBoard({
  round,
  tiles,
}: {
  round: RoundView;
  tiles: TileView[];
}) {
  const resolved = tiles.filter((tile) => tile.status === "RESOLVED").length;
  const progress = tiles.length
    ? Math.round((resolved / tiles.length) * 100)
    : 0;
  const tileStates = tiles.map((tile, index) =>
    tileState(
      tile,
      index,
      round.current_tile_index,
      round.status === "ACTIVE",
    ),
  );
  const hasActivePanel = tileStates.includes("active");
  const hasLockedPanel = tileStates.includes("locked");

  return (
    <div
      className={
        tiles.length === 1
          ? "bridge-card bridge-card-single panel"
          : "bridge-card panel"
      }
    >
      <div className="panel-topline">
        <div>
          <span className="panel-kicker">ROUND {round.round_id}</span>
          <StatusPill tone={round.status === "ACTIVE" ? "busy" : "neutral"}>
            {round.status}
          </StatusPill>
        </div>
        <span className="pool-label">
          Pool <strong>{formatAmount(round.pool)}</strong>
        </span>
      </div>

      <div
        className="bridge-progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        aria-label="Panels resolved"
      >
        <div className="progress-track">
          <span style={{ width: `${Math.max(progress, 6)}%` }} />
        </div>
        <div className="progress-labels">
          <span>Start</span>
          <span>
            {resolved} of {tiles.length}{" "}
            {tiles.length === 1 ? "panel" : "panels"} resolved
          </span>
          <span>Finish</span>
        </div>
      </div>

      <ol
        className={
          tiles.length === 1 ? "bridge-board bridge-board-single" : "bridge-board"
        }
      >
        {tiles.map((tile, index) => {
          const state = tileStates[index];
          return (
            <li className={`bridge-tile tile-${state}`} key={tile.tile_index}>
              <div className="tile-cap">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <span aria-hidden="true">
                  {state === "resolved" ? (
                    <Check size={13} />
                  ) : state === "active" ? (
                    <Zap size={13} />
                  ) : (
                    <LockKeyhole size={12} />
                  )}
                </span>
              </div>
              <div className="tile-face">
                {state === "resolved" ? (
                  <div className="tile-outcome">{tile.outcome}</div>
                ) : state === "active" ? (
                  <div className="tile-question-mark">?</div>
                ) : (
                  <LockKeyhole size={19} aria-hidden="true" />
                )}
              </div>
              <div className="tile-meta">
                {state === "resolved"
                  ? tile.outcome === "VOID"
                    ? "VOID"
                    : "RESOLVED"
                  : state === "active"
                    ? "IN PLAY"
                    : "NOT YET"}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="bridge-caption">
        <span>
          <span className="legend-dot resolved" /> Settled by validator consensus
        </span>
        {hasActivePanel && (
          <span>
            <span className="legend-dot active" /> Current panel
          </span>
        )}
        {hasLockedPanel && (
          <span>
            <span className="legend-dot locked" /> Evidence not yet due
          </span>
        )}
      </div>
    </div>
  );
}

export function EvidenceLedger({
  tiles,
  simulation = false,
}: {
  tiles: TileView[];
  simulation?: boolean;
}) {
  const resolved = tiles.filter((tile) => tile.status === "RESOLVED");
  const reasonCopy = simulation ? SIMULATED_REASON_COPY : REASON_COPY;
  return (
    <section className="panel evidence-panel" aria-labelledby="evidence-heading">
      <div className="panel-heading">
        <div>
          <span className="panel-kicker">
            {simulation ? "SIMULATED RECEIPTS" : "EVIDENCE RECEIPTS"}
          </span>
          <h3 id="evidence-heading">
            {simulation
              ? "What the scenario recorded"
              : "What the validators recorded"}
          </h3>
        </div>
      </div>
      {resolved.length === 0 ? (
        <p className="muted-copy">No panel has been resolved yet.</p>
      ) : (
        <ul className="evidence-list">
          {resolved.map((tile) => (
            <li key={tile.tile_index}>
              <div className="evidence-head">
                <strong>Panel {tile.tile_index + 1}</strong>
                <StatusPill
                  tone={
                    tile.outcome === "VOID"
                      ? "warn"
                      : tile.outcome === "YES"
                        ? "good"
                        : "bad"
                  }
                >
                  {tile.outcome}
                </StatusPill>
              </div>
              <p className="evidence-question">{tile.question}</p>
              <p className="muted-copy">
                {reasonCopy[tile.reason_code] ?? tile.reason_code}
              </p>
              <dl className="evidence-fields">
                {tile.event_id && (
                  <div>
                    <dt>Event id</dt>
                    <dd>
                      <code>{tile.event_id}</code>
                    </dd>
                  </div>
                )}
                {tile.effective_date && (
                  <div>
                    <dt>Effective</dt>
                    <dd>{tile.effective_date}</dd>
                  </div>
                )}
                {tile.evidence_receipt && (
                  <div>
                    <dt>Receipt</dt>
                    <dd>
                      <code className="wrap-anywhere">
                        {shortHash(tile.evidence_receipt, 16, 10)}
                      </code>
                    </dd>
                  </div>
                )}
                <div>
                  <dt>Attempts</dt>
                  <dd>{tile.attempts}</dd>
                </div>
              </dl>
              <p className="evidence-sources">
                <ExternalLinkOut href={tile.primary_url}>
                  Primary source
                </ExternalLinkOut>
                {tile.support_url_1 && (
                  <ExternalLinkOut href={tile.support_url_1}>
                    Corroborating source
                  </ExternalLinkOut>
                )}
                {tile.support_url_2 && (
                  <ExternalLinkOut href={tile.support_url_2}>
                    Corroborating source 2
                  </ExternalLinkOut>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="micro-copy">
        <Info size={12} aria-hidden="true" />{" "}
        {simulation
          ? "These receipts are fixtures produced by the scenario script. No source was read and no network was involved."
          : "A receipt records that validators independently agreed on how to read a registered source. It is evidence of agreement, not proof that the source itself is correct."}
      </p>
    </section>
  );
}

/**
 * What a seat is currently doing.
 *
 * "WAITING" is only true while a round is still running. On a finished round
 * every surviving seat was showing it, which read as though the game were
 * still in progress.
 */
function seatLabel(
  player: PlayerView,
  round: RoundView,
  isRunner: boolean,
): string {
  if (player.status === "ELIMINATED") return "OUT";
  if (round.status === "SETTLED") {
    if (player.claimed) return "PAID";
    return player.claim_amount === "0" ? "NO PAYOUT" : "CAN CLAIM";
  }
  if (round.status === "REFUNDABLE" || round.status === "CANCELLED") {
    return player.refunded ? "REFUNDED" : "CAN REFUND";
  }
  if (round.status === "OPEN") return "SEATED";
  return isRunner ? "CROSSING" : "WAITING";
}

export function PlayerRail({
  round,
  players,
  account,
}: {
  round: RoundView;
  players: PlayerView[];
  account: string;
}) {
  const alive = players.filter((player) => player.status === "ACTIVE").length;
  const countLabel =
    round.status === "SETTLED"
      ? `${alive} ${alive === 1 ? "survivor" : "survivors"}`
      : round.status === "REFUNDABLE" || round.status === "CANCELLED"
        ? players.length === 0
          ? "No seats"
          : "Round unwound"
        : round.status === "OPEN"
          ? `${players.length} seated`
          : `${alive} still crossing`;
  return (
    <section className="panel players-card" aria-labelledby="players-heading">
      <div className="panel-heading">
        <div>
          <span className="panel-kicker">CROSSING ORDER</span>
          <h3 id="players-heading">Who is on the bridge</h3>
        </div>
        <span className="count-badge">{countLabel}</span>
      </div>
      {players.length === 0 ? (
        <p className="muted-copy">Nobody has taken a seat yet.</p>
      ) : (
        <ul className="players-list">
          {players.map((player, index) => {
            const isYou = sameAddress(player.account, account);
            const isRunner =
              round.status === "ACTIVE" && index === round.active_player_index;
            return (
              <li
                key={`${player.account}-${index}`}
                className={
                  player.status === "ELIMINATED"
                    ? "player-row eliminated"
                    : isRunner
                      ? "player-row current"
                      : "player-row"
                }
              >
                <span className="player-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="player-avatar" aria-hidden="true">
                  {player.account.slice(2, 4).toUpperCase()}
                </span>
                <span className="player-detail">
                  <strong>{isYou ? "You" : `Runner ${index + 1}`}</strong>
                  <span title={player.account}>{shortAddress(player.account)}</span>
                </span>
                <span className="player-credits">
                  <strong>{player.discovery_credits}</strong>
                  <span>credits</span>
                </span>
                <span className={`player-state ${player.status.toLowerCase()}`}>
                  {seatLabel(player, round, isRunner)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="players-foot">
        <Info size={13} aria-hidden="true" /> Join order is immutable. A later
        seat inherits every panel an earlier runner already opened, which is why
        discovery credits carry the larger share of the pool.
      </p>
    </section>
  );
}
