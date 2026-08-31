import type { Proposal } from "../../../shared/types.js";
import { countLines } from "../../../shared/diff.js";

/**
 * Names what the commit button will do.
 *
 * The label states what will be true afterwards rather than how big the change
 * was. "Write 15 lines to deploy.yml" is the fact being agreed to; the +/-
 * counts are already on the tag for anyone who wants them.
 *
 * @param proposal - The proposal being reviewed.
 * @param content - The draft as it stands on screen.
 * @param dryRun - Whether the server will simulate the write.
 * @returns The button text.
 */
export function commitLabel(proposal: Proposal, content: string, dryRun: boolean): string {
  const name = basename(proposal.target.display);
  if (proposal.mode === "delete") return `Delete ${name}`;
  if (dryRun) return `Simulate write to ${name}`;
  const lines = countLines(content);
  return `Write ${lines} ${lines === 1 ? "line" : "lines"} to ${name}`;
}

/**
 * Takes the file name from a path.
 *
 * @param path - A display path.
 * @returns Its last segment.
 */
export function basename(path: string): string {
  return path.split("/").pop() ?? path;
}
