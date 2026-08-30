"use client";

import { AlertTriangle, Check, Copy, Download, KeyRound, LockKeyhole, RotateCw, Upload, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { NoirCase, NoirEntry } from "@/lib/contract";
import { NETWORK_NAME, formatGen } from "@/lib/contract";
import {
  REQUIRED_EVIDENCE_PICKS,
  canonicalEvidence,
  deriveSalt,
  downloadSaltBackup,
  importSaltBackup,
  loadLocalAccusation,
  normalizeTheory,
  theoryByteLength,
  type LocalAccusation,
} from "@/lib/crypto";

interface DeskProps {
  caseFile: NoirCase;
  wallet: string | null;
  entry: NoirEntry | null;
  localAccusation: LocalAccusation | null;
  busy: string | null;
  wrongNetwork: boolean;
  onConnect: () => Promise<void>;
  onCommit: (input: { suspectId: string; theory: string; evidenceIds: string[]; salt: string }) => Promise<void>;
  onReveal: () => Promise<void>;
  onAdvance: () => Promise<void>;
  onResolve: () => Promise<void>;
  onClaim: () => Promise<void>;
  onRefund: () => Promise<void>;
  onCancelCase: () => Promise<void>;
  onMakeRefundable: () => Promise<void>;
  onRefresh: () => Promise<void>;
}

function shortAddress(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function actionLabel(busy: string | null, action: string, idle: string): string {
  return busy === action ? "Broadcasting…" : idle;
}

export function Desk({
  caseFile, wallet, entry, localAccusation, busy, wrongNetwork,
  onConnect, onCommit, onReveal, onAdvance, onResolve, onClaim, onRefund,
  onCancelCase, onMakeRefundable, onRefresh,
}: DeskProps) {
  const [suspectId, setSuspectId] = useState(caseFile.suspects[0]?.id ?? "");
  const [theory, setTheory] = useState("");
  const [picks, setPicks] = useState<string[]>([]);
  const [salt, setSalt] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [restored, setRestored] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showRubric, setShowRubric] = useState(false);
  const [now, setNow] = useState(0);

  const isDemo = Boolean(caseFile.isDemo);
  const theoryBytes = theoryByteLength(theory);
  const deadline = deadlineFor(caseFile);

  // Gate on the clock as well as the stored status: a case still reads OPEN
  // until somebody calls advance_case, but entries revert after the deadline.
  const entriesOpen = caseFile.status === "OPEN" && now > 0 && now < caseFile.accusation_deadline;
  const revealOpen = caseFile.status === "REVEAL" && now > 0 && now < caseFile.reveal_deadline;
  const needsAdvance =
    now > 0 &&
    ((caseFile.status === "OPEN" && now >= caseFile.accusation_deadline) ||
      (caseFile.status === "REVEAL" && now >= caseFile.reveal_deadline));

  const verdict = caseFile.resolution;
  const isFinal = caseFile.status === "RESOLVED" && verdict?.status === "FINAL";
  const iWon = Boolean(isFinal && entry?.revealed && entry.suspect_id === verdict?.culprit_id);
  const nobodyWon = Boolean(
    isFinal && !caseFile.entries.some((item) => item.revealed && item.suspect_id === verdict?.culprit_id),
  );
  const settled = Boolean(entry?.claimed || entry?.refunded);
  // cancel_case: past the accusation deadline and under the minimum player count.
  const canCancel =
    now > 0 && !isDemo &&
    (caseFile.status === "OPEN" || caseFile.status === "REVEAL") &&
    now >= caseFile.accusation_deadline &&
    caseFile.player_count < caseFile.min_players;
  // make_refundable: the fixed liveness backstop, once the refund deadline passes.
  const canMakeRefundable =
    now > 0 && !isDemo &&
    (caseFile.status === "OPEN" || caseFile.status === "REVEAL" || caseFile.status === "RESOLVABLE") &&
    now >= caseFile.refund_deadline;
  const canSettle = Boolean(entry) && !settled && isFinal && (iWon || nobodyWon);

  const picksComplete = picks.length === REQUIRED_EVIDENCE_PICKS;
  const canCommit =
    !isDemo && !wrongNetwork && !entry &&
    suspectId.length > 0 && theoryBytes >= 300 && theoryBytes <= 2000 &&
    picksComplete && salt.length >= 32;
  const canReveal = Boolean(localAccusation && entry && !entry.revealed && revealOpen && !isDemo && !wrongNetwork);

  const payout = useMemo(() => {
    const pool = caseFile.total_escrow_wei + caseFile.entry_stake_wei;
    const revealed = Math.max(1, caseFile.entries.filter((item) => item.revealed).length);
    return { alone: pool, shared: pool / BigInt(revealed + 1) };
  }, [caseFile]);

  useEffect(() => {
    const task = window.setTimeout(() => {
      const draft = localAccusation ?? loadLocalAccusation(caseFile.case_id, wallet ?? undefined);
      setSuspectId(draft?.suspectId ?? caseFile.suspects[0]?.id ?? "");
      setTheory(draft?.theory ?? "");
      setPicks(draft?.evidenceIds ?? []);
      setSalt(draft?.salt ?? "");
    }, 0);
    return () => window.clearTimeout(task);
  }, [caseFile.case_id, caseFile.suspects, localAccusation, wallet]);

  useEffect(() => {
    const first = window.setTimeout(() => setNow(Math.floor(Date.now() / 1000)), 0);
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, []);

  function togglePick(id: string) {
    setPicks((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= REQUIRED_EVIDENCE_PICKS) return current;
      return canonicalEvidence([...current, id]);
    });
  }

  async function handleDeriveKey() {
    setKeyError(null);
    if (!wallet) { await onConnect(); return; }
    try {
      setSalt(await deriveSalt(caseFile.case_id, wallet));
    } catch (error) {
      setKeyError(error instanceof Error ? error.message : "Could not create your reveal key.");
    }
  }

  async function handleImport(file: File | undefined) {
    setRestored(null);
    setKeyError(null);
    if (!file) return;
    if (!wallet) { await onConnect(); return; }
    try {
      const draft = importSaltBackup(await file.text(), caseFile.case_id, wallet);
      setSuspectId(draft.suspectId);
      setTheory(draft.theory);
      setPicks(draft.evidenceIds);
      setSalt(draft.salt);
      setRestored("Backup restored. You can reveal with this wallet again.");
    } catch (error) {
      setKeyError(error instanceof Error ? error.message : "Could not read that backup.");
    }
  }

  function handleDownload() {
    downloadSaltBackup({
      caseId: caseFile.case_id,
      player: wallet ?? "not-connected",
      suspectId,
      theory: normalizeTheory(theory),
      evidenceIds: picks,
      salt,
      commitment: entry?.commitment ?? "not-committed",
      savedAt: Date.now(),
    });
  }

  async function handleCopyCommitment() {
    if (!entry?.commitment) return;
    await navigator.clipboard.writeText(entry.commitment);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <aside className="desk" aria-label="Player desk">
      <div className="desk-heading">
        <div><span className="eyebrow">Your desk</span><h2>Make your accusation</h2></div>
        <WalletCards size={18} strokeWidth={1.5} aria-hidden="true" />
      </div>

      <div className="how-it-works">
        <span className="eyebrow">How this works</span>
        <ol>
          <li>Stake {formatGen(caseFile.entry_stake_wei)} GEN on one suspect and the three exhibits that prove it.</li>
          <li>Your pick stays hidden until the reveal window, then you unseal it.</li>
          <li>GenLayer validators read the same frozen file and name a culprit. Nobody — not even the curator — knows it in advance.</li>
          <li>Correct accusers split the pool, weighted by how well their exhibits match the validators&rsquo;.</li>
        </ol>
      </div>

      {deadline && now > 0 ? (
        <div className="deadline-strip">
          <div><span className="eyebrow">Live case clock</span><strong>{deadline.label}</strong><small>{formatDeadline(deadline.unix)}</small></div>
          <span className="deadline-value">{formatRemaining(deadline.unix - now)}</span>
        </div>
      ) : null}

      {isDemo ? <div className="demo-banner"><SparkleMark /> Preview dossier <span>Connect a deployed contract to play on {NETWORK_NAME}.</span></div> : null}
      {wrongNetwork ? <div className="warning-box"><AlertTriangle size={15} aria-hidden="true" /><span>Your wallet is on the wrong network. Switch to {NETWORK_NAME} to sign anything.</span></div> : null}

      {!wallet ? (
        <button className="primary-button full-button" type="button" onClick={() => void onConnect()}>
          <WalletCards size={16} aria-hidden="true" /> Connect wallet
        </button>
      ) : (
        <div className="wallet-strip">
          <span className="wallet-avatar"><KeyRound size={13} aria-hidden="true" /></span>
          <div><span>Connected wallet</span><strong>{shortAddress(wallet)}</strong></div>
          <button type="button" className="icon-button" onClick={() => void onRefresh()} aria-label="Refresh case state"><RotateCw size={14} aria-hidden="true" /></button>
        </div>
      )}

      {entry?.revealed ? (
        <div className="entry-confirmed"><Check size={16} aria-hidden="true" /><div><strong>Accusation revealed</strong><span>Your theory is on the public file as {entry.suspect_id}.</span></div></div>
      ) : null}
      {entry && !entry.revealed && caseFile.status === "OPEN" ? (
        <div className="entry-confirmed entry-committed">
          <LockKeyhole size={16} aria-hidden="true" />
          <div><strong>Commitment sealed</strong><span>Your suspect and exhibits stay hidden until the reveal window.</span></div>
          <button type="button" className="text-button" onClick={() => void handleCopyCommitment()}>{copied ? "Copied" : "Copy hash"}<Copy size={12} aria-hidden="true" /></button>
        </div>
      ) : null}

      {entriesOpen && !entry ? (
        <div className="desk-form">
          <fieldset className="suspect-picker">
            <legend>Who is responsible?</legend>
            {caseFile.suspects.map((suspect) => (
              <label className={`suspect-option${suspectId === suspect.id ? " is-selected" : ""}`} key={suspect.id}>
                <input type="radio" name="suspect" value={suspect.id} checked={suspectId === suspect.id} onChange={() => setSuspectId(suspect.id)} disabled={isDemo} />
                <span className="option-id">{suspect.id}</span>
                <span><strong>{suspect.name}</strong><small>{suspect.profile}</small></span>
              </label>
            ))}
          </fieldset>

          <fieldset className="evidence-picker">
            <legend>Which three exhibits prove it? <span>{picks.length}/{REQUIRED_EVIDENCE_PICKS}</span></legend>
            {caseFile.evidence.map((item) => {
              const chosen = picks.includes(item.id);
              return (
                <label className={`evidence-option${chosen ? " is-selected" : ""}`} key={item.id}>
                  <input type="checkbox" checked={chosen} onChange={() => togglePick(item.id)} disabled={isDemo || (!chosen && picks.length >= REQUIRED_EVIDENCE_PICKS)} />
                  <span className="option-id">{item.id}</span>
                  <span><small>{item.summary}</small></span>
                </label>
              );
            })}
            <p className="picker-note">Your payout is weighted by how many of these the validators also cite.</p>
          </fieldset>

          <label className="field-label" htmlFor="theory">Your theory <span>{theoryBytes}/2,000 bytes</span></label>
          <textarea id="theory" className="theory-input" value={theory} onChange={(event) => setTheory(event.target.value)} disabled={isDemo} placeholder="Build the chain of evidence. What happened, and which details make the alternative stories fail?" minLength={300} maxLength={2000} />

          <div className="salt-box">
            <div className="salt-copy">
              <span className="salt-icon"><KeyRound size={15} aria-hidden="true" /></span>
              <div><strong>Reveal key</strong><small>{salt ? `${salt.slice(0, 8)}••••${salt.slice(-8)}` : "Sign once to create a key you can always regenerate"}</small></div>
            </div>
            <button type="button" className="secondary-button" onClick={() => void handleDeriveKey()} disabled={isDemo}>{salt ? "Regenerate" : "Create key"}</button>
          </div>
          {keyError ? <p className="form-error">{keyError}</p> : null}

          <div className="stake-summary">
            <span className="eyebrow">Before you sign</span>
            <dl>
              <div><dt>Your stake</dt><dd>{formatGen(caseFile.entry_stake_wei)} GEN</dd></div>
              <div><dt>Pool if you join</dt><dd>{formatGen(payout.alone)} GEN</dd></div>
              <div><dt>Players in</dt><dd>{caseFile.player_count}/{caseFile.max_players}</dd></div>
              <div><dt>If you win alone</dt><dd>{formatGen(payout.alone)} GEN</dd></div>
              <div><dt>If others are right too</dt><dd>about {formatGen(payout.shared)} GEN</dd></div>
            </dl>
            <ul className="risk-list">
              <li><strong>Wrong suspect:</strong> you lose your whole stake to the accusers who were right.</li>
              <li><strong>No reveal by {formatDeadline(caseFile.reveal_deadline)}:</strong> you lose your whole stake even if your suspect was right.</li>
              <li><strong>Verdict is VOID:</strong> everyone gets their stake back.</li>
              <li>There is no fee. The entire pool goes to players.</li>
            </ul>
          </div>

          <div className="warning-box">
            <AlertTriangle size={15} aria-hidden="true" />
            <span>Save a backup before committing. Without the key you cannot reveal, and you lose your stake.</span>
          </div>
          <button className="primary-button full-button" type="button" disabled={!canCommit || Boolean(busy)} onClick={() => void onCommit({ suspectId, theory, evidenceIds: picks, salt })}>
            {actionLabel(busy, "commit", `Stake ${formatGen(caseFile.entry_stake_wei)} GEN on ${suspectId || "a suspect"}`)}
          </button>
          <button className="backup-button" type="button" onClick={handleDownload} disabled={!salt}><Download size={14} aria-hidden="true" /> Download reveal key backup</button>
        </div>
      ) : null}

      {needsAdvance ? (
        <div className="desk-action-card">
          <span className="action-kicker">This case is due</span>
          <h3>{caseFile.status === "OPEN" ? "Entries have closed" : "The reveal window has closed"}</h3>
          <p>The clock has passed but nobody has moved the case on yet. Anyone can do it — no curator needed.</p>
          <button className="primary-button full-button" type="button" disabled={Boolean(busy) || isDemo || wrongNetwork} onClick={() => void onAdvance()}>{actionLabel(busy, "advance", "Advance this case")}</button>
        </div>
      ) : null}

      {caseFile.status === "REVEAL" ? (
        <div className="desk-action-card">
          <span className="action-kicker">Reveal window</span>
          <h3>Unmask your theory</h3>
          <p>{entry?.revealed ? "Your accusation is visible on the public file." : localAccusation ? "Your saved key is ready. Reveal the exact suspect, theory and exhibits you committed." : "No saved key for this wallet. Create it again with the same wallet to reveal."}</p>
          {canReveal ? (
            <>
              <div className="reveal-summary">
                <span>{localAccusation?.suspectId}</span>
                <span>{localAccusation?.evidenceIds.join(" · ")}</span>
              </div>
              <button className="primary-button full-button" type="button" disabled={Boolean(busy)} onClick={() => void onReveal()}>{actionLabel(busy, "reveal", "Reveal accusation")}</button>
            </>
          ) : null}
        </div>
      ) : null}

      {caseFile.status === "OPEN" && entry && !entry.revealed ? <p className="desk-muted">The reveal window has not opened. Keep your key safe.</p> : null}
      {entriesOpen && !entry ? <p className="desk-muted">One entry per wallet. Your commitment is private until the reveal window.</p> : null}

      {caseFile.status === "RESOLVABLE" ? (
        <div className="desk-action-card resolver-card">
          <span className="action-kicker">Permissionless resolver</span>
          <h3>Ask the validators</h3>
          <p>Any wallet can trigger the independent evidence analysis. Attempts so far: {caseFile.resolution_attempts}. A temporary failure never moves the payout state or a deadline.</p>
          <button className="primary-button full-button" type="button" disabled={Boolean(busy) || isDemo || wrongNetwork} onClick={() => void onResolve()}>{actionLabel(busy, "resolve", "Request consensus verdict")}</button>
        </div>
      ) : null}

      {caseFile.status === "RESOLVED" ? (
        <div className="desk-action-card claim-card">
          <span className="action-kicker">Settlement</span>
          <h3>{settled ? "Settled" : nobodyWon ? "Nobody named the culprit" : iWon ? "Your share is ready" : "The verdict is recorded"}</h3>
          <p>
            {settled
              ? "This entry is settled. The transfer is released once the claim finalizes."
              : nobodyWon
                ? "No revealed accusation matched the final finding, so every entrant recovers their full stake."
                : iWon
                  ? "Correct accusers split the pool, weighted by how many of the validators' cited exhibits they picked."
                  : entry?.revealed
                    ? "Your accusation did not match the final finding, so your stake goes to the accusers who were right."
                    : "You did not reveal in time, so this entry forfeits its stake to the correct accusers."}
          </p>
          {canSettle ? (
            <button className="primary-button full-button" type="button" disabled={Boolean(busy) || isDemo || wrongNetwork} onClick={() => void onClaim()}>{actionLabel(busy, "claim", nobodyWon ? "Recover my stake" : "Claim my share")}</button>
          ) : null}
        </div>
      ) : null}

      {caseFile.status === "VOID" || caseFile.status === "CANCELLED" || caseFile.status === "REFUNDABLE" ? (
        <div className="desk-action-card refund-card">
          <span className="action-kicker">Return of stake</span>
          <h3>Refund is available</h3>
          <p>This terminal path never sends the pool to the curator. Each entrant withdraws their own escrow once.</p>
          {entry && !settled ? (
            <button className="secondary-button full-button" type="button" disabled={Boolean(busy) || isDemo || wrongNetwork} onClick={() => void onRefund()}>{actionLabel(busy, "refund", "Refund my entry")}</button>
          ) : null}
        </div>
      ) : null}

      {canCancel || canMakeRefundable ? (
        <div className="desk-action-card refund-card">
          <span className="action-kicker">Recovery</span>
          <h3>{canCancel ? "This case cannot fill" : "This case has run out of time"}</h3>
          <p>
            {canCancel
              ? `Only ${caseFile.player_count} of the ${caseFile.min_players} players needed entered before the deadline, so the case cannot be judged. Anyone can cancel it and release every stake.`
              : "The refund deadline has passed without a verdict. Anyone can open the refund branch so every entrant can withdraw their own stake."}
          </p>
          <button
            className="secondary-button full-button"
            type="button"
            disabled={Boolean(busy) || wrongNetwork}
            onClick={() => void (canCancel ? onCancelCase() : onMakeRefundable())}
          >
            {canCancel
              ? actionLabel(busy, "cancel", "Cancel case and release stakes")
              : actionLabel(busy, "makeRefundable", "Open refunds for everyone")}
          </button>
        </div>
      ) : null}

      {caseFile.status === "REVEAL" && !entry?.revealed && !localAccusation && wallet ? (
        <div className="desk-action-card">
          <span className="action-kicker">Recover your key</span>
          <h3>No saved key on this device</h3>
          <p>Create the key again with the same wallet, or restore the backup file you downloaded.</p>
          <button className="secondary-button full-button" type="button" onClick={() => void handleDeriveKey()}>
            Recreate key from wallet
          </button>
          <label className="import-label">
            <Upload size={14} aria-hidden="true" /> Restore from backup file
            <input type="file" accept="application/json" onChange={(event) => void handleImport(event.target.files?.[0])} />
          </label>
          {restored ? <p className="form-ok">{restored}</p> : null}
          {keyError ? <p className="form-error">{keyError}</p> : null}
        </div>
      ) : null}

      <div className="rubric-toggle">
        <button type="button" className="text-button" onClick={() => setShowRubric((visible) => !visible)}><ScaleMark /> {showRubric ? "Hide adjudication rubric" : "Read adjudication rubric"}</button>
        {showRubric ? <p>{caseFile.rubric}</p> : null}
      </div>
      {wallet ? <p className="wallet-footnote">Writes use {NETWORK_NAME}. GEN is testnet-only and has no real-value claim.</p> : null}
    </aside>
  );
}

function SparkleMark() { return <span className="sparkle-mark" aria-hidden="true">✦</span>; }
function ScaleMark() { return <span className="scale-mark" aria-hidden="true">◎</span>; }

function deadlineFor(caseFile: NoirCase): { label: string; unix: number } | null {
  if (caseFile.status === "OPEN") return { label: "Accusation window closes", unix: caseFile.accusation_deadline };
  if (caseFile.status === "REVEAL") return { label: "Reveal window closes", unix: caseFile.reveal_deadline };
  if (caseFile.status === "RESOLVABLE") return { label: "Resolution becomes eligible", unix: caseFile.resolution_eligibility_time };
  if (caseFile.status === "REFUNDABLE") return { label: "Refund branch opened", unix: caseFile.refund_deadline };
  return null;
}

function formatRemaining(seconds: number): string {
  if (seconds <= 0) return "Ready now";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${secs}s`;
}

function formatDeadline(unix: number): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(unix * 1000)) + " UTC";
}
