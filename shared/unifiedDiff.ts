/**
 * @module
 *
 * Renders hunks as the unified-diff text a model reads.
 *
 * The panel paints hunks directly. This rendering exists for the reader that
 * gets text, and it keeps to the format `patch` and `git apply` expect, so what
 * is read can also be applied.
 */
import type { DiffHunk, DiffLine } from "./types.js";
import { countLines, endsWithNewline } from "./diff.js";

/** The marker `patch` expects after a final line that lacks its terminator. */
const NO_NEWLINE_MARKER = "\\ No newline at end of file";

/** Both sides of the diff as text, so the renderer can tell where each one ends. */
export interface DiffSides {
  before: string;
  after: string;
}

/** Where each side ends, and whether that final line is terminated. */
interface FileEnds {
  oldLast: number;
  oldTerminated: boolean;
  newLast: number;
  newTerminated: boolean;
}

/**
 * Renders hunks as unified-diff text.
 *
 * A file whose final line is unterminated carries the `\ No newline at end of
 * file` marker after that line and nowhere else. A hunk that stops short of the
 * end of the file must not carry it: the marker would then describe a line
 * that is in fact terminated, and a patch built from the text would not apply.
 *
 * @param hunks - The regions to render.
 * @param label - File name to put in the header.
 * @param sides - The two files, when the marker should be rendered.
 * @returns The unified diff, or a note that nothing changed.
 */
export function formatUnifiedDiff(hunks: DiffHunk[], label: string, sides?: DiffSides): string {
  if (hunks.length === 0) return `(no changes to ${label})`;
  const out: string[] = [`--- ${label} (on disk)`, `+++ ${label} (proposed)`];
  const ends = sides ? fileEnds(sides) : null;

  for (const hunk of hunks) {
    const oldCount = hunk.lines.filter((l) => l.kind !== "add").length;
    const newCount = hunk.lines.filter((l) => l.kind !== "remove").length;
    out.push(`@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@`);

    for (const entry of hunk.lines) {
      out.push(markerFor(entry.kind) + entry.text);
      if (ends && isUnterminatedEnd(entry, ends)) out.push(NO_NEWLINE_MARKER);
    }
  }

  return out.join("\n");
}

/**
 * Chooses the prefix character for a line.
 *
 * @param kind - Which side of the diff the line belongs to.
 * @returns The one-character prefix.
 */
function markerFor(kind: DiffLine["kind"]): string {
  return kind === "add" ? "+" : kind === "remove" ? "-" : " ";
}

/**
 * Measures where each side of the diff ends.
 *
 * @param sides - The two files.
 * @returns The last line number of each, and whether it is terminated.
 */
function fileEnds(sides: DiffSides): FileEnds {
  return {
    oldLast: countLines(sides.before),
    oldTerminated: endsWithNewline(sides.before),
    newLast: countLines(sides.after),
    newTerminated: endsWithNewline(sides.after),
  };
}

/**
 * Reports whether a rendered line is the unterminated final line of its file.
 *
 * A line present on both sides is the end of both files, and the marker after
 * it says both are unterminated. When only one side lacks its newline the diff
 * has no way to render the difference, so nothing is emitted and the finding
 * about the trailing newline carries it instead.
 *
 * @param entry - The rendered line.
 * @param ends - Where each side ends.
 * @returns True when the marker belongs after this line.
 */
function isUnterminatedEnd(entry: DiffLine, ends: FileEnds): boolean {
  const endsOld = entry.oldLine === ends.oldLast && !ends.oldTerminated;
  const endsNew = entry.newLine === ends.newLast && !ends.newTerminated;
  switch (entry.kind) {
    case "remove":
      return endsOld;
    case "add":
      return endsNew;
    case "equal":
      return endsOld && endsNew;
  }
}
