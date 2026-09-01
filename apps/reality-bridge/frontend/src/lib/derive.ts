import type {
  ConfigView,
  PlayerView,
  RoundView,
  TileView,
  WriteAction,
} from "@/lib/contract";
import { sameAddress } from "@/lib/format";

/**
 * Pure state derivation.
 *
 * Every button in the interface is gated by this module, using only contract
 * state, the connected account, the wallet network and the clock. It mirrors
 * the contract's guards so the UI can explain *why* an action is unavailable
 * instead of letting the player discover it through a reverted transaction.
 */

export type ActionId = WriteAction;

export interface ActionAvailability {
  id: ActionId;
  label: string;
  /** Short reason the action is currently blocked, or null when enabled. */
  blockedReason: string | null;
  enabled: boolean;
  /** True when the action is meaningless in this state and should be hidden. */
  hidden: boolean;
  /** Anyone may send it; used to label permissionless recovery actions. */
  permissionless: boolean;
}

export type ViewerRole =
  | "disconnected"
  | "wrong-network"
  | "spectator"
  | "runner"
  | "player"
  | "eliminated";

export interface DerivedState {
  role: ViewerRole;
  /** The panel the round is currently working on, when one exists. */
  currentTile: TileView | null;
  activePlayer: PlayerView | null;
  viewer: PlayerView | null;
  viewerIsRunner: boolean;
  commitDeadline: number;
  revealDeadline: number;
  resolutionTime: number;
  /** Ordered actions for the current state, including blocked ones. */
  actions: ActionAvailability[];
  /** Concise status sentence for the live region. */
  headline: string;
}

export interface DeriveInput {
  round: RoundView;
  tiles: TileView[];
  players: PlayerView[];
  config: ConfigView;
  account: string;
  /** True when the wallet is connected to StudioNet. */
  networkOk: boolean;
  nowSeconds: number;
  /** True while any transaction from this session is still in flight. */
  txPending: boolean;
  /** True when the player holds a usable recovery bundle for this panel. */
  hasRecoveryBundle: boolean;
  /**
   * True when a commitment has been built *and* the player has confirmed they
   * saved its recovery bundle. Committing without that confirmation would
   * risk an unopenable sealed choice, so the control stays disabled.
   */
  commitmentReady: boolean;
}

const LABELS: Record<ActionId, string> = {
  join_round: "Join round",
  start_round: "Start round",
  commit_choice: "Commit sealed choice",
  reveal_choice: "Reveal choice",
  resolve_tile: "Request resolution",
  forfeit_missed_commit: "Forfeit missed commit",
  forfeit_missed_reveal: "Forfeit missed reveal",
  expire_round: "Expire round",
  claim: "Claim payout",
  refund: "Claim refund",
};

const PERMISSIONLESS = new Set<ActionId>([
  "start_round",
  "resolve_tile",
  "forfeit_missed_commit",
  "forfeit_missed_reveal",
  "expire_round",
]);

function action(
  id: ActionId,
  blockedReason: string | null,
  hidden = false,
): ActionAvailability {
  return {
    id,
    label: LABELS[id],
    blockedReason,
    enabled: blockedReason === null,
    hidden,
    permissionless: PERMISSIONLESS.has(id),
  };
}

function findViewer(players: PlayerView[], account: string): PlayerView | null {
  if (!account) return null;
  return (
    players.find((player) => sameAddress(player.account, account)) ?? null
  );
}

function bigOrZero(value: string): bigint {
  try {
    return BigInt(value || "0");
  } catch {
    return BigInt(0);
  }
}

