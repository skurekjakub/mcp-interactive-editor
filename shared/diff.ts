/**
 * @module
 *
 * A line diff with no dependencies.
 *
 * The View runs inside a sandboxed iframe with no network and the server has to
 * agree with it exactly, so both sides run this same module rather than a
 * library one of them could not load.
 *
 * Strategy: trim the common prefix and suffix first — which collapses the usual
 * case of a small edit in a large file down to almost nothing — then run an LCS
 * over what is left. Anything still enormous after trimming falls back to a
 * whole-file replacement, flagged as truncated so the UI can say so.
 */
import type { DiffHunk, DiffLine, DiffStats } from "./types.js";

/**
 * Largest LCS table the panel will build, in cells.
 *
 * The table is `(n+1)*(m+1)` `Uint32` cells, so the product is what costs memory
 * and time. Bounding the product rather than each side keeps a lopsided diff
 * cheap: a short file against an enormous one is under any per-side limit and
 * still allocates gigabytes.
 */
const LCS_CELL_BUDGET = 1500 * 1500;

/** How many unchanged lines to keep either side of a change. */
const CONTEXT_LINES = 3;

/**
 * Splits text into its lines.
 *
 * A trailing newline terminates the last line rather than starting an empty one,
 * so `"a\nb\n"` is two lines. Treating the empty remainder as a line inflates
 * every count derived from it — the receipt, the on-disk size, the `@@` headers,
 * and the ratio that decides whether a write is destructive — and renders a
 * phantom empty row in the diff.
 *
 * @param text - The file contents, with either line ending.
 * @returns One entry per line, without terminators.
 */
export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Counts the lines in a piece of text.
 *
 * @param text - The file contents.
 * @returns The number of lines, counting a terminated final line once.
 */
export function countLines(text: string): number {
  return splitLines(text).length;
}

/**
 * Reports whether text ends with a line terminator.
 *
 * @param text - The file contents.
 * @returns True when the final line is terminated.
 */
export function endsWithNewline(text: string): boolean {
  return text.endsWith("\n");
}

/**
 * Diffs two files line by line.
 *
 * @param before - The file as it is on disk.
 * @param after - The file as it is proposed.
 * @returns Hunks ready to render, and the counts that describe them.
 */
export function diffLines(before: string, after: string): { hunks: DiffHunk[]; stats: DiffStats } {
  const a = splitLines(before);
  const b = splitLines(after);

  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;

  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const midA = a.slice(prefix, a.length - suffix);
  const midB = b.slice(prefix, b.length - suffix);

  // The table is what has to be afforded, not either side of it. Requiring both
  // sides to be over budget leaves the product unbounded: 1500 lines against
  // 1.5 million is under the per-side limit on one side and nine gigabytes of
  // Uint32 on the machine.
  const truncated = midA.length * midB.length > LCS_CELL_BUDGET;
  const middle: DiffLine[] = truncated
    ? wholesaleReplace(midA, midB, prefix)
    : lcsDiff(midA, midB, prefix);

  const lines: DiffLine[] = [
    ...a.slice(0, prefix).map((text, i) => line("equal", i + 1, i + 1, text)),
    ...middle,
    ...a
      .slice(a.length - suffix)
      .map((text, i) => line("equal", a.length - suffix + i + 1, b.length - suffix + i + 1, text)),
  ];

  /*
   * Adding or removing the final newline changes no line, so the LCS above sees
   * nothing. Recording it separately keeps the panel from reporting "no changes"
   * for a write that does in fact alter the bytes on disk.
   */
  const newlineChanged =
    before !== "" && after !== "" && endsWithNewline(before) !== endsWithNewline(after);

  const stats: DiffStats = {
    added: lines.filter((l) => l.kind === "add").length,
    removed: lines.filter((l) => l.kind === "remove").length,
    ...(truncated ? { truncated: true } : {}),
    ...(newlineChanged ? { newlineAtEofChanged: true } : {}),
  };

  return { hunks: toHunks(lines), stats };
}

/**
 * Builds one diff line.
 *
 * @param kind - Which side of the diff the line belongs to.
 * @param oldLine - Line number in the old file, or null when added.
 * @param newLine - Line number in the new file, or null when removed.
 * @param text - The line itself.
 * @returns The assembled diff line.
 */
function line(
  kind: DiffLine["kind"],
  oldLine: number | null,
  newLine: number | null,
  text: string,
): DiffLine {
  return { kind, oldLine, newLine, text };
}

