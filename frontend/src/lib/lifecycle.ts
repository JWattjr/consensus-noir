import { TransactionStatus, isDecidedState } from "genlayer-js/types";
import type { GenLayerTransaction, TransactionHash } from "genlayer-js/types";
import { makeWriteClient } from "@/lib/contract";

/** What the player is told, derived from what the chain actually reports. */
export type Phase = "signing" | "pending" | "accepted" | "finalized" | "failed";

export interface PhaseUpdate {
  phase: Phase;
  tx?: GenLayerTransaction;
  error?: string;
}

const IN_FLIGHT: string[] = [
  TransactionStatus.PENDING,
  TransactionStatus.PROPOSING,
  TransactionStatus.COMMITTING,
  TransactionStatus.REVEALING,
  TransactionStatus.APPEAL_COMMITTING,
  TransactionStatus.APPEAL_REVEALING,
  TransactionStatus.READY_TO_FINALIZE,
];

export function phaseOf(statusName?: string): Phase {
  if (!statusName) return "pending";
  if (statusName === TransactionStatus.FINALIZED) return "finalized";
  if (statusName === TransactionStatus.ACCEPTED) return "accepted";
  if (IN_FLIGHT.includes(statusName)) return "pending";
  if (isDecidedState(statusName)) return "failed";
  return "pending";
}

/**
 * A GenLayer transaction can reach ACCEPTED or FINALIZED while the contract
 * call inside it reverted. Consensus status alone is therefore not success:
 * the leader receipt's execution_result is the authoritative signal, matching
 * what gltest's own tx_execution_succeeded checks.
 */
export function executionError(tx?: GenLayerTransaction): string | null {
  if (!tx) return null;
  const receipts = tx.consensus_data?.leader_receipt;
  if (!receipts || receipts.length === 0) return null;
  const receipt = receipts[0];
  const result = receipt?.execution_result;
  if (!result || result === "SUCCESS") return null;
  return receipt?.error?.trim() || `The contract call did not succeed (${result}).`;
}

export const PHASE_COPY: Record<Phase, string> = {
  signing: "Waiting for your wallet…",
  pending: "Validators are working on this. It usually takes a minute.",
  accepted: "Accepted. Waiting for finality before any GEN is released.",
  finalized: "Settled on chain.",
  failed: "The network could not complete this transaction.",
};

/**
 * Follow one transaction from submission to finality.
 *
 * Payouts are emitted with on="finalized", so funds genuinely do not move at
 * acceptance. Success is reported only when the transaction is finalized AND
 * its execution result is SUCCESS.
 */
export async function track(
  account: string,
  hash: string,
  onPhase: (update: PhaseUpdate) => void,
): Promise<PhaseUpdate> {
  const client = makeWriteClient(account);
  const id = hash as unknown as TransactionHash;
  onPhase({ phase: "pending" });

  const accepted = await client.waitForTransactionReceipt({
    hash: id,
    status: TransactionStatus.ACCEPTED,
    interval: 2000,
    retries: 60,
  });

  const acceptedFailure = executionError(accepted);
  if (acceptedFailure || phaseOf(accepted?.statusName) === "failed") {
    const update: PhaseUpdate = {
      phase: "failed",
      tx: accepted,
      error: acceptedFailure ?? PHASE_COPY.failed,
    };
    onPhase(update);
    return update;
  }
  onPhase({ phase: phaseOf(accepted?.statusName), tx: accepted });

  const finalized = await client.waitForTransactionReceipt({
    hash: id,
    status: TransactionStatus.FINALIZED,
    interval: 3000,
    retries: 120,
  });

  const finalFailure = executionError(finalized);
  const update: PhaseUpdate = finalFailure
    ? { phase: "failed", tx: finalized, error: finalFailure }
    : { phase: phaseOf(finalized?.statusName), tx: finalized };
  onPhase(update);
  return update;
}

/**
 * StudioNet allows cancelling a transaction that is still in flight. The SDK
 * refuses this on non-studio chains, so it is offered only as a recovery path
 * for a resolve that has stalled.
 */
export async function cancel(account: string, hash: string): Promise<void> {
  const client = makeWriteClient(account);
  await client.cancelTransaction({ hash: hash as unknown as TransactionHash });
}

/* ---- pending transaction, remembered across reloads ---- */

const PENDING_KEY = "consensus-noir:pending-tx";

export interface PendingTx {
  hash: string;
  account: string;
  caseId: string;
  action: string;
  startedAt: number;
}

export function rememberPending(value: PendingTx): void {
  try {
    window.localStorage.setItem(PENDING_KEY, JSON.stringify(value));
  } catch {
    // A blocked store only costs resume-after-reload, never correctness.
  }
}

export function forgetPending(): void {
  try {
    window.localStorage.removeItem(PENDING_KEY);
  } catch {
    // ignore
  }
}

export function readPending(): PendingTx | null {
  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingTx;
    if (!parsed?.hash || !parsed?.account) return null;
    // Stop resuming a transaction nobody is waiting for any more.
    if (Date.now() - parsed.startedAt > 60 * 60 * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}
