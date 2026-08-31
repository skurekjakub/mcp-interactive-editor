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
  /**
   * A highlight is still waiting for its comment, so sending would drop it.
   *
   * Said out loud rather than left to a button that does nothing: commenting
   * has already taken committing away, and a send that silently declines to
   * happen leaves both doors shut with no indication which one to open.
   */
  commentsIncomplete: boolean;
  onSendComments: () => void;
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
  commentsIncomplete,
  onSendComments,
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
        {/*
          With comments pinned this is the send, not the commit. It is the only
          action left at this point, so it has to perform one: a button wearing
          the send's label while wired to the commit is a press that does nothing.
        */}
        <button
          className={`commit${isDelete ? " commit-danger" : ""}`}
          type="button"
          onClick={hasComments ? onSendComments : onCommit}
          disabled={busy || (hasComments ? commentsIncomplete : blocked || unchanged || !writable)}
        >
          {busy
            ? "Working…"
            : hasComments
              ? commentsIncomplete
                ? "Comment on every highlight to send"
                : "Send the comments instead"
              : unchanged
                ? "No changes to save"
                : label}
        </button>
      </div>
    </div>
  );
}
