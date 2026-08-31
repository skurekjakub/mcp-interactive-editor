import { randomUUID } from "node:crypto";
import type { EditorState, Proposal, WriteMode } from "../shared/types.js";
import { diffLines } from "../shared/diff.js";
import { lintProposal } from "../shared/lint.js";
import { FsGuard, sha256 } from "./fsGuard.js";

/**
 * Proposals live for the lifetime of the server process, and no longer. A
 * proposal that outlives the conversation that produced it is a proposal nobody
 * remembers approving.
 */
const proposals = new Map<string, Proposal>();

export async function createProposal(
  guard: FsGuard,
  input: { path: string; content: string; mode: WriteMode; rationale?: string },
): Promise<Proposal> {
  const target = await guard.describe(input.path);
  const baseline = target.absolute && target.exists ? await guard.read(target.absolute) : "";

  const proposal: Proposal = {
    proposalId: randomUUID(),
    mode: input.mode,
    target,
    content: input.mode === "delete" ? "" : input.content,
    originalContent: input.mode === "delete" ? "" : input.content,
    baseline,
    rationale: input.rationale,
    attached: false,
    destructiveAcknowledged: false,
  };

  proposals.set(proposal.proposalId, proposal);
  return proposal;
}

export function getProposal(proposalId: string): Proposal {
  const proposal = proposals.get(proposalId);
  if (!proposal) {
    throw new Error(
      `Unknown proposal ${proposalId}. It probably belongs to a previous run of the server.`,
    );
  }
  return proposal;
}

export function updateProposal(proposalId: string, patch: Partial<Proposal>): Proposal {
  const current = getProposal(proposalId);
  if (current.committedAt) {
    throw new Error("This proposal has already been committed. Open a new one.");
  }
  const next: Proposal = { ...current, ...patch, proposalId: current.proposalId };
  proposals.set(proposalId, next);
  return next;
}

/**
 * Re-stat the target and refresh the baseline. Called before every commit so a
 * file that changed under us is caught rather than silently clobbered.
 */
export async function refreshTarget(guard: FsGuard, proposal: Proposal): Promise<Proposal> {
  const target = await guard.describe(proposal.target.requested);
  const baseline = target.absolute && target.exists ? await guard.read(target.absolute) : "";
  return updateProposal(proposal.proposalId, { target, baseline });
}

/**
 * The stale check. If the file changed between the proposal opening and the
 * human pressing the button, the diff they approved is not the diff they would
 * be applying, so the commit is refused.
 */
export function isStale(proposal: Proposal, baselineAtOpen: string): boolean {
  return sha256(proposal.baseline) !== sha256(baselineAtOpen);
}

/** Assemble everything the View needs for a paint. */
export function buildEditorState(guard: FsGuard, proposal: Proposal): EditorState {
  const after = proposal.mode === "delete" ? "" : proposal.content;
  const { hunks, stats } = diffLines(proposal.baseline, after);

  return {
    proposal,
    findings: lintProposal(proposal, stats),
    diff: hunks,
    roots: guard.roots,
    dryRun: guard.dryRun,
  };
}

export function diffStatsFor(proposal: Proposal) {
  const after = proposal.mode === "delete" ? "" : proposal.content;
  return diffLines(proposal.baseline, after).stats;
}

/**
 * The newest proposal still open, optionally for one path.
 *
 * The panel mounts on the tool *call*, before the call returns, so it is handed
 * the arguments but not the id. This is how it claims the proposal it was opened
 * for. Newest-first because a second proposal on the same path supersedes the
 * one before it.
 */
export function findOpenProposal(path?: string): Proposal | undefined {
  const open = [...proposals.values()].filter(
    (p) => !p.committedAt && (path === undefined || p.target.requested === path),
  );
  return open[open.length - 1];
}
