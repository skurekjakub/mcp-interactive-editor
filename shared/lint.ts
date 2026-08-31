/**
 * @module
 *
 * Checks that run on every keystroke in the View, and again on the server before
 * a commit is accepted.
 *
 * The server copy is the one with authority; the View copy exists so a problem
 * shows before the button is reached for.
 */
import type { DiffStats, Finding, Proposal } from "./types.js";
import { splitLines } from "./diff.js";
import { rejectionDetail } from "./rejection.js";

/** Removing more than this share of an existing file needs an explicit tick. */
export const DESTRUCTIVE_DELETION_RATIO = 0.5;
/**
 * How much file there has to be before that share means anything.
 *
 * Editing the one line of a one-line file is not a total deletion in any sense a
 * person would recognise, and a checkbox in front of it trains the reflex to
 * tick without reading — the reflex the whole panel exists to prevent.
 */
const DESTRUCTIVE_MIN_LINES = 10;

/** How many lines have to go before the share is worth interrupting for. */
const DESTRUCTIVE_MIN_REMOVED = 5;
/** Above this, the editor stops being pleasant and the diff stops being readable. */
const LARGE_FILE_LINES = 5000;

const NUL = String.fromCharCode(0);

/**
 * Runs every check against a proposal.
 *
 * @param proposal - The proposal to check.
 * @param stats - How much it adds and removes.
 * @param roots - The configured writable roots, named when a path falls outside them.
 * @returns The findings, most severe first.
 */
export function lintProposal(proposal: Proposal, stats: DiffStats, roots: string[]): Finding[] {
  const findings: Finding[] = [
    ...lintTarget(proposal, roots),
    ...lintDestructiveness(proposal, stats),
    ...lintDiff(stats),
    ...lintContentHygiene(proposal),
  ];
  return findings.sort((a, b) => weight(b.severity) - weight(a.severity));
}

/**
 * Orders severities so the worst sorts first.
 *
 * @param severity - The severity to rank.
 * @returns A sortable weight.
 */
function weight(severity: Finding["severity"]): number {
  return severity === "blocker" ? 2 : severity === "warning" ? 1 : 0;
}

/**
 * Checks the path a proposal names.
 *
 * @param proposal - The proposal to check.
 * @param roots - The configured writable roots, named when a path falls outside them.
 * @returns Findings about the target itself.
 */
function lintTarget(proposal: Proposal, roots: string[]): Finding[] {
  const { target } = proposal;

  if (!target.absolute) {
    return [
      {
        id: "path-unresolved",
        rule: "path",
        severity: "blocker",
        message: `"${target.requested}" is not a path this server will write to.`,
        detail: rejectionDetail(target, roots),
      },
    ];
  }

  const findings: Finding[] = [];

  if (proposal.mode === "create" && target.exists) {
    findings.push({
      id: "create-exists",
      rule: "path",
      severity: "blocker",
      message: `${target.display} already exists.`,
      detail:
        "The proposal said this was a new file. Reopen it as an overwrite if that is what you want.",
    });
  }

  if (proposal.mode === "overwrite" && !target.exists) {
    findings.push({
      id: "overwrite-missing",
      rule: "path",
      severity: "warning",
      message: `${target.display} does not exist yet — this will create it.`,
    });
  }

  if (target.requested.includes("..")) {
    findings.push({
      id: "path-traversal",
      rule: "path",
      severity: "info",
      message: "The path contained `..` and was normalised before checking.",
      detail: `Resolved to ${target.absolute}`,
    });
  }

  return findings;
}

/**
 * Checks how much of the file a proposal removes.
 *
 * A write that mostly deletes is the failure mode worth interrupting for.
 *
 * @param proposal - The proposal to check.
 * @param stats - How much it adds and removes.
 * @returns Findings about destructiveness.
 */
function lintDestructiveness(proposal: Proposal, stats: DiffStats): Finding[] {
  const findings: Finding[] = [];
  const baselineLines = splitLines(proposal.baseline).length;

  if (proposal.mode === "delete") {
    findings.push({
      id: "delete",
      rule: "destructive",
      severity: proposal.destructiveAcknowledged ? "info" : "blocker",
      message: `This deletes ${proposal.target.display} (${baselineLines} lines).`,
      detail: proposal.destructiveAcknowledged
        ? "Acknowledged."
        : "Tick the box below to allow it.",
    });
    return findings;
  }

  if (baselineLines === 0) return findings;

  const ratio = stats.removed / baselineLines;
  if (
    baselineLines >= DESTRUCTIVE_MIN_LINES &&
    stats.removed >= DESTRUCTIVE_MIN_REMOVED &&
    ratio >= DESTRUCTIVE_DELETION_RATIO
  ) {
    const percent = Math.round(ratio * 100);
    findings.push({
      id: "large-deletion",
      rule: "destructive",
      severity: proposal.destructiveAcknowledged ? "info" : "blocker",
      message: `This removes ${stats.removed} of ${baselineLines} lines (${percent}%).`,
      detail: proposal.destructiveAcknowledged
        ? "Acknowledged."
        : "Read the diff, then tick the box below the editor if you mean it.",
    });
  }

  if (proposal.content.trim() === "" && baselineLines > 0) {
    findings.push({
      id: "emptied",
      rule: "destructive",
      severity: proposal.destructiveAcknowledged ? "info" : "blocker",
      message: `This empties ${proposal.target.display}.`,
    });
  }

  return findings;
}

/**
 * Checks whether the diff below can be trusted as a comparison.
 *
 * @param stats - How much the proposal adds and removes.
 * @returns Findings about the diff itself.
 */
function lintDiff(stats: DiffStats): Finding[] {
  const findings: Finding[] = [];

  if (stats.truncated) {
    findings.push({
      id: "diff-truncated",
      rule: "diff",
      severity: "warning",
      message: "Both versions are too large to diff line by line.",
      detail:
        "The diff below shows a wholesale replacement, not a real comparison. Read the content itself.",
    });
  }

  if (stats.newlineAtEofChanged) {
    findings.push({
      id: "newline-at-eof",
      rule: "diff",
      severity: "info",
      message: "Only the newline at the end of the file changes.",
      detail:
        "No line differs, so the diff below has nothing to show — but the bytes on disk do change.",
    });
  }

  return findings;
}

/**
 * Checks the small, fixable properties of the content.
 *
 * Every finding here carries the exact rewrite that resolves it.
 *
 * @param proposal - The proposal to check.
 * @returns Findings about the content, each with a fix.
 */
function lintContentHygiene(proposal: Proposal): Finding[] {
  const findings: Finding[] = [];
  const { content, baseline, mode } = proposal;

  if (mode === "delete") return findings;

  if (content !== "" && !content.endsWith("\n")) {
    findings.push({
      id: "no-final-newline",
      rule: "hygiene",
      severity: "info",
      message: "No trailing newline.",
      fix: { label: "Add one", content: `${content}\n` },
    });
  }

  const hasCrlf = content.includes("\r\n");
  const hasBareLf = /(?<!\r)\n/.test(content);
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

/**
 * Reports whether any finding forbids the write outright.
 *
 * @param findings - The findings to inspect.
 * @returns True when at least one is a blocker.
 */
export function hasBlockers(findings: Finding[]): boolean {
  return findings.some((f) => f.severity === "blocker");
}
