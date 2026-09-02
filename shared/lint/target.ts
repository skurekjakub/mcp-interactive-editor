/**
 * @module
 *
 * Checks on the path a proposal names.
 */
import type { Finding, Proposal } from "../types.js";
import { rejectionDetail } from "../rejection.js";

/**
 * Checks the path a proposal names.
 *
 * @param proposal - The proposal to check.
 * @param roots - The configured writable roots, named when a path falls outside them.
 * @returns Findings about the target itself.
 */
export function lintTarget(proposal: Proposal, roots: string[]): Finding[] {
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

  if (climbs(target.requested)) {
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
 * Reports whether a path steps through a parent directory.
 *
 * Only a whole segment counts. A filename is free to contain consecutive dots,
 * so `notes..md` is an ordinary name rather than a traversal.
 *
 * @param path - The path as the model wrote it, in either separator style.
 * @returns True when some segment is exactly `..`.
 */
function climbs(path: string): boolean {
  return path.split(/[\\/]/).includes("..");
}
