import type { DiffHunk, TargetInfo } from "../../../shared/types.js";
import type { Passage } from "../../../shared/passages.js";
import type { SelectionAnchor } from "../lib/anchor.js";
import { Editor } from "./Editor.js";
import { DiffPane } from "./DiffPane.js";
import { ViewToggle, type View } from "./ViewToggle.js";

/** Properties of the two-pane review surface. */
interface ReviewPanesProps {
  view: View;
  onViewChange: (next: View) => void;
  content: string;
  onContentChange: (next: string) => void;
  /** Both panes report selections; whichever was last dragged in wins. */
  onSelect: (passage: Passage | null, anchor: SelectionAnchor | null, fromPointer: boolean) => void;
  hunks: DiffHunk[];
  target: TargetInfo;
  isDelete: boolean;
}

/**
 * Renders the draft on the left and what it does to the file on the right.
 *
 * The editor is never taken away while there is a draft: removing it leaves a
 * change that cannot be touched, and the point of the panel is that the draft
 * belongs to the human. In the diff-only view it shrinks instead, so the diff
 * gets the room while the text stays in reach.
 *
 * A delete has no draft to show and collapses to the diff alone. That pane then
 * has to stay visible whatever the view setting says, because the view toggle
 * lives in the pane headers — hiding both panes would take the control that
 * restores them off screen with them.
 *
 * @param props - Component properties.
 * @param props.view - Which panes the human has asked for.
 * @param props.isDelete - Whether the proposal removes the file.
 * @returns The review surface.
 */
export function ReviewPanes({
  view,
  onViewChange,
  content,
  onContentChange,
  onSelect,
  hunks,
  target,
  isDelete,
}: ReviewPanesProps) {
  const showEditor = !isDelete;
  const showDiff = isDelete || view !== "edit";
  const compactEditor = view === "diff";

  return (
    <div className="panes" data-single={String(!showEditor || !showDiff)}>
      {showEditor ? (
        <section className="pane" data-compact={String(compactEditor)}>
          <header className="pane-head">
            <span className="pane-title">Proposed — edit freely</span>
            <ViewToggle view={view} onChange={onViewChange} />
          </header>
          <div className="pane-scroll">
            <Editor value={content} onChange={onContentChange} onSelect={onSelect} />
          </div>
        </section>
      ) : null}

      {showDiff ? (
        <section className="pane">
          <header className="pane-head">
            <span className="pane-title">Against disk</span>
            {showEditor ? (
              <span className="pane-note">
                {target.exists ? `${target.onDisk?.lines ?? 0} lines now` : "new file"}
              </span>
            ) : (
              <ViewToggle view={view} onChange={onViewChange} />
            )}
          </header>
          <div className="pane-scroll">
            <DiffPane hunks={hunks} isNewFile={!target.exists} onSelect={onSelect} />
          </div>
        </section>
      ) : null}
    </div>
  );
}