export function deriveState(input: DeriveInput): DerivedState {
  const {
    round,
    tiles,
    players,
    config,
    account,
    networkOk,
    nowSeconds,
    txPending,
    hasRecoveryBundle,
    commitmentReady,
  } = input;

  const viewer = findViewer(players, account);
  const activePlayer = players[round.active_player_index] ?? null;
  const currentTile =
    round.status === "ACTIVE" ? (tiles[round.current_tile_index] ?? null) : null;
  const viewerIsRunner = Boolean(
    viewer && activePlayer && sameAddress(viewer.account, activePlayer.account),
  );

  const commitDeadline = round.attempt_deadline;
  const revealDeadline = round.reveal_deadline;
  const resolutionTime = currentTile?.resolution_time ?? 0;

  let role: ViewerRole = "spectator";
  if (!account) role = "disconnected";
  else if (!networkOk) role = "wrong-network";
  else if (!viewer) role = "spectator";
  else if (viewer.status === "ELIMINATED") role = "eliminated";
  else if (viewerIsRunner) role = "runner";
  else role = "player";

  const walletGate = (): string | null => {
    if (!account) return "Connect a wallet first.";
    if (!networkOk) return "Switch the wallet to GenLayer StudioNet.";
    if (txPending) return "A transaction from this session is still pending.";
    return null;
  };

  const actions: ActionAvailability[] = [];

  // -- join ----------------------------------------------------------------
  {
    const hidden = round.status !== "OPEN";
    let reason = walletGate();
    if (!reason) {
      if (viewer) reason = "You already hold a seat in this round.";
      else if (nowSeconds >= round.join_deadline)
        reason = "The join window has closed.";
      else if (round.player_count >= config.max_players)
        reason = "Every seat is taken.";
    }
    actions.push(action("join_round", reason, hidden));
  }

  // -- start ---------------------------------------------------------------
  {
    const hidden = round.status !== "OPEN";
    let reason = walletGate();
    if (!reason && nowSeconds < round.join_deadline) {
      reason = "The join window is still open.";
    }
    actions.push(action("start_round", reason, hidden));
  }

  // -- commit --------------------------------------------------------------
  {
    const hidden = round.status !== "ACTIVE";
    let reason = walletGate();
    if (!reason) {
      if (!viewerIsRunner) reason = "Only the active runner may commit.";
      else if (viewer?.committed) reason = "You already committed this panel.";
      else if (nowSeconds > commitDeadline)
        reason = "Your commit window has closed.";
      else if (currentTile && nowSeconds >= currentTile.choice_deadline)
        reason = "This panel's information cut-off has passed.";
      else if (!commitmentReady)
        reason = "Pick a side, then save the recovery bundle and confirm it.";
    }
    actions.push(action("commit_choice", reason, hidden));
  }

  // -- reveal --------------------------------------------------------------
  {
    const hidden = round.status !== "ACTIVE";
    let reason = walletGate();
    if (!reason) {
      if (!viewerIsRunner) reason = "Only the active runner may reveal.";
      else if (!viewer?.committed) reason = "Commit a choice first.";
      else if (viewer?.revealed) reason = "You already revealed this panel.";
      else if (nowSeconds > revealDeadline)
        reason = "The reveal grace period has passed.";
      else if (!hasRecoveryBundle)
        reason = "Import your recovery bundle to reveal.";
    }
    actions.push(action("reveal_choice", reason, hidden));
  }

  // -- resolve -------------------------------------------------------------
  {
    const hidden = round.status !== "ACTIVE";
    let reason = walletGate();
    if (!reason) {
      if (!activePlayer?.revealed)
        reason = "The runner has not revealed yet.";
      else if (nowSeconds < resolutionTime)
        reason = "The evidence timestamp has not arrived.";
    }
    actions.push(action("resolve_tile", reason, hidden));
  }

  // -- forfeit: missed commit ---------------------------------------------
  {
    const hidden = round.status !== "ACTIVE" || Boolean(activePlayer?.committed);
    let reason = walletGate();
    if (!reason) {
      if (activePlayer?.committed) reason = "The runner already committed.";
      else if (nowSeconds <= commitDeadline)
        reason = "The runner's commit window is still open.";
    }
    actions.push(action("forfeit_missed_commit", reason, hidden));
  }

  // -- forfeit: missed reveal ---------------------------------------------
  {
    const hidden =
      round.status !== "ACTIVE" ||
      !activePlayer?.committed ||
      Boolean(activePlayer?.revealed);
    let reason = walletGate();
    if (!reason) {
      if (!activePlayer?.committed) reason = "The runner never committed.";
      else if (activePlayer?.revealed) reason = "The runner already revealed.";
      else if (nowSeconds <= revealDeadline)
        reason = "The reveal grace period is still open.";
    }
    actions.push(action("forfeit_missed_reveal", reason, hidden));
  }

  // -- expire --------------------------------------------------------------
  {
    const hidden = round.status !== "ACTIVE" && round.status !== "OPEN";
    let reason = walletGate();
    if (!reason && nowSeconds <= round.terminal_deadline) {
      reason = "The terminal deadline has not passed.";
    }
    actions.push(action("expire_round", reason, hidden));
  }

  // -- claim ---------------------------------------------------------------
  {
    const hidden = round.status !== "SETTLED";
    let reason = walletGate();
    if (!reason) {
      if (!viewer) reason = "This wallet did not join the round.";
      else if (viewer.claimed) reason = "You already collected this payout.";
      else if (bigOrZero(viewer.claim_amount) === BigInt(0))
        reason = "This wallet has no payout in this round.";
    }
    actions.push(action("claim", reason, hidden));
  }

  // -- refund --------------------------------------------------------------
  {
    const hidden = round.status !== "REFUNDABLE" && round.status !== "CANCELLED";
    let reason = walletGate();
    if (!reason) {
      if (!viewer) reason = "This wallet did not join the round.";
      else if (viewer.refunded) reason = "You already collected this refund.";
      else if (bigOrZero(viewer.refund_amount) === BigInt(0))
        reason = "This wallet has no refund in this round.";
    }
    actions.push(action("refund", reason, hidden));
  }

  return {
    role,
    currentTile,
    activePlayer,
    viewer,
    viewerIsRunner,
    commitDeadline,
    revealDeadline,
    resolutionTime,
    actions,
    headline: headlineFor({
      round,
      currentTile,
      viewer,
      viewerIsRunner,
      activePlayer,
      role,
      nowSeconds,
    }),
  };
}