/**
 * Represents a change as a complete removal followed by a complete insertion.
 *
 * @param a - Lines of the old file.
 * @param b - Lines of the new file.
 * @param offset - Line number the region starts at.
 * @returns Every old line removed, then every new line added.
 */
function wholesaleReplace(a: string[], b: string[], offset: number): DiffLine[] {
  return [
    ...a.map((text, i) => line("remove", offset + i + 1, null, text)),
    ...b.map((text, i) => line("add", null, offset + i + 1, text)),
  ];
}

/**
 * Walks a classic LCS table to produce a minimal edit script.
 *
 * @param a - Lines of the old file, already trimmed of common affixes.
 * @param b - Lines of the new file, already trimmed of common affixes.
 * @param offset - Line number the trimmed region starts at.
 * @returns The diff lines for that region.
 */
function lcsDiff(a: string[], b: string[], offset: number): DiffLine[] {
  const n = a.length;
  const m = b.length;
  const table: Uint32Array = new Uint32Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[at(i, j)] =
        a[i] === b[j]
          ? table[at(i + 1, j + 1)] + 1
          : Math.max(table[at(i + 1, j)], table[at(i, j + 1)]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push(line("equal", offset + i + 1, offset + j + 1, a[i]));
      i += 1;
      j += 1;
    } else if (table[at(i + 1, j)] >= table[at(i, j + 1)]) {
      out.push(line("remove", offset + i + 1, null, a[i]));
      i += 1;
    } else {
      out.push(line("add", null, offset + j + 1, b[j]));
      j += 1;
    }
  }
  while (i < n) {
    out.push(line("remove", offset + i + 1, null, a[i]));
    i += 1;
  }
  while (j < m) {
    out.push(line("add", null, offset + j + 1, b[j]));
    j += 1;
  }
  return out;
}

/**
 * Collapses long runs of unchanged lines into hunks with a few lines of context.
 *
 * @param lines - The complete diff, including unchanged lines.
 * @returns Only the regions worth showing.
 */
function toHunks(lines: DiffLine[]): DiffHunk[] {
  const changed = lines.map((l, i) => (l.kind === "equal" ? -1 : i)).filter((i) => i !== -1);
  if (changed.length === 0) return [];

  const ranges: Array<[number, number]> = [];
  for (const index of changed) {
    const start = Math.max(0, index - CONTEXT_LINES);
    const end = Math.min(lines.length - 1, index + CONTEXT_LINES);
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1] + 1) {
      last[1] = Math.max(last[1], end);
    } else {
      ranges.push([start, end]);
    }
  }

  return ranges.map(([start, end]) => {
    const slice = lines.slice(start, end + 1);
    return {
      oldStart: slice.find((l) => l.oldLine !== null)?.oldLine ?? 0,
      newStart: slice.find((l) => l.newLine !== null)?.newLine ?? 0,
      lines: slice,
    };
  });
}

/**
 * Renders hunks as unified-diff text.
 *
 * The output is intended to be readable and to apply cleanly, so a file whose
 * final line is unterminated carries the `\ No newline at end of file` marker
 * that `patch` and `git apply` expect.
 *
 * @param hunks - The regions to render.
 * @param label - File name to put in the header.
 * @param eof - Whether each side ends with a newline, when known.
 * @returns The unified diff, or a note that nothing changed.
 */
export function formatUnifiedDiff(
  hunks: DiffHunk[],
  label: string,
  eof?: { before: boolean; after: boolean },
): string {
  if (hunks.length === 0) return `(no changes to ${label})`;
  const out: string[] = [`--- ${label} (on disk)`, `+++ ${label} (proposed)`];

  hunks.forEach((hunk, hunkIndex) => {
    const oldCount = hunk.lines.filter((l) => l.kind !== "add").length;
    const newCount = hunk.lines.filter((l) => l.kind !== "remove").length;
    out.push(`@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@`);

    hunk.lines.forEach((entry, lineIndex) => {
      const marker = entry.kind === "add" ? "+" : entry.kind === "remove" ? "-" : " ";
      out.push(marker + entry.text);

      const lastOfAll = hunkIndex === hunks.length - 1 && lineIndex === hunk.lines.length - 1;
      if (!lastOfAll || !eof) return;
      const unterminated = entry.kind === "remove" ? !eof.before : !eof.after;
      if (unterminated) out.push("\\ No newline at end of file");
    });
  });

  return out.join("\n");
}
