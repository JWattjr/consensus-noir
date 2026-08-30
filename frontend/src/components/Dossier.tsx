"use client";

import { ExternalLink, Fingerprint, Link2, Scale, Sparkles } from "lucide-react";
import { formatGen } from "@/lib/contract";
import type { NoirCase } from "@/lib/contract";

interface DossierProps {
  caseFile: NoirCase;
}

function evidenceClass(index: number): string {
  return `evidence-card evidence-tone-${(index % 4) + 1}`;
}

function sourceLabel(source: string): string {
  try {
    return new URL(source).hostname;
  } catch {
    return source.slice(0, 34);
  }
}

export function Dossier({ caseFile }: DossierProps) {
  const resolution = caseFile.resolution;
  const namedSuspect = resolution?.culprit_id
    ? caseFile.suspects.find((suspect) => suspect.id === resolution.culprit_id)
    : null;

  return (
    <section className="dossier" aria-labelledby="case-title">
      <div className="dossier-topline">
        <span className="eyebrow">Case file / {caseFile.case_id}</span>
        <span className={`status-chip status-${caseFile.status.toLowerCase()}`}>
          <span className="status-pip" aria-hidden="true" /> {caseFile.status}
        </span>
      </div>
      <div className="dossier-hero">
        <div>
          <p className="hero-kicker">A public investigation in three acts</p>
          <h1 id="case-title">{caseFile.title}</h1>
          <p className="hero-premise">{caseFile.premise}</p>
        </div>
        <div className="case-seal" aria-label="Consensus Noir case seal">
          <span>CN</span>
          <small>FILE<br />{caseFile.case_id.slice(0, 4).toUpperCase()}</small>
        </div>
      </div>

      <div className="case-stats" aria-label="Case facts">
        <div><span>Entries</span><strong>{caseFile.player_count}/{caseFile.max_players}</strong></div>
        <div><span>Pool</span><strong>{formatGen(caseFile.total_escrow_wei, 2)} GEN</strong></div>
        <div><span>Evidence</span><strong>{caseFile.evidence.length} items</strong></div>
        <div><span>Rubric</span><strong>Published</strong></div>
      </div>

      <article className="incident-block">
        <div className="section-marker"><Fingerprint size={15} aria-hidden="true" /> Incident report</div>
        <p>{caseFile.incident}</p>
        <div className="question-line"><Scale size={16} aria-hidden="true" /><span>{caseFile.question}</span></div>
      </article>

      <div className="dossier-grid">
        <section className="dossier-section suspect-section">
          <div className="section-heading">
            <div><span className="eyebrow">Persons of interest</span><h2>Suspects</h2></div>
            <span className="section-count">0{caseFile.suspects.length}</span>
          </div>
          <div className="suspect-grid">
            {caseFile.suspects.map((suspect, index) => {
              const statement = caseFile.statements.find((item) => item.suspect_id === suspect.id);
              const isCulprit = resolution?.culprit_id === suspect.id && resolution.status === "FINAL";
              return (
                <article className={`suspect-card${isCulprit ? " suspect-card-winner" : ""}`} key={suspect.id}>
                  <div className="suspect-card-top"><span className="suspect-number">0{index + 1}</span><span className="suspect-id">{suspect.id}</span></div>
                  <h3>{suspect.name}</h3>
                  <p>{suspect.profile}</p>
                  {statement ? <blockquote>“{statement.text}”<cite>{statement.id}</cite></blockquote> : null}
                  {isCulprit ? <span className="culprit-ribbon"><Sparkles size={12} aria-hidden="true" /> Validator finding</span> : null}
                </article>
              );
            })}
          </div>
        </section>

        <section className="dossier-section timeline-section">
          <div className="section-heading"><div><span className="eyebrow">The night in question</span><h2>Timeline</h2></div></div>
          <ol className="timeline">
            {caseFile.timeline.map((item) => (
              <li key={item.id}><time>{item.at}</time><span className="timeline-line" aria-hidden="true" /><div><strong>{item.event}</strong><small>{item.id}</small></div></li>
            ))}
          </ol>
        </section>
      </div>

      <section className="dossier-section evidence-section">
        <div className="section-heading">
          <div><span className="eyebrow">Exhibits / frozen at publication</span><h2>Evidence board</h2></div>
          <span className="evidence-legend"><span className="legend-dot" /> admissible material</span>
        </div>
        <div className="evidence-grid">
          {caseFile.evidence.map((item, index) => {
            const cited = resolution?.material_evidence_ids.includes(item.id);
            return <article className={`${evidenceClass(index)}${cited ? " evidence-cited" : ""}`} key={item.id}>
              <div className="evidence-card-top"><span>{item.id}</span>{cited ? <Sparkles size={14} aria-label="Cited by validators" /> : <Link2 size={13} aria-hidden="true" />}</div>
              <p>{item.summary}</p>
              {cited ? <small>Supporting consensus evidence</small> : null}
            </article>;
          })}
        </div>
        {caseFile.source_urls.length > 0 ? <div className="source-list"><span>Source trail</span>{caseFile.source_urls.map((source) => <a href={source} target="_blank" rel="noreferrer" key={source}>{sourceLabel(source)}<ExternalLink size={12} aria-hidden="true" /></a>)}</div> : null}
      </section>

      {resolution ? <section className={`verdict-card verdict-${resolution.status.toLowerCase()}`} aria-live="polite">
        <div className="verdict-icon"><Sparkles size={18} aria-hidden="true" /></div>
        <div><span className="eyebrow">GenLayer consensus record</span><h2>{resolution.status === "FINAL" && namedSuspect ? `${namedSuspect.name} is the accepted finding` : resolution.status === "VOID" ? "The file is underdetermined" : "Validators need another attempt"}</h2><p className="verdict-verified">Validators agreed on the suspect and the cited evidence. These decide the payout.</p><p className="verdict-unverified">Leader notes, not consensus-checked: reason <code>{resolution.reason_code}</code> · confidence {resolution.confidence_bucket}</p></div>
      </section> : null}

      {caseFile.status === "RESOLVED" || caseFile.status === "VOID" ? <section className="dossier-section theory-section">
        <div className="section-heading"><div><span className="eyebrow">After the reveal</span><h2>Player theories</h2></div><span className="theory-note">Reasoning is shown for audit, never scored</span></div>
        <div className="theory-list">
          {caseFile.entries.filter((entry) => entry.revealed && entry.theory).map((entry) => <article className="theory-card" key={entry.player}><div className="theory-meta"><span>{entry.player.slice(0, 6)}…{entry.player.slice(-4)}</span><strong>{entry.suspect_id}</strong></div><p>{entry.theory}</p></article>)}
          {caseFile.entries.filter((entry) => entry.revealed && entry.theory).length === 0 ? <p className="empty-state">No revealed theories have landed on the dossier yet.</p> : null}
        </div>
      </section> : null}
    </section>
  );
}
