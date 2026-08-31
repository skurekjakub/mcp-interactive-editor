/**
 * @module
 *
 * One assembly of the state every surface paints from.
 *
 * The server builds it to answer a tool call, the preview builds it with no
 * server at all, and the panel rebuilds it on each keystroke against the text in
 * the box. Assembling it in one place is what keeps the findings a human reads
 * identical to the findings the commit is checked against — a divergence there
 * is invisible until the moment it refuses a write the panel called clean.
 */
import type { EditorState, Proposal } from "./types.js";
import { diffLines } from "./diff.js";
import { lintProposal } from "./lint.js";

/**
 * Reports the file body a proposal would leave on disk.
 *
 * A delete leaves nothing behind, so its `content` is not what lands and must
 * not be what the diff, the lint or the receipt measure.
 *
 * @param proposal - The proposal to read.
 * @returns The content after the write.
 */
export function proposedContent(proposal: Proposal): string {
  return proposal.mode === "delete" ? "" : proposal.content;
}

/** What differs between the surfaces that compose a state. */
export interface StateContext {
  roots: string[];
  dryRun: boolean;
  serverVersion: string;
}

/**
 * Assembles everything a paint needs from a proposal.
 *
 * @param proposal - The proposal being shown.
 * @param context - The roots, dry-run flag and version to stamp on it.
 * @returns The complete editor state.
 */
export function composeState(proposal: Proposal, context: StateContext): EditorState {
  const { hunks, stats } = diffLines(proposal.baseline, proposedContent(proposal));

  return {
    proposal,
    findings: lintProposal(proposal, stats, context.roots),
    diff: hunks,
    stats,
    roots: context.roots,
    dryRun: context.dryRun,
    serverVersion: context.serverVersion,
  };
}
