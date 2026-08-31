import type { DiffHunk } from "../../../shared/types.js";

interface DiffPaneProps {
  hunks: DiffHunk[];
  isNewFile: boolean;
}

/**
 * The diff recomputes on every keystroke against what is on disk, which is the
 * point of the whole View: you are not reviewing the model's proposal, you are
 * reviewing the file you are about to end up with.
 */
export function DiffPane({ hunks, isNewFile }: DiffPaneProps) {
  if (hunks.length === 0) {
    return (
      <div className="diff-empty">
        {isNewFile ? "New file — everything here is an addition." : "Identical to what is on disk."}
      </div>
    );
  }

  return (
    <div className="diff">
      {hunks.map((hunk, index) => (
        <div className="hunk" key={`${hunk.oldStart}-${hunk.newStart}-${index}`}>
          <div className="hunk-head">@@ line {hunk.newStart} @@</div>
          {hunk.lines.map((line, lineIndex) => (
            <div className="dline" data-kind={line.kind} key={lineIndex}>
              <span className="dline-no">{line.kind === "add" ? line.newLine : line.oldLine}</span>
              <span>
                {line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}
                {line.text === "" ? " " : line.text}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
