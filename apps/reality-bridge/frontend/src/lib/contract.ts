import { createClient } from "genlayer-js";
import type { Address, TransactionHash } from "genlayer-js/types";
import { TransactionHashVariant } from "genlayer-js/types";

import {
  NETWORK,
  NETWORK_CHAIN_ID,
  NETWORK_LABEL,
  RPC_ENDPOINT,
  getInjectedProvider,
  readChainId,
} from "@/lib/network";
import {
  classifyTransaction,
  humaniseContractError,
  isUserRejection,
  TERMINAL_PHASES,
  type TxPhase,
  type TxState,
} from "@/lib/tx";

export const CONTRACT_ADDRESS = (
  process.env.NEXT_PUBLIC_REALITY_BRIDGE_CONTRACT ?? ""
).trim() as Address;

/** True only when a StudioNet contract address is configured. */
export const IS_CONFIGURED = CONTRACT_ADDRESS.length > 0;

export const PINNED_ROUND_ID = (
  process.env.NEXT_PUBLIC_REALITY_BRIDGE_ROUND_ID ?? ""
).trim();

export type RoundStatus =
  | "DRAFT"
  | "OPEN"
  | "ACTIVE"
  | "SETTLED"
  | "REFUNDABLE"
  | "CANCELLED";
export type PlayerStatus = "ACTIVE" | "ELIMINATED";
export type TileStatus = "PENDING" | "RESOLVED";
export type TileOutcome = "UNSET" | "YES" | "NO" | "VOID";
export type Choice = "YES" | "NO";

export interface RoundView {
  round_id: string;
  title: string;
  entry_amount: string;
  join_deadline: number;
  terminal_deadline: number;
  commit_window_seconds: number;
  reveal_grace_seconds: number;
  status: RoundStatus;
  tile_count: number;
  current_tile_index: number;
  active_player_index: number;
  attempt_deadline: number;
  reveal_deadline: number;
  player_count: number;
  pool: string;
  claimed_amount: string;
  refunded_amount: string;
}

export interface TileView {
  round_id: string;
  tile_index: number;
  question: string;
  yes_condition: string;
  primary_url: string;
  support_url_1: string;
  support_url_2: string;
  choice_deadline: number;
  resolution_time: number;
  status: TileStatus;
  outcome: TileOutcome;
  reason_code: string;
  evidence_receipt: string;
  event_id: string;
  effective_date: string;
  /** Unix second the evidence itself carried, as a decimal string. */
  observed_at: string;
  resolved_at: number;
  opener_index: number;
  attempts: number;
}

export interface PlayerView {
  round_id: string;
  account: string;
  join_index: number;
  status: PlayerStatus;
  discovery_credits: number;
  commitment: string;
  committed: boolean;
  revealed: boolean;
  choice: "" | "YES" | "NO";
  claim_amount: string;
  claimed: boolean;
  refund_amount: string;
  refunded: boolean;
}

export interface ConfigView {
  max_tiles: number;
  min_players: number;
  max_players: number;
  base_weight: number;
  credit_weight: number;
  protocol_fee_bps: number;
  min_commit_window: number;
  max_commit_window: number;
  min_reveal_grace: number;
  max_reveal_grace: number;
  max_corroborating_sources: number;
  commitment_domain: string;
  evidence_domain: string;
}

export interface RoundBundle {
  round: RoundView;
  tiles: TileView[];
  players: PlayerView[];
}

/** Thrown when the frontend is pointed at no StudioNet contract at all. */
export class NotConfiguredError extends Error {
  constructor() {
    super(
      "No StudioNet contract is configured. Set NEXT_PUBLIC_REALITY_BRIDGE_CONTRACT to a deployed Reality Bridge address.",
    );
    this.name = "NotConfiguredError";
  }
}

function requireConfigured(): void {
  if (!IS_CONFIGURED) throw new NotConfiguredError();
}

function clientConfig(account?: Address) {
  const provider = getInjectedProvider();
  return {
    chain: NETWORK,
    endpoint: RPC_ENDPOINT,
    ...(account && provider ? { account, provider } : {}),
  };
}

