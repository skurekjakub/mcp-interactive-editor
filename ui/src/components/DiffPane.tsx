import { useCallback, useRef } from "react";
import type { DiffHunk } from "../../../shared/types.js";
import { passageFromRows, type Passage, type SelectedRow } from "../../../shared/passages.js";

interface DiffPaneProps {
  hunks: DiffHunk[];
  isNewFile: boolean;
  onSelect?: (passage: Passage | null) => void;
}

/**
 * The diff recomputes on every keystroke against what is on disk, which is the
 * point of the whole View: you are not reviewing the model's proposal, you are
 * reviewing the file you are about to end up with.
 */
export function DiffPane({ hunks, isNewFile, onSelect }: DiffPaneProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  const syncSelection = useCallback(() => {
    if (!onSelect) return;
    onSelect(passageFromRows(selectedRows(rootRef.current)));
  }, [onSelect]);

  if (hunks.length === 0) {
    return (
      <div className="diff-empty">
        {isNewFile ? "New file — everything here is an addition." : "Identical to what is on disk."}
      </div>
    );
  }

  return (
    <div className="diff" ref={rootRef} onMouseUp={syncSelection} onKeyUp={syncSelection}>
      {hunks.map((hunk, index) => (
        <div className="hunk" key={`${hunk.oldStart}-${hunk.newStart}-${index}`}>
          <div className="hunk-head">@@ line {hunk.newStart} @@</div>
          {hunk.lines.map((line, lineIndex) => (
            <div
              className="dline"
              data-kind={line.kind}
              data-line={line.kind === "add" ? line.newLine : line.oldLine}
              data-text={line.text}
              key={lineIndex}
            >
              <span className="dline-no">{line.kind === "add" ? line.newLine : line.oldLine}</span>
              <span>
                {line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}
                {line.text === "" ? " " : line.text}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * The only part of this pane that needs a browser: which rows does the live
 * selection touch? Each row was rendered carrying its own line number and text,
 * so nothing has to be parsed back out of the markup.
 */
function selectedRows(root: HTMLElement | null): SelectedRow[] {
  const selection = window.getSelection();
  if (!root || !selection || selection.isCollapsed || selection.rangeCount === 0) return [];

  const range = selection.getRangeAt(0);
  return Array.from(root.querySelectorAll<HTMLElement>(".dline"))
    .filter((row) => range.intersectsNode(row))
    .map((row) => ({ line: Number(row.dataset.line ?? 0), text: row.dataset.text ?? "" }));
}
