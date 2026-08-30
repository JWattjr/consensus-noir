"use client";

import { AlertCircle, CheckCircle2, Github, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CaseRail } from "@/components/CaseRail";
import { Desk } from "@/components/Desk";
import { Dossier } from "@/components/Dossier";
import {
  CONTRACT_ADDRESS,
  IS_CONFIGURED,
  NETWORK_NAME,
  explorerTxUrl,
  readCase,
  readCaseIds,
  readEntry,
  writeCase,
  type EthereumProvider,
  type NoirCase,
  type NoirEntry,
} from "@/lib/contract";
import { DEMO_CASE, demoCase } from "@/lib/demo-case";
import { explain } from "@/lib/errors";
import {
  PHASE_COPY,
  forgetPending,
  readPending,
  rememberPending,
  track,
  type Phase,
} from "@/lib/lifecycle";
import { useChainGuard } from "@/lib/useChainGuard";
import {
  loadLocalAccusation,
  makeAccusationCommitment,
  normalizeTheory,
  saveLocalAccusation,
  theoryByteLength,
  type LocalAccusation,
} from "@/lib/crypto";

type BusyAction =
  | "commit" | "reveal" | "advance" | "resolve"
  | "claim" | "refund" | "cancel" | "makeRefundable";

interface Notice {
  tone: "success" | "error" | "progress";
  text: string;
}

