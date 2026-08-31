import type { Proposal } from "../../../shared/types.js";

/**
 * The button says what will be true afterwards, not how big the change was.
 * "Write 15 lines to deploy.yml" is the fact you are agreeing to; the +/- counts
 * are already on the tag for anyone who wants them.
 */
export function commitLabel(proposal: Proposal, content: string, dryRun: boolean): string {
  const name = basename(proposal.target.display);
  if (proposal.mode === "delete") return `Delete ${name}`;
  if (dryRun) return `Simulate write to ${name}`;
  const lines = content === "" ? 0 : content.split("\n").length;
  return `Write ${lines} ${lines === 1 ? "line" : "lines"} to ${name}`;
}

export function basename(path: string): string {
  return path.split("/").pop() ?? path;
}
