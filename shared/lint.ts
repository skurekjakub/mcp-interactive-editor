/**
 * @module
 *
 * Checks that run on every keystroke in the View, and again on the server before
 * a commit is accepted.
 *
 * The server copy is the one with authority; the View copy exists so a problem
 * shows before the button is reached for. Each family of checks lives in its own
 * module under `lint/`; this one runs them all and orders what they found.
 */
import type { DiffStats, Finding, Proposal } from "./types.js";
import { lintDestructiveness } from "./lint/destructive.js";
import { lintDiff } from "./lint/diff.js";
import { lintContentHygiene } from "./lint/hygiene.js";
import { lintTarget } from "./lint/target.js";

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
 * Reports whether any finding forbids the write outright.
 *
 * @param findings - The findings to inspect.
 * @returns True when at least one is a blocker.
 */
export function hasBlockers(findings: Finding[]): boolean {
  return findings.some((f) => f.severity === "blocker");
}