function headlineFor(params: {
  round: RoundView;
  currentTile: TileView | null;
  viewer: PlayerView | null;
  viewerIsRunner: boolean;
  activePlayer: PlayerView | null;
  role: ViewerRole;
  nowSeconds: number;
}): string {
  const { round, viewer, viewerIsRunner, role, nowSeconds } = params;

  if (role === "wrong-network") {
    return "Your wallet is on the wrong network. Switch to GenLayer StudioNet to act.";
  }

  switch (round.status) {
    case "DRAFT":
      return "This round is still being authored and cannot be joined yet.";
    case "OPEN":
      if (nowSeconds >= round.join_deadline) {
        return "The join window closed. Anyone can start the round now.";
      }
      return viewer
        ? "You hold a seat. The crossing starts when the join window closes."
        : "The join window is open.";
    case "ACTIVE":
      if (viewerIsRunner) {
        if (!viewer?.committed) return "You are the active runner: commit your sealed choice.";
        if (!viewer?.revealed) return "You are the active runner: reveal your choice.";
        return "Your choice is revealed. Anyone can now request resolution.";
      }
      return "The crossing is live. You are watching the active runner.";
    case "SETTLED":
      if (!viewer) return "This round is settled.";
      if (viewer.claimed) return "You already collected your payout.";
      return bigOrZero(viewer.claim_amount) > BigInt(0)
        ? "This round is settled and you have a payout to claim."
        : "This round is settled. This wallet has no payout.";
    case "REFUNDABLE":
      if (!viewer) return "This round unwound into refunds.";
      if (viewer.refunded) return "You already collected your refund.";
      return "This round unwound. Your entry is individually refundable.";
    case "CANCELLED":
      return "The publisher cancelled this round before it started.";
    default:
      return "";
  }
}

/** Sort rounds for the lobby: live first, then upcoming, then finished. */
const STATUS_ORDER: Record<RoundView["status"], number> = {
  ACTIVE: 0,
  OPEN: 1,
  DRAFT: 2,
  REFUNDABLE: 3,
  SETTLED: 4,
  CANCELLED: 5,
};

export type LobbyFilter =
  | "all"
  | "upcoming"
  | "open"
  | "active"
  | "settled"
  | "refundable"
  | "mine";

export function filterRounds(
  rounds: RoundView[],
  filter: LobbyFilter,
  joinedRoundIds: ReadonlySet<string>,
): RoundView[] {
  const matches = rounds.filter((round) => {
    switch (filter) {
      case "all":
        return true;
      case "upcoming":
        return round.status === "DRAFT";
      case "open":
        return round.status === "OPEN";
      case "active":
        return round.status === "ACTIVE";
      case "settled":
        return round.status === "SETTLED";
      case "refundable":
        return round.status === "REFUNDABLE" || round.status === "CANCELLED";
      case "mine":
        return joinedRoundIds.has(round.round_id);
      default:
        return true;
    }
  });
  return sortRounds(matches);
}

export function sortRounds(rounds: RoundView[]): RoundView[] {
  return [...rounds].sort((a, b) => {
    const order = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (order !== 0) return order;
    // Within a status, the soonest deadline is the most urgent.
    const deadlineA = a.status === "OPEN" ? a.join_deadline : a.terminal_deadline;
    const deadlineB = b.status === "OPEN" ? b.join_deadline : b.terminal_deadline;
    if (deadlineA !== deadlineB) return deadlineA - deadlineB;
    return Number(b.round_id) - Number(a.round_id);
  });
}

/**
 * Pick the round that makes the most sense as the first live view.
 *
 * A configured id is an explicit operator choice. Without one, prioritise a
 * running crossing, then a round a visitor can still join. A settled round is
 * a stronger default than an empty or stranded historical round because it
 * proves the complete protocol and does not invite an impossible action.
 */
export function preferredRound(
  rounds: RoundView[],
  pinnedRoundId: string,
  nowSeconds: number,
): RoundView | null {
  if (pinnedRoundId) {
    const pinned = rounds.find((round) => round.round_id === pinnedRoundId);
    if (pinned) return pinned;
  }

  const sorted = sortRounds(rounds);
  return (
    sorted.find((round) => round.status === "ACTIVE") ??
    sorted.find(
      (round) => round.status === "OPEN" && nowSeconds < round.join_deadline,
    ) ??
    sorted.find((round) => round.status === "DRAFT") ??
    sorted.find((round) => round.status === "SETTLED") ??
    sorted.find((round) => round.status === "OPEN") ??
    sorted.find((round) => round.status === "REFUNDABLE") ??
    sorted[0] ??
    null
  );
}

export function actionById(
  state: DerivedState,
  id: ActionId,
): ActionAvailability {
  const found = state.actions.find((entry) => entry.id === id);
  if (found) return found;
  return action(id, "Unavailable in this state.", true);
}
