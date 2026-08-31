import type { DiffHunk, TargetInfo } from "../../../shared/types.js";
import type { Passage } from "../../../shared/passages.js";
import { Editor } from "./Editor.js";
import { DiffPane } from "./DiffPane.js";
import { ViewToggle, type View } from "./ViewToggle.js";

interface ReviewPanesProps {
  view: View;
  onViewChange: (next: View) => void;
  content: string;
  onContentChange: (next: string) => void;
  /** Both panes report selections; whichever you last dragged in wins. */
  onSelect: (passage: Passage | null) => void;
  hunks: DiffHunk[];
  target: TargetInfo;
  isDelete: boolean;
}

/**
 * The draft on the left, what it does to the file on the right. A delete has no
 * draft to show, so it collapses to the diff alone.
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
  const showEditor = !isDelete && view !== "diff";
  const showDiff = view !== "edit";

  return (
    <div className="panes" data-single={String(!showEditor || !showDiff)}>
      {showEditor ? (
        <section className="pane">
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
