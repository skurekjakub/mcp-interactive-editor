/**
 * The end of a review that declined the draft.
 *
 * Worth its own screen rather than a toast: the tool call this panel was holding
 * open has now returned, so there is nothing left to edit here and a panel that
 * still looked editable would be lying about that.
 */
export function SentBack({ path }: { path: string }) {
  return (
    <div className="review">
      <div className="tag" data-state="held">
        <span className="tag-state">Sent back</span>
        <div className="tag-body">
          <div className="tag-path">{path}</div>
          <p className="tag-rationale">
            Your comments went back to Claude and nothing was written. It has been asked to redraft
            and propose again.
          </p>
        </div>
      </div>
    </div>
  );
}