export function NoirApp() {
  const [cases, setCases] = useState<NoirCase[]>(IS_CONFIGURED ? [] : [DEMO_CASE]);
  const [selectedId, setSelectedId] = useState(DEMO_CASE.case_id);
  const [wallet, setWallet] = useState<string | null>(null);
  const [entry, setEntry] = useState<NoirEntry | null>(null);
  const [localAccusation, setLocalAccusation] = useState<LocalAccusation | null>(null);
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [loading, setLoading] = useState(IS_CONFIGURED);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const { wrongNetwork, switchNetwork } = useChainGuard();

  const activeCase = useMemo(
    () => cases.find((item) => item.case_id === selectedId) ?? cases[0] ?? DEMO_CASE,
    [cases, selectedId],
  );

  const refreshCases = useCallback(async () => {
    if (!IS_CONFIGURED) {
      setCases([demoCase()]);
      setSelectedId(DEMO_CASE.case_id);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const ids = await readCaseIds();
      const loaded = await Promise.all(ids.map((caseId) => readCase(caseId)));
      setCases(loaded);
      setLoadError(null);
      setSelectedId((current) =>
        loaded.some((item) => item.case_id === current) ? current : loaded[0]?.case_id ?? "",
      );
    } catch (error) {
      setCases([]);
      setLoadError(explain(error).text);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshEntry = useCallback(async () => {
    if (!wallet || !IS_CONFIGURED || activeCase.isDemo) {
      setEntry(null);
      setLocalAccusation(
        wallet && !activeCase.isDemo ? loadLocalAccusation(activeCase.case_id, wallet) : null,
      );
      return;
    }
    try {
      const current = await readEntry(activeCase.case_id, wallet);
      setEntry(current);
      setLocalAccusation(loadLocalAccusation(activeCase.case_id, wallet));
    } catch (error) {
      setNotice({ tone: "error", text: explain(error).text });
    }
  }, [activeCase, wallet]);

  useEffect(() => {
    const task = window.setTimeout(() => void refreshCases(), 0);
    return () => window.clearTimeout(task);
  }, [refreshCases]);

  useEffect(() => {
    const task = window.setTimeout(() => void refreshEntry(), 0);
    return () => window.clearTimeout(task);
  }, [refreshEntry]);

  useEffect(() => {
    const wallet3 = typeof window !== "undefined" ? window.ethereum : undefined;
    if (!wallet3?.on) return;
    const onAccounts = (...args: unknown[]) => {
      const accounts = Array.isArray(args[0]) ? (args[0] as string[]) : [];
      setWallet(accounts[0] ?? null);
    };
    wallet3.on("accountsChanged", onAccounts);
    return () => wallet3.removeListener?.("accountsChanged", onAccounts);
  }, []);

  const connectWallet = useCallback(async () => {
    const provider: EthereumProvider | undefined =
      typeof window !== "undefined" ? window.ethereum : undefined;
    if (!provider) {
      setNotice({ tone: "error", text: "No browser wallet detected. Install a wallet that supports EIP-1193." });
      return null;
    }
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      const address = Array.isArray(accounts) ? String(accounts[0] ?? "") : "";
      if (!address) throw new Error("The wallet returned no account.");
      setWallet(address);
      setNotice(null);
      return address;
    } catch (error) {
      setNotice({ tone: "error", text: explain(error).text });
      return null;
    }
  }, []);

  /** Follows a transaction to finality, treating a reverted execution as failure. */
  const follow = useCallback(
    async (account: string, hash: string) => {
      setTxHash(hash);
      const result = await track(account, hash, (update) => {
        setPhase(update.phase);
        setNotice({
          tone:
            update.phase === "finalized"
              ? "success"
              : update.phase === "failed"
                ? "error"
                : "progress",
          text: update.error ?? PHASE_COPY[update.phase],
        });
      });
      if (result.phase === "finalized" || result.phase === "failed") forgetPending();
      await refreshCases();
      await refreshEntry();
      return result;
    },
    [refreshCases, refreshEntry],
  );

  // A reload must not orphan an in-flight transaction.
  useEffect(() => {
    const resume = readPending();
    if (!resume) return;
    const task = window.setTimeout(() => {
      setBusy(resume.action as BusyAction);
      void follow(resume.account, resume.hash).finally(() => setBusy(null));
    }, 0);
    return () => window.clearTimeout(task);
  }, [follow]);

  /** Runs an action, then follows the transaction to finality before claiming success. */
  async function execute(action: BusyAction, work: (account: string) => Promise<string>) {
    let account = wallet;
    if (!account) {
      account = await connectWallet();
      if (!account) return;
    }
    if (wrongNetwork) {
      setNotice({ tone: "error", text: `Switch your wallet to ${NETWORK_NAME} before signing.` });
      return;
    }
    setBusy(action);
    setTxHash(null);
    setPhase("signing");
    setNotice({ tone: "progress", text: PHASE_COPY.signing });
    try {
      const hash = await work(account);
      rememberPending({
        hash, account, caseId: activeCase.case_id, action, startedAt: Date.now(),
      });
      await follow(account, hash);
    } catch (error) {
      setPhase("failed");
      setNotice({ tone: "error", text: explain(error).text });
    } finally {
      setBusy(null);
    }
  }

  async function commit(input: { suspectId: string; theory: string; evidenceIds: string[]; salt: string }) {
    const account = wallet ?? (await connectWallet());
    if (!account) return;
    const normalizedTheory = normalizeTheory(input.theory);
    const size = theoryByteLength(normalizedTheory);
    if (size < 300 || size > 2000) {
      setNotice({ tone: "error", text: "Your theory must be between 300 and 2,000 bytes." });
      return;
    }
    const commitment = await makeAccusationCommitment(
      activeCase.case_id,
      account,
      input.suspectId,
      normalizedTheory,
      input.evidenceIds,
      input.salt,
    );
    const draft: LocalAccusation = {
      caseId: activeCase.case_id,
      player: account,
      suspectId: input.suspectId,
      theory: normalizedTheory,
      evidenceIds: input.evidenceIds,
      salt: input.salt,
      commitment,
      savedAt: Date.now(),
    };
    saveLocalAccusation(draft);
    setLocalAccusation(draft);
    await execute("commit", (who) =>
      writeCase(who, "enter_case", [activeCase.case_id, commitment], activeCase.entry_stake_wei),
    );
  }

  async function reveal() {
    if (!localAccusation) {
      setNotice({ tone: "error", text: "No saved reveal key for this wallet and case." });
      return;
    }
    await execute("reveal", (who) =>
      writeCase(who, "reveal_accusation", [
        activeCase.case_id,
        localAccusation.suspectId,
        localAccusation.theory,
        JSON.stringify(localAccusation.evidenceIds),
        localAccusation.salt,
      ]),
    );
  }

  const advance = () => execute("advance", (who) => writeCase(who, "advance_case", [activeCase.case_id]));
  const resolve = () => execute("resolve", (who) => writeCase(who, "resolve_case", [activeCase.case_id]));
  const claim = () => execute("claim", (who) => writeCase(who, "claim_case", [activeCase.case_id]));
  const refund = () => execute("refund", (who) => writeCase(who, "refund_case", [activeCase.case_id]));
  const cancelCase = () => execute("cancel", (who) => writeCase(who, "cancel_case", [activeCase.case_id]));
  const makeRefundable = () =>
    execute("makeRefundable", (who) => writeCase(who, "make_refundable", [activeCase.case_id]));

  const NoticeIcon =
    notice?.tone === "success" ? CheckCircle2 : notice?.tone === "progress" ? Loader2 : AlertCircle;

  return (
    <main className="site-shell">
      <header className="site-header">
        <Link className="brand-lockup" href="/" aria-label="Consensus Noir home">
          <span className="brand-mark">CN</span>
          <span><strong>Consensus Noir</strong><small>Evidence / consensus / consequence</small></span>
        </Link>
        <div className="header-actions">
          {wrongNetwork ? (
            <button type="button" className="network-badge network-badge-wrong" onClick={() => void switchNetwork()}>
              <span className="status-pip" aria-hidden="true" /> Wrong network — switch to {NETWORK_NAME}
            </button>
          ) : (
            <span className="network-badge"><span className="status-pip" aria-hidden="true" /> {NETWORK_NAME}</span>
          )}
          <button type="button" className="header-refresh" onClick={() => void refreshCases()} aria-label="Refresh docket" disabled={loading}>
            <RefreshCw size={15} className={loading ? "spin" : ""} aria-hidden="true" />
          </button>
          {wallet ? (
            <span className="header-wallet">{wallet.slice(0, 6)}…{wallet.slice(-4)}</span>
          ) : (
            <button type="button" className="connect-button" onClick={() => void connectWallet()}>Connect wallet</button>
          )}
        </div>
      </header>

      {!IS_CONFIGURED ? (
        <div className="config-banner">
          <ShieldCheck size={16} aria-hidden="true" />
          <span><strong>Preview mode.</strong> This dossier is a sample, not chain data. Set <code>NEXT_PUBLIC_CONSENSUS_NOIR_CONTRACT</code> to read and write a deployed {NETWORK_NAME} contract.</span>
        </div>
      ) : null}

      {notice ? (
        <div className={`toast toast-${notice.tone}`} role="status">
          <NoticeIcon size={15} className={notice.tone === "progress" ? "spin" : ""} aria-hidden="true" />
          <span>{notice.text}</span>
          {txHash ? (
            <a className="toast-link" href={explorerTxUrl(txHash)} target="_blank" rel="noreferrer" title={txHash}>
              {txHash.slice(0, 12)}… ↗
            </a>
          ) : null}
          {phase && phase !== "finalized" && phase !== "failed" ? <span className="phase-tag">{phase}</span> : null}
        </div>
      ) : null}

      <div className="workspace">
        <CaseRail cases={cases} selectedId={activeCase.case_id} onSelect={setSelectedId} />
        {loading && IS_CONFIGURED ? (
          <div className="loading-state"><RefreshCw size={22} className="spin" aria-hidden="true" /><p>Reading the frozen docket…</p></div>
        ) : loadError ? (
          <div className="loading-state">
            <AlertCircle size={22} aria-hidden="true" />
            <p>{loadError}</p>
            <button type="button" className="secondary-button" onClick={() => void refreshCases()}>Try again</button>
          </div>
        ) : cases.length === 0 ? (
          <div className="loading-state"><p>No cases have been published yet.</p></div>
        ) : (
          <>
            <Dossier caseFile={activeCase} />
            <Desk
              caseFile={activeCase}
              wallet={wallet}
              entry={entry}
              localAccusation={localAccusation}
              busy={busy}
              wrongNetwork={wrongNetwork}
              onConnect={async () => { await connectWallet(); }}
              onCommit={commit}
              onReveal={reveal}
              onAdvance={advance}
              onResolve={resolve}
              onClaim={claim}
              onRefund={refund}
              onCancelCase={cancelCase}
              onMakeRefundable={makeRefundable}
              onRefresh={async () => { await refreshCases(); await refreshEntry(); }}
            />
          </>
        )}
      </div>

      <footer className="site-footer">
        <span>Consensus Noir / MVP-01</span>
        <span>GEN is testnet-only. No real-value claims.</span>
        <span className="footer-links">
          <a href="https://genlayer.com" target="_blank" rel="noreferrer">GenLayer <Github size={12} aria-hidden="true" /></a>
          {IS_CONFIGURED ? <span>Contract {CONTRACT_ADDRESS.slice(0, 8)}…</span> : null}
        </span>
      </footer>
    </main>
  );
}
