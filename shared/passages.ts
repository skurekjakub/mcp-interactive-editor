/**
 * @module
 *
 * Regions of the panel a human pointed at, with what they want said about each.
 *
 * Everything here is pure: the line arithmetic and the message formatting, which
 * is where the defects live. The two panes keep only the part that has to touch
 * a browser — reading the live selection — and hand the result to these.
 */
import type { DiffLineKind } from "./types.js";

/** A highlighted region and the comment attached to it. */
export interface Passage {
  /** Stable identity, so the same region cannot be attached twice. */
  id: string;
  /** Which pane it came from. The diff quotes disk lines; the editor, the draft. */
  source: "editor" | "diff";
  text: string;
  startLine: number;
  endLine: number;
  /**
   * What the human wants said about this specific region. A passage without one
   * is a quote with no question attached, which is why sending waits for it.
   */
  note?: string;
  /** Character range in the draft. Only meaningful when `source` is "editor". */
}

/** One rendered diff row, as the pane reports it. */
export interface SelectedRow {
  /** The number shown in the gutter: the new file's for an add, the old file's otherwise. */
  line: number;
  /** The new file's line number, when the row has one. */
  newLine: number | null;
  kind: DiffLineKind;
  text: string;
}

/**
 * Converts a character range in the draft into a passage.
 *
 * A selection dragged over whole lines includes the newline that ends the last
 * one. Counting that as a further line names a line the human did not select,
 * and that number is what reaches the agent.
 *
 * @param value - The full draft.
 * @param start - Character offset the selection begins at.
 * @param end - Character offset the selection ends at.
 * @returns The passage, or null for the empty selection a plain click produces.
 */
export function passageFromSelection(value: string, start: number, end: number): Passage | null {
  if (start === end) return null;

  const text = value.slice(start, end);
  const startLine = value.slice(0, start).split("\n").length;
  const measured = text.endsWith("\n") ? text.slice(0, -1) : text;

  return {
    id: `editor:${start}-${end}`,
    source: "editor",
    text,
    startLine,
    endLine: startLine + measured.split("\n").length - 1,
  };
}

/**
 * Converts the diff rows a selection touched into one passage.
 *
 * Rows carry their own text, so nothing here has to know that the rendered line
 * has a `+` or `-` glued to the front of it.
 *
 * The range is reported against the new file, because that is the file the human
 * is deciding about. Taking the first and last row's gutter numbers as they come
 * mixes the two files — dragging across a removal and its replacement is the
 * single most common thing to comment on, and produces a backwards range whose
 * two numbers are not even from the same file.
 *
 * @param rows - The touched rows, in document order.
 * @returns The passage, or null when nothing was selected.
 */
export function passageFromRows(rows: SelectedRow[]): Passage | null {
  if (rows.length === 0) return null;

  const numbered = rows
    .map((row) => (row.kind === "remove" ? row.newLine : (row.newLine ?? row.line)))
    .filter((n): n is number => typeof n === "number" && n > 0);

  // A selection of nothing but removals has no place in the new file at all, so
  // it can only be named by where it used to be.
  const fallback = rows.map((row) => row.line).filter((n) => n > 0);
  const candidates = numbered.length > 0 ? numbered : fallback;

  const startLine = candidates.length > 0 ? Math.min(...candidates) : 0;
  const endLine = candidates.length > 0 ? Math.max(...candidates) : 0;

  return {
    id: `diff:${startLine}-${endLine}`,
    source: "diff",
    text: rows.map((row) => row.text).join("\n"),
    startLine,
    endLine,
  };
}

/**
 * Names the lines a passage covers.
 *
 * @param passage - The passage to name.
 * @returns Either "line N" or "lines N–M".
 */
export function rangeOf(passage: Passage): string {
  const from = Math.min(passage.startLine, passage.endLine);
  const to = Math.max(passage.startLine, passage.endLine);
  return from === to ? `line ${from}` : `lines ${from}–${to}`;
}

/**
 * Adds a passage unless that exact region is already present.
 *
 * @param passages - The current set.
 * @param next - The passage to add.
 * @returns The set, with the passage added if it was new.
 */
export function attachPassage(passages: Passage[], next: Passage): Passage[] {
  return passages.some((p) => p.id === next.id) ? passages : [...passages, next];
}

/**
 * Replaces one passage's comment, leaving the rest alone.
 *
 * @param passages - The current set.
 * @param id - Which passage to annotate.
 * @param note - The comment to attach.
 * @returns A new set with that passage's note replaced.
 */
export function annotatePassage(passages: Passage[], id: string, note: string): Passage[] {
  return passages.map((p) => (p.id === id ? { ...p, note } : p));
}

/**
 * Orders passages by position in the file.
 *
 * Passages arrive in whatever order they were highlighted, so a reply about "the
 * first one" means nothing and the reader has to jump around the file to follow
 * their own question.
 *
 * @param passages - The set to order.
 * @returns The same passages in reading order.
 */
export function sortPassages(passages: Passage[]): Passage[] {
  return [...passages].sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
}

/**
 * Reports whether a passage carries a comment.
 *
 * @param passage - The passage to check.
 * @returns True when it has a non-empty note.
 */
export function isAnswered(passage: Passage): boolean {
  return (passage.note ?? "").trim().length > 0;
}

/**
 * Selects the passages still waiting for a comment.
 *
 * @param passages - The set to filter.
 * @returns Those without a comment.
 */
export function unanswered(passages: Passage[]): Passage[] {
  return passages.filter((p) => !isAnswered(p));
}

/**
 * Formats the message that reaches the agent.
 *
 * Every passage carries its line numbers, because a quote without them is a
 * snippet, and each carries its own comment directly beneath it — a pile of
 * quotes followed by a single paragraph leaves the reader guessing which remark
 * belongs to which region.
 *
 * @param path - The file being reviewed.
 * @param passages - The highlighted regions and their comments.
 * @param note - An optional remark about all of them together.
 * @returns The complete message.
 */
export function quotePassages(path: string, passages: Passage[], note: string): string {
  if (passages.length === 0) return note;

  const ordered = sortPassages(passages);
  const lines: string[] = [`From the draft open in the interactive editor — \`${path}\`:`];

  for (const passage of ordered) {
    const from = passage.source === "diff" ? " (from the diff)" : "";
    lines.push("", `${rangeOf(passage)}${from}:`, fence(passage.text));
    if (isAnswered(passage)) {
      // A blockquote, so the human's words are visibly theirs and not part of
      // the file they are quoting.
      lines.push(
        ...(passage.note ?? "")
          .trim()
          .split("\n")
          .map((l) => `> ${l}`),
      );
    }
  }

  if (note.trim().length > 0) lines.push("", note.trim());

  return lines.join("\n");
}

/**
 * Wraps text in a fence wide enough to survive its content.
 *
 * A passage of Markdown that itself contains a code fence would otherwise close
 * the quote early, and everything after it would read as instruction rather than
 * as the thing being quoted.
 *
 * @param text - The content to fence.
 * @returns The fenced block.
 */
function fence(text: string): string {
  const runs = text.match(/`+/g) ?? [];
  const longest = runs.reduce((widest, run) => Math.max(widest, run.length), 0);
  const ticks = "`".repeat(Math.max(3, longest + 1));
  return [ticks, text, ticks].join("\n");
}
