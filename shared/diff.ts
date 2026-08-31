/**
 * A line diff with no dependencies, because the View has to run inside a
 * sandboxed iframe with no network and the server has to agree with it exactly.
 *
 * Strategy: trim the common prefix and suffix first — which collapses the usual
 * case of a small edit in a large file down to almost nothing — then run an LCS
 * over what is left. Anything still enormous after trimming falls back to a
 * whole-file replacement, flagged as truncated so the UI can say so.
 */
import type { DiffHunk, DiffLine, DiffStats } from "./types.js";

const LCS_LINE_BUDGET = 1500;
const CONTEXT_LINES = 3;

export function splitLines(text: string): string[] {
  if (text === "") return [];
  return text.replace(/\r\n/g, "\n").split("\n");
}

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

  const truncated = midA.length > LCS_LINE_BUDGET && midB.length > LCS_LINE_BUDGET;
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

  const stats: DiffStats = {
    added: lines.filter((l) => l.kind === "add").length,
    removed: lines.filter((l) => l.kind === "remove").length,
    ...(truncated ? { truncated: true } : {}),
  };

  return { hunks: toHunks(lines), stats };
}

function line(
  kind: DiffLine["kind"],
  oldLine: number | null,
  newLine: number | null,
  text: string,
): DiffLine {
  return { kind, oldLine, newLine, text };
}

function wholesaleReplace(a: string[], b: string[], offset: number): DiffLine[] {
  return [
    ...a.map((text, i) => line("remove", offset + i + 1, null, text)),
    ...b.map((text, i) => line("add", null, offset + i + 1, text)),
  ];
}

/** Classic LCS table walk. Bounded by LCS_LINE_BUDGET on both axes. */
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

/** Collapse long runs of unchanged lines into hunks with a few lines of context. */
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

/** Unified-diff text, for hosts that cannot render the editor and for copy buttons. */
export function formatUnifiedDiff(hunks: DiffHunk[], label: string): string {
  if (hunks.length === 0) return `(no changes to ${label})`;
  const out: string[] = [`--- ${label} (on disk)`, `+++ ${label} (proposed)`];
  for (const hunk of hunks) {
    const oldCount = hunk.lines.filter((l) => l.kind !== "add").length;
    const newCount = hunk.lines.filter((l) => l.kind !== "remove").length;
    out.push(`@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@`);
    for (const line of hunk.lines) {
      const marker = line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " ";
      out.push(marker + line.text);
    }
  }
  return out.join("\n");
}
