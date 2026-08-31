import { useCallback, useRef } from "react";
import type { DiffHunk, DiffLineKind } from "../../../shared/types.js";
import { passageFromRows, type Passage, type SelectedRow } from "../../../shared/passages.js";
import type { SelectionAnchor } from "../lib/anchor.js";

/** Properties of the diff pane. */
interface DiffPaneProps {
  hunks: DiffHunk[];
  isNewFile: boolean;
  onSelect?: (
    passage: Passage | null,
    anchor: SelectionAnchor | null,
    fromPointer: boolean,
  ) => void;
}

/**
 * Renders the diff against what is on disk.
 *
 * It recomputes on every keystroke, which is the point of the whole View: the
 * subject of the review is not the model's proposal but the file the human is
 * about to end up with.
 *
 * @param props - Component properties.
 * @param props.hunks - The regions to show.
 * @param props.isNewFile - Whether the target does not exist yet.
 * @returns The rendered diff.
 */
export function DiffPane({ hunks, isNewFile, onSelect }: DiffPaneProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  const syncSelection = useCallback(
    (fromPointer: boolean) => {
      if (!onSelect) return;
      onSelect(passageFromRows(selectedRows(rootRef.current)), liveSelectionAnchor(), fromPointer);
    },
    [onSelect],
  );

  if (hunks.length === 0) {
    return (
      // Handlers here too: an unchanged file still renders through this branch,
      // and a pane that silently ignores selections is worse than one that has
      // nothing to select.
      <div
        className="diff-empty"
        ref={rootRef}
        onMouseUp={() => syncSelection(true)}
        onKeyUp={() => syncSelection(false)}
      >
        {isNewFile ? "New file — everything here is an addition." : "Identical to what is on disk."}
      </div>
    );
  }

  return (
    <div
      className="diff"
      ref={rootRef}
      onMouseUp={() => syncSelection(true)}
      onKeyUp={() => syncSelection(false)}
    >
      {hunks.map((hunk, index) => (
        <div className="hunk" key={`${hunk.oldStart}-${hunk.newStart}-${index}`}>
          <div className="hunk-head">@@ line {hunk.newStart} @@</div>
          {hunk.lines.map((line, lineIndex) => (
            <div
              className="dline"
              data-kind={line.kind}
              data-line={line.kind === "add" ? line.newLine : line.oldLine}
              data-new-line={line.newLine ?? ""}
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
 * Reports which diff rows the live selection touches.
 *
 * The only part of this pane that needs a browser. Each row carries its own line
 * numbers and text as data attributes, so nothing is parsed back out of markup.
 *
 * @param root - The pane element to search within.
 * @returns The touched rows, in document order.
 */
function selectedRows(root: HTMLElement | null): SelectedRow[] {
  const selection = window.getSelection();
  if (!root || !selection || selection.isCollapsed || selection.rangeCount === 0) return [];

  const range = selection.getRangeAt(0);
  return Array.from(root.querySelectorAll<HTMLElement>(".dline"))
    .filter((row) => range.intersectsNode(row))
    .map((row) => ({
      line: Number(row.dataset.line ?? 0),
      newLine: row.dataset.newLine ? Number(row.dataset.newLine) : null,
      kind: (row.dataset.kind ?? "equal") as DiffLineKind,
      text: row.dataset.text ?? "",
    }));
}

/**
 * Reports where the selection sits on screen.
 *
 * This pane is real DOM, so the range knows its own rectangle.
 *
 * @returns Viewport coordinates for the selection, or null when there is none.
 */
function liveSelectionAnchor(): SelectionAnchor | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  const rect = selection.getRangeAt(0).getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return { top: rect.top, bottom: rect.bottom, left: rect.left };
}
