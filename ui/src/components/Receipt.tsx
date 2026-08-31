import type { CommitReceipt } from "../../../shared/types.js";

/** Properties of the receipt screen. */
interface ReceiptProps {
  receipt: CommitReceipt;
  /**
   * Anything that went wrong after the write landed.
   *
   * This screen replaces the whole review, so a failure raised on the way here —
   * telling the model what landed, for instance — has nowhere else to appear.
   */
  failure: string | null;
}

/**
 * Renders what actually landed.
 *
 * The panel's last word, after the door has shut.
 *
 * @param props - Component properties.
 * @param props.receipt - Proof of what was written.
 * @returns The receipt screen.
 */
export function Receipt({ receipt, failure }: ReceiptProps) {
  return (
    <div className="review">
      <div className="tag" data-state="committed">
        <span className="tag-state">{receipt.dryRun ? "Dry run" : "Written"}</span>
        <div className="tag-body">
          <div className="tag-path">{receipt.display}</div>
        </div>
        <div className="tag-meta">
          <span className="count-flat">{receipt.lines} lines</span>
        </div>
      </div>
      <div className="receipt">
        <div className="receipt-line">
          <span className="receipt-key">path</span>
          <span>{receipt.path}</span>
        </div>
        <div className="receipt-line">
          <span className="receipt-key">bytes</span>
          <span>{receipt.bytes}</span>
        </div>
        <div className="receipt-line">
          <span className="receipt-key">sha256</span>
          <span>{receipt.sha256.slice(0, 16)}…</span>
        </div>
        {receipt.editedByHuman ? (
          <p className="receipt-note">
            You changed the proposal before approving it. Claude has been told what actually landed,
            not what it wrote.
          </p>
        ) : null}
        {receipt.dryRun ? <p className="receipt-note">Dry run — nothing reached disk.</p> : null}
      </div>
      {failure ? <div className="status status-error">{failure}</div> : null}
    </div>
  );
}
