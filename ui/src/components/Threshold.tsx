import type { Finding } from "../../../shared/types.js";

/** Properties of the commit threshold. */
interface ThresholdProps {
  findings: Finding[];
  ack: boolean;
  onAck: (next: boolean) => void;
  isDelete: boolean;
  blocked: boolean;
  /**
   * Any comment at all means the draft is being declined, so committing is not
   * the thing being asked for. The two are exclusive on purpose.
   */
  hasComments: boolean;
  busy: boolean;
  /** False when the path itself was refused; there is nothing to commit to. */
  writable: boolean;
  unchanged: boolean;
  /** What the button says. Computed by the caller so this stays presentational. */
  label: string;
  onCommit: () => void;
  onDiscard: () => void;
}

/**
 * Renders the one-way door.
 *
 * Everything above it is reversible; this is the line. It says what is stopping
 * the write when something is, and nothing when nothing is.
 *
 * @param props - Component properties.
 * @param props.blocked - Whether a finding forbids the write outright.
 * @returns The acknowledgement row and the two actions.
 */
export function Threshold({
  findings,
  ack,
  onAck,
  isDelete,
  blocked,
  hasComments,
  busy,
  writable,
  unchanged,
  label,
  onCommit,
  onDiscard,
}: ThresholdProps) {
  const needsAck = findings.some((f) => f.rule === "destructive" && f.severity === "blocker");

  return (
    <div className="threshold">
      {needsAck ? (
        <label className="ack">
          <input type="checkbox" checked={ack} onChange={(e) => onAck(e.target.checked)} />
          <span>
            I have read the diff and I mean to{" "}
            {isDelete ? "delete this file" : "remove those lines"}.
          </span>
        </label>
      ) : blocked ? (
        <span className="blocked-why">
          {findings.find((f) => f.severity === "blocker")?.message}
        </span>
      ) : (
        <span />
      )}

      <div className="threshold-actions">
        <button className="btn btn-quiet" type="button" onClick={onDiscard} disabled={busy}>
          Discard
        </button>
        <button
          className={`commit${isDelete ? " commit-danger" : ""}`}
          type="button"
          onClick={onCommit}
          disabled={blocked || busy || unchanged || !writable || hasComments}
        >
          {busy
            ? "Working…"
            : hasComments
              ? "Send the comments instead"
              : unchanged
                ? "No changes to save"
                : label}
        </button>
      </div>
    </div>
  );
}
