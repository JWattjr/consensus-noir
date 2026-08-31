"use client";

import { ArrowUpRight, CircleDot, FileSearch } from "lucide-react";
import { NETWORK_NAME, type NoirCase } from "@/lib/contract";

interface CaseRailProps {
  cases: NoirCase[];
  selectedId: string;
  onSelect: (caseId: string) => void;
}

function statusLabel(status: NoirCase["status"]): string {
  return status === "RESOLVABLE" ? "Awaiting verdict" : status.toLowerCase();
}

function caseLabel(item: NoirCase, featuredCaseId: string | undefined): string {
  if (item.case_id === featuredCaseId) return "Featured investigation";
  if (item.status === "RESOLVED") return "Consensus proof";
  if (item.status === "OPEN") return "Open investigation";
  return statusLabel(item.status);
}

export function CaseRail({ cases, selectedId, onSelect }: CaseRailProps) {
  const featuredCaseId = cases.find((item) => item.status === "OPEN")?.case_id;

  return (
    <aside className="case-rail" aria-label="Case discovery">
      <div className="rail-heading">
        <div>
          <span className="eyebrow">The docket</span>
          <h2>Open files</h2>
        </div>
        <FileSearch size={18} strokeWidth={1.5} aria-hidden="true" />
      </div>
      <p className="rail-note">Frozen evidence. Public reasoning. Validator verdicts.</p>
      <div className="case-list">
        {cases.map((item, index) => {
          const active = item.case_id === selectedId;
          return (
            <button
              key={item.case_id}
              type="button"
              className={`case-row${active ? " is-active" : ""}`}
              onClick={() => onSelect(item.case_id)}
              aria-pressed={active}
            >
              <span className="case-index">{String(index + 1).padStart(2, "0")}</span>
              <span className="case-row-copy">
                <strong>{item.title}</strong>
                <span>{caseLabel(item, featuredCaseId)}</span>
                <small>
                  <CircleDot size={10} aria-hidden="true" /> {statusLabel(item.status)}
                </small>
              </span>
              <ArrowUpRight className="case-arrow" size={15} aria-hidden="true" />
            </button>
          );
        })}
      </div>
      <div className="rail-footer">
        <span className="signal-dot" aria-hidden="true" />
        <span>{NETWORK_NAME}</span>
      </div>
    </aside>
  );
}
