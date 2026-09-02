/**
 * @module
 *
 * Checks on the small, fixable properties of the content.
 *
 * Every finding here that can be fixed carries the exact rewrite that resolves
 * it, so the panel can offer the correction rather than only the complaint.
 */
import type { Finding, Proposal } from "../types.js";
import { splitLines } from "../diff.js";

/** Above this, the editor stops being pleasant and the diff stops being readable. */
const LARGE_FILE_LINES = 5000;

const NUL = String.fromCharCode(0);

/**
 * Checks the small, fixable properties of the content.
 *
 * @param proposal - The proposal to check.
 * @returns Findings about the content, each with a fix where one exists.
 */
export function lintContentHygiene(proposal: Proposal): Finding[] {
  const findings: Finding[] = [];
  const { content, baseline, mode } = proposal;

  if (mode === "delete") return findings;

  const hasCrlf = content.includes("\r\n");
  const hasBareLf = /(?<!\r)\n/.test(content);

  if (content !== "" && !content.endsWith("\n")) {
    // The terminator added has to match the ones already there. Appending a
    // bare LF to CRLF content resolves this finding by raising the mixed-endings
    // one, and a human applying fixes in order is walked in a circle.
    const terminator = hasCrlf && !hasBareLf ? "\r\n" : "\n";
    findings.push({
      id: "no-final-newline",
      rule: "hygiene",
      severity: "info",
      message: "No trailing newline.",
      fix: { label: "Add one", content: `${content}${terminator}` },
    });
  }

  if (hasCrlf && hasBareLf) {
    findings.push({
      id: "mixed-eol",
      rule: "hygiene",
      severity: "warning",
      message: "Mixed CRLF and LF line endings.",
      fix: { label: "Normalise to LF", content: content.replace(/\r\n/g, "\n") },
    });
  } else if (hasCrlf && baseline !== "" && !baseline.includes("\r\n")) {
    findings.push({
      id: "eol-mismatch",
      rule: "hygiene",
      severity: "warning",
      message: "CRLF endings, but the file on disk uses LF.",
      fix: { label: "Match the file", content: content.replace(/\r\n/g, "\n") },
    });
  } else if (!hasCrlf && hasBareLf && baseline.includes("\r\n") && !/(?<!\r)\n/.test(baseline)) {
    /*
     * The diff cannot show this one. Lines are compared with their terminators
     * stripped, so a file whose every line ending changes reads as no change at
     * all — an empty diff, no findings, and a live Save button that rewrites
     * every line in the file. Saying it here is the only thing standing between
     * that write and a human who was shown nothing.
     */
    findings.push({
      id: "eol-rewrite",
      rule: "hygiene",
      severity: "warning",
      message: "LF endings, but the file on disk uses CRLF.",
      detail:
        "Every line ending in the file would be rewritten. The diff compares lines without their terminators, so it cannot show this.",
      fix: { label: "Keep CRLF", content: content.replace(/\n/g, "\r\n") },
    });
  }

  const stripped = stripTrailingWhitespace(content);
  if (stripped !== content) {
    findings.push({
      id: "trailing-whitespace",
      rule: "hygiene",
      severity: "info",
      message: "Trailing whitespace on one or more lines.",
      fix: { label: "Strip it", content: stripped },
    });
  }

  const indentOnDisk = dominantIndent(baseline);
  const indentProposed = dominantIndent(content);
  if (indentOnDisk && indentProposed && indentOnDisk !== indentProposed) {
    findings.push({
      id: "indent-mismatch",
      rule: "hygiene",
      severity: "warning",
      message: `The file indents with ${indentOnDisk}, this proposal uses ${indentProposed}.`,
    });
  }

  if (content.includes(NUL)) {
    findings.push({
      id: "binary-content",
      rule: "hygiene",
      severity: "blocker",
      message: "The content contains null bytes.",
      detail: "This editor only writes text. Use a real file tool for binary.",
    });
  }

  const lineCount = splitLines(content).length;
  if (lineCount > LARGE_FILE_LINES) {
    findings.push({
      id: "very-large",
      rule: "hygiene",
      severity: "info",
      message: `${lineCount} lines — larger than this editor is comfortable with.`,
    });
  }

  return findings;
}

/**
 * Removes spaces and tabs from the end of every line.
 *
 * Scanned rather than matched with `/[ \t]+$/gm`. That pattern is quadratic on a
 * long run of spaces the line does not end with: the engine consumes the run,
 * fails the anchor, and gives one character back per attempt, from every offset.
 * Content is caller-supplied and this runs on every keystroke in the panel and
 * again on the server before a commit, so 40 KB of spaces on one line is enough
 * to stop both for minutes.
 *
 * @param text - The content to clean.
 * @returns The content with line terminators and their style untouched.
 */
function stripTrailingWhitespace(text: string): string {
  // The capture keeps the terminators in the array, at every odd index, so CRLF
  // and the final newline survive the rejoin exactly as they arrived.
  return text
    .split(/(\r?\n)/)
    .map((part, index) => (index % 2 === 0 ? trimLineEnd(part) : part))
    .join("");
}

/**
 * Removes spaces and tabs from the end of one line.
 *
 * @param line - The line, without its terminator.
 * @returns The line, trimmed on the right.
 */
function trimLineEnd(line: string): string {
  let end = line.length;
  while (end > 0 && (line[end - 1] === " " || line[end - 1] === "\t")) end -= 1;
  return end === line.length ? line : line.slice(0, end);
}

/**
 * Reports which indentation style a file mostly uses.
 *
 * @param text - The file contents.
 * @returns The dominant style, or null when neither clearly wins.
 */
function dominantIndent(text: string): "tabs" | "spaces" | null {
  let tabs = 0;
  let spaces = 0;
  for (const line of splitLines(text)) {
    if (/^\t/.test(line)) tabs += 1;
    else if (/^ {2,}/.test(line)) spaces += 1;
  }
  if (tabs === 0 && spaces === 0) return null;
  if (tabs > spaces * 2) return "tabs";
  if (spaces > tabs * 2) return "spaces";
  return null;
}
