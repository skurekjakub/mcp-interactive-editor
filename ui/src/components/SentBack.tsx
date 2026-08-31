/** Properties of the terminal screen shown after a review that wrote nothing. */
interface SentBackProps {
  path: string;
  /** Which way the review ended, since the two need different words. */
  outcome: "commented" | "discarded";
}

/**
 * Renders the end of a review that declined the draft.
 *
 * Worth its own screen rather than a toast: the proposal has resolved, so there
 * is nothing left to edit and a panel that still looked editable would be lying
 * about that. Its commit button would be refused by the server anyway.
 *
 * @param props - Component properties.
 * @param props.path - The file that was not written.
 * @param props.outcome - Whether comments went back or the draft was dropped.
 * @returns The terminal screen.
 */
export function SentBack({ path, outcome }: SentBackProps) {
  const commented = outcome === "commented";
  return (
    <div className="review">
      <div className="tag" data-state="held">
        <span className="tag-state">{commented ? "Sent back" : "Discarded"}</span>
        <div className="tag-body">
          <div className="tag-path">{path}</div>
          <p className="tag-rationale">
            {commented
              ? "Your comments went back to Claude and nothing was written. It has been asked to redraft and propose again."
              : "Nothing was written. Claude has been told the proposal was discarded."}
          </p>
        </div>
      </div>
    </div>
  );
}
