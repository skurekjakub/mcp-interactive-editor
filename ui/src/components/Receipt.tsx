import type { CommitReceipt } from "../../../shared/types.js";

/** What actually landed. The panel's last word, after the door has shut. */
export function Receipt({ receipt }: { receipt: CommitReceipt }) {
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
    </div>
  );
}
