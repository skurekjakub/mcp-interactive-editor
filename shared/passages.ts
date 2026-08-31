/**
 * A passage is a region of the panel the human pointed at, with what they wanted
 * to say about it, on its way to the chat.
 *
 * Everything here is pure: the line arithmetic and the message formatting, which
 * is where the bugs actually live. The two panes keep only the part that has to
 * touch a browser — reading the live selection — and hand the result to these.
 */

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
  start?: number;
  end?: number;
}

/** One rendered diff row, as the pane reports it. */
export interface SelectedRow {
  line: number;
  text: string;
}

/**
 * The editor's half: a character range in the draft becomes a passage. Returns
 * null for an empty selection, which is what a plain click produces.
 */
export function passageFromSelection(value: string, start: number, end: number): Passage | null {
  if (start === end) return null;

  const text = value.slice(start, end);
  const startLine = value.slice(0, start).split("\n").length;

  return {
    id: `editor:${start}-${end}`,
    source: "editor",
    start,
    end,
    text,
    startLine,
    endLine: startLine + text.split("\n").length - 1,
  };
}

/**
 * The diff pane's half: the rows a selection touched become one passage. The
 * rows already carry their own text, so nothing here has to know that the
 * rendered line has a +/- marker glued to the front of it.
 */
export function passageFromRows(rows: SelectedRow[]): Passage | null {
  if (rows.length === 0) return null;

  const startLine = rows[0].line;
  const endLine = rows[rows.length - 1].line;

  return {
    id: `diff:${startLine}-${endLine}`,
    source: "diff",
    text: rows.map((row) => row.text).join("\n"),
    startLine,
    endLine,
  };
}

export function rangeOf(passage: Passage): string {
  return passage.startLine === passage.endLine
    ? `line ${passage.startLine}`
    : `lines ${passage.startLine}–${passage.endLine}`;
}

/** "lines 3–9" while there is one, "3 passages" once there are several. */
export function describePassages(passages: Passage[]): string {
  if (passages.length === 0) return "nothing";
  if (passages.length === 1) return rangeOf(passages[0]);
  return `${passages.length} passages`;
}

/** Attach a passage, unless that exact region is already attached. */
export function attachPassage(passages: Passage[], next: Passage): Passage[] {
  return passages.some((p) => p.id === next.id) ? passages : [...passages, next];
}

/** Replace one passage's comment, leaving the rest alone. */
export function annotatePassage(passages: Passage[], id: string, note: string): Passage[] {
  return passages.map((p) => (p.id === id ? { ...p, note } : p));
}

/**
 * Reading order, not clicking order.
 *
 * These arrive in whatever order they were highlighted, so a reply about "the
 * first one" means nothing and the reader has to jump around the file to follow
 * their own question.
 */
export function sortPassages(passages: Passage[]): Passage[] {
  return [...passages].sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
}

export function isAnswered(passage: Passage): boolean {
  return (passage.note ?? "").trim().length > 0;
}

/** Which passages are still waiting for a comment. */
export function unanswered(passages: Passage[]): Passage[] {
  return passages.filter((p) => !isAnswered(p));
}

/**
 * The message that lands in the chat. Every passage carries its line numbers,
 * because a quote without them is just a snippet, and each one carries its own
 * comment directly beneath it — a pile of quotes followed by a single paragraph
 * leaves the reader guessing which remark belongs to which region.
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
 * A fence wide enough to survive its content. A passage of Markdown that itself
 * contains a code fence would otherwise close the quote early, and everything
 * after it would read as instruction rather than as the thing being quoted.
 */
function fence(text: string): string {
  const runs = text.match(/`+/g) ?? [];
  const longest = runs.reduce((widest, run) => Math.max(widest, run.length), 0);
  const ticks = "`".repeat(Math.max(3, longest + 1));
  return [ticks, text, ticks].join("\n");
}
