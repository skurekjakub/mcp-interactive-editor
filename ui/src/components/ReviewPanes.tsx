import type { DiffHunk, TargetInfo } from "../../../shared/types.js";
import type { Passage } from "../../../shared/passages.js";
import type { SelectionAnchor } from "../lib/anchor.js";
import { Editor } from "./Editor.js";
import { DiffPane } from "./DiffPane.js";
import { ViewToggle, type View } from "./ViewToggle.js";

interface ReviewPanesProps {
  view: View;
  onViewChange: (next: View) => void;
  content: string;
  onContentChange: (next: string) => void;
  /** Both panes report selections; whichever you last dragged in wins. */
  onSelect: (passage: Passage | null, anchor: SelectionAnchor | null) => void;
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
  /*
   * The editor is never taken away. "diff" used to remove it outright, which
   * left you looking at a change you could not touch — and the whole point of
   * the panel is that the draft is yours to edit. It now shrinks instead, so the
   * diff gets the room while the text stays in reach.
   */
  const showEditor = !isDelete;
  const showDiff = view !== "edit";
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