export function makeReadClient() {
  return createClient(clientConfig());
}

export function makeWriteClient(account: string) {
  return createClient(clientConfig(account as Address));
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

function asNumber(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function asBigString(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return String(Math.trunc(value));
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return "0";
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function isEmptyRecord(value: unknown): boolean {
  return Object.keys(asRecord(value)).length === 0;
}

export function normaliseRound(value: unknown): RoundView {
  const raw = asRecord(value);
  return {
    round_id: asText(raw.round_id),
    title: asText(raw.title),
    entry_amount: asBigString(raw.entry_amount),
    join_deadline: asNumber(raw.join_deadline),
    terminal_deadline: asNumber(raw.terminal_deadline),
    commit_window_seconds: asNumber(raw.commit_window_seconds),
    reveal_grace_seconds: asNumber(raw.reveal_grace_seconds),
    status: (asText(raw.status) || "DRAFT") as RoundStatus,
    tile_count: asNumber(raw.tile_count),
    current_tile_index: asNumber(raw.current_tile_index),
    active_player_index: asNumber(raw.active_player_index),
    attempt_deadline: asNumber(raw.attempt_deadline),
    reveal_deadline: asNumber(raw.reveal_deadline),
    player_count: asNumber(raw.player_count),
    pool: asBigString(raw.pool),
    claimed_amount: asBigString(raw.claimed_amount),
    refunded_amount: asBigString(raw.refunded_amount),
  };
}

export function normaliseTile(value: unknown): TileView {
  const raw = asRecord(value);
  return {
    round_id: asText(raw.round_id),
    tile_index: asNumber(raw.tile_index),
    question: asText(raw.question),
    yes_condition: asText(raw.yes_condition),
    primary_url: asText(raw.primary_url),
    support_url_1: asText(raw.support_url_1),
    support_url_2: asText(raw.support_url_2),
    choice_deadline: asNumber(raw.choice_deadline),
    resolution_time: asNumber(raw.resolution_time),
    status: (asText(raw.status) || "PENDING") as TileStatus,
    outcome: (asText(raw.outcome) || "UNSET") as TileOutcome,
    reason_code: asText(raw.reason_code),
    evidence_receipt: asText(raw.evidence_receipt),
    event_id: asText(raw.event_id),
    effective_date: asText(raw.effective_date),
    observed_at: asText(raw.observed_at),
    resolved_at: asNumber(raw.resolved_at),
    opener_index: asNumber(raw.opener_index),
    attempts: asNumber(raw.attempts),
  };
}

export function normalisePlayer(value: unknown): PlayerView {
  const raw = asRecord(value);
  return {
    round_id: asText(raw.round_id),
    account: asText(raw.account),
    join_index: asNumber(raw.join_index),
    status: (asText(raw.status) || "ACTIVE") as PlayerStatus,
    discovery_credits: asNumber(raw.discovery_credits),
    commitment: asText(raw.commitment),
    committed: Boolean(raw.committed),
    revealed: Boolean(raw.revealed),
    choice: (asText(raw.choice) || "") as PlayerView["choice"],
    claim_amount: asBigString(raw.claim_amount),
    claimed: Boolean(raw.claimed),
    refund_amount: asBigString(raw.refund_amount),
    refunded: Boolean(raw.refunded),
  };
}

export function normaliseConfig(value: unknown): ConfigView {
  const raw = asRecord(value);
  return {
    max_tiles: asNumber(raw.max_tiles) || 3,
    min_players: asNumber(raw.min_players) || 2,
    max_players: asNumber(raw.max_players) || 8,
    base_weight: asNumber(raw.base_weight) || 1,
    credit_weight: asNumber(raw.credit_weight) || 3,
    protocol_fee_bps: asNumber(raw.protocol_fee_bps),
    min_commit_window: asNumber(raw.min_commit_window),
    max_commit_window: asNumber(raw.max_commit_window),
    min_reveal_grace: asNumber(raw.min_reveal_grace),
    max_reveal_grace: asNumber(raw.max_reveal_grace),
    max_corroborating_sources: asNumber(raw.max_corroborating_sources),
    commitment_domain: asText(raw.commitment_domain),
    evidence_domain: asText(raw.evidence_domain),
  };
}

// ---------------------------------------------------------------------------
// Reads. Authoritative UI state always uses the explicit final variant rather
// than the SDK's latest-nonfinal default.
// ---------------------------------------------------------------------------

async function read(functionName: string, args: unknown[]): Promise<unknown> {
  requireConfigured();
  return makeReadClient().readContract({
    address: CONTRACT_ADDRESS,
    functionName,
    args: args as never[],
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  });
}

export async function readConfig(): Promise<ConfigView> {
  return normaliseConfig(await read("get_config", []));
}

export async function readRoundIds(): Promise<string[]> {
  return asArray<unknown>(await read("get_round_ids", [])).map((value) =>
    asText(value),
  );
}

export async function readRound(roundId: string): Promise<RoundView | null> {
  const raw = await read("get_round", [Number(roundId)]);
  if (isEmptyRecord(raw)) return null;
  return normaliseRound(raw);
}

export async function readTile(
  roundId: string,
  tileIndex: number,
): Promise<TileView> {
  return normaliseTile(await read("get_tile", [Number(roundId), tileIndex]));
}

export async function readPlayer(
  roundId: string,
  account: string,
): Promise<PlayerView | null> {
  const raw = await read("get_player", [Number(roundId), account]);
  if (isEmptyRecord(raw)) return null;
  return normalisePlayer(raw);
}

export async function readRoundBundle(roundId: string): Promise<RoundBundle> {
  const round = await readRound(roundId);
  if (!round) throw new Error(`Round ${roundId} does not exist on StudioNet.`);
  const [tiles, players] = await Promise.all([
    Promise.all(
      Array.from({ length: round.tile_count }, (_, index) =>
        readTile(roundId, index),
      ),
    ),
    Promise.all(
      Array.from({ length: round.player_count }, async (_, index) =>
        normalisePlayer(
          await read("get_player_by_index", [Number(roundId), index]),
        ),
      ),
    ),
  ]);
  return { round, tiles, players };
}

export async function readRoundSummaries(
  roundIds: string[],
): Promise<RoundView[]> {
  const rounds = await Promise.all(roundIds.map((id) => readRound(id)));
  return rounds.filter((value): value is RoundView => value !== null);
}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

const WEI_PER_GEN = BigInt("1000000000000000000");

export function genToWei(value: string | number): bigint {
  const text = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error("GEN amount must be numeric.");
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > 18) throw new Error("GEN amount has too many decimals.");
  return BigInt(whole) * WEI_PER_GEN + BigInt(fraction.padEnd(18, "0"));
}

// ---------------------------------------------------------------------------
// Writes with a real lifecycle
// ---------------------------------------------------------------------------

export type WriteAction =
  | "join_round"
  | "start_round"
  | "commit_choice"
  | "reveal_choice"
  | "resolve_tile"
  | "forfeit_missed_commit"
  | "forfeit_missed_reveal"
  | "expire_round"
  | "claim"
  | "refund";

export interface WriteRequest {
  action: WriteAction;
  account: string;
  args?: unknown[];
  value?: bigint;
  /** Consensus rotations to allow before giving up on a leader. */
  consensusMaxRotations?: number;
}

export interface WatchOptions {
  /** Milliseconds between receipt polls. */
  intervalMs?: number;
  /** Overall budget before the UI reports a timeout. */
  timeoutMs?: number;
  onUpdate?: (state: TxState) => void;
  signal?: AbortSignal;
}

const DEFAULT_INTERVAL_MS = 4000;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

function now(): number {
  return Date.now();
}

function advance(state: TxState, patch: Partial<TxState>): TxState {
  return { ...state, ...patch, updatedAt: now() };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Poll StudioNet until the transaction reaches a terminal phase.
 *
 * Used both for a freshly submitted transaction and for reconciling a
 * transaction recovered from local storage after a page reload.
 */
export async function watchTransaction(
  hash: string,
  action: WriteAction | string,
  options: WatchOptions = {},
): Promise<TxState> {
  requireConfigured();
  const interval = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const budget = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const client = makeReadClient();
  const startedAt = now();
  let state: TxState = {
    phase: "submitted",
    action,
    hash,
    statusName: null,
    message: null,
    startedAt,
    updatedAt: startedAt,
  };
  options.onUpdate?.(state);

  for (;;) {
    if (options.signal?.aborted) return state;
    let transaction: unknown = null;
    try {
      transaction = await client.getTransaction({
        hash: hash as TransactionHash,
      });
    } catch {
      // A transient RPC failure must not be reported as a chain failure; the
      // next poll re-reads the same hash.
    }

    if (transaction) {
      const classified = classifyTransaction(transaction);
      state = advance(state, {
        phase: classified.phase,
        statusName: classified.statusName,
        message: classified.message,
      });
      options.onUpdate?.(state);
      if (TERMINAL_PHASES.has(classified.phase)) return state;
    }

    if (now() - startedAt > budget) {
      // Distinguish "we never saw it decided" from "consensus accepted it but
      // finality took longer than we waited". The second is not a failure and
      // must not be reported as one.
      state =
        state.phase === "accepted"
          ? advance(state, {
              message:
                "Accepted by consensus. Finality was not observed within the wait budget; the board catches up on the next refresh.",
            })
          : advance(state, {
              phase: "timed-out",
              message:
                "StudioNet did not report a decided state in time. The transaction may still land; reload to reconcile it.",
            });
      options.onUpdate?.(state);
      return state;
    }

    try {
      await sleep(interval, options.signal);
    } catch {
      return state;
    }
  }
}

/**
 * Submit a contract write and follow it all the way to a decided state.
 *
 * The returned state is authoritative: `accepted`/`finalized` only when the
 * leader receipt reports a successful execution.
 */
export async function submitWrite(
  request: WriteRequest,
  options: WatchOptions = {},
): Promise<TxState> {
  requireConfigured();
  const startedAt = now();
  let state: TxState = {
    phase: "awaiting-signature",
    action: request.action,
    hash: null,
    statusName: null,
    message: null,
    startedAt,
    updatedAt: startedAt,
  };
  options.onUpdate?.(state);

  let hash: string;
  try {
    // Re-check the wallet's network immediately before signing. The UI already
    // gates on it, but a chain switch can land between render and signature,
    // and a write sent from the wrong chain would be lost value.
    const provider = getInjectedProvider();
    if (!provider) {
      throw new Error(
        `No injected wallet is available, so nothing can be signed on ${NETWORK_LABEL}.`,
      );
    }
    const chainId = await readChainId(provider);
    if (chainId !== NETWORK_CHAIN_ID) {
      throw new Error(
        `Your wallet is on chain ${chainId ?? "unknown"}. Switch it to ${NETWORK_LABEL} (chain ${NETWORK_CHAIN_ID}) before signing.`,
      );
    }

    const client = makeWriteClient(request.account);
    const submitted = await client.writeContract({
      address: CONTRACT_ADDRESS,
      functionName: request.action,
      args: (request.args ?? []) as never[],
      value: request.value ?? BigInt(0),
      consensusMaxRotations:
        request.consensusMaxRotations ?? NETWORK.defaultConsensusMaxRotations,
    });
    hash = String(submitted);
  } catch (error) {
    const rejected = isUserRejection(error);
    const message =
      error instanceof Error ? humaniseContractError(error.message) : String(error);
    state = advance(state, {
      phase: rejected ? "rejected" : "failed",
      message: rejected ? "You dismissed the wallet request." : message,
    });
    options.onUpdate?.(state);
    return state;
  }

  // watchTransaction emits the "submitted" phase itself, carrying the hash, so
  // announcing it here too would render the same step twice.
  return watchTransaction(hash, request.action, {
    ...options,
    onUpdate: (next) => options.onUpdate?.({ ...next, startedAt }),
  });
}

export const ACTION_LABEL: Record<WriteAction, string> = {
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

export type { TxPhase, TxState };
