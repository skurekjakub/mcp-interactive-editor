import type { Finding } from "../../../shared/types.js";

/** Properties of the findings list. */
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
 * Renders one row per finding, each carrying its fix where there is one.
 *
 * Reporting that line endings are wrong without offering to correct them is a
 * complaint rather than a review.
 *
 * @param props - Component properties.
 * @param props.findings - What the lint found, most severe first.
 * @returns The list, or nothing when there is nothing to say.
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
