/**
 * @module
 *
 * Checks on how much of a file a proposal removes.
 *
 * A write that mostly deletes is the failure mode worth interrupting for, and
 * the interruption is a checkbox the human has to tick.
 */
import type { DiffStats, Finding, Proposal } from "../types.js";
import { splitLines } from "../diff.js";

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

/**
 * Checks how much of the file a proposal removes.
 *
 * @param proposal - The proposal to check.
 * @param stats - How much it adds and removes.
 * @returns Findings about destructiveness.
 */
export function lintDestructiveness(proposal: Proposal, stats: DiffStats): Finding[] {
  const findings: Finding[] = [];
  const baselineLines = splitLines(proposal.baseline).length;
  const acknowledged = proposal.destructiveAcknowledged;

  if (proposal.mode === "delete") {
    findings.push({
      id: "delete",
      rule: "destructive",
      severity: acknowledged ? "info" : "blocker",
      message: `This deletes ${proposal.target.display} (${baselineLines} lines).`,
      detail: acknowledged ? "Acknowledged." : "Tick the box below to allow it.",
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
      severity: acknowledged ? "info" : "blocker",
      message: `This removes ${stats.removed} of ${baselineLines} lines (${percent}%).`,
      detail: acknowledged
        ? "Acknowledged."
        : "Read the diff, then tick the box below the editor if you mean it.",
    });
  }

  if (proposal.content.trim() === "" && baselineLines > 0) {
    findings.push({
      id: "emptied",
      rule: "destructive",
      severity: acknowledged ? "info" : "blocker",
      message: `This empties ${proposal.target.display}.`,
    });
  }

  return findings;
}
