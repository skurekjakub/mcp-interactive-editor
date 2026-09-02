/**
 * @module
 *
 * Checks on whether the rendered diff can be trusted as a comparison.
 */
import type { DiffStats, Finding } from "../types.js";

/**
 * Checks whether the diff below can be trusted as a comparison.
 *
 * @param stats - How much the proposal adds and removes.
 * @returns Findings about the diff itself.
 */
export function lintDiff(stats: DiffStats): Finding[] {
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
    // The diff compares lines with their terminators stripped, so it cannot
    // show this change whether it arrives alone or alongside others. Alone, it
    // leaves an empty diff in front of a write that does alter the bytes.
    const alone = stats.added === 0 && stats.removed === 0;
    findings.push({
      id: "newline-at-eof",
      rule: "diff",
      severity: "info",
      message: alone
        ? "Only the newline at the end of the file changes."
        : "The newline at the end of the file changes as well.",
      detail: alone
        ? "No line differs, so the diff below has nothing to show — but the bytes on disk do change."
        : "The diff cannot show it: lines are compared without their terminators.",
    });
  }

  return findings;
}
