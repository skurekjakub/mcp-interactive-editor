import type { Finding } from "../../../shared/types.js";

interface FindingsProps {
  findings: Finding[];
  onApplyFix: (finding: Finding) => void;
}

const LABEL: Record<Finding["severity"], string> = {
  blocker: "Blocks",
  warning: "Check",
  info: "Note",
};

/**
 * One row per finding, and every row that can be fixed carries the fix. Telling
 * someone their line endings are wrong without offering to correct them is just
 * a complaint.
 */
export function Findings({ findings, onApplyFix }: FindingsProps) {
  if (findings.length === 0) return null;

  return (
    <div className="findings">
      {findings.map((finding) => (
        <div className="finding" data-sev={finding.severity} key={finding.id}>
          <span className="finding-sev">{LABEL[finding.severity]}</span>
          <span className="finding-msg">
            {finding.message}
            {finding.detail ? <span className="finding-detail">{finding.detail}</span> : null}
          </span>
          {finding.fix ? (
            <button className="btn" type="button" onClick={() => onApplyFix(finding)}>
              {finding.fix.label}
            </button>
          ) : (
            <span />
          )}
        </div>
      ))}
    </div>
  );
}
