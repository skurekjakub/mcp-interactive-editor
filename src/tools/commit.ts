import type { CommitReceipt } from "../../shared/types.js";
import { hasBlockers } from "../../shared/lint.js";
import { FsGuard, sha256 } from "../fsGuard.js";
import { buildEditorState, getProposal, refreshTarget, updateProposal } from "../proposals.js";

/**
 * The commit path. Everything the View asserted is checked again here, because
 * the View is a browser and this is the process that owns the disk.
 */
export async function commit(guard: FsGuard, proposalId: string): Promise<CommitReceipt> {
  const before = getProposal(proposalId);

  if (before.committedAt) throw new Error("This proposal has already been resolved.");
  if (!before.attached) {
    // Reachable only if a host ignores `visibility`. Refuse anyway: a write that
    // no View ever rendered is a write no human ever saw.
    throw new Error("This proposal was never opened in the editor. Refusing to write.");
  }

  const baselineAtOpen = before.baseline;
  const proposal = await refreshTarget(guard, before);

  if (!proposal.target.absolute) {
    throw new Error(`${proposal.target.requested} is not a writable path.`);
  }

  if (sha256(proposal.baseline) !== sha256(baselineAtOpen)) {
    throw new Error(
      `${proposal.target.display} changed on disk while the editor was open. ` +
        "The diff that was approved is no longer the diff that would be applied. Reopen the proposal.",
    );
  }

  const findings = buildEditorState(guard, proposal).findings;
  if (hasBlockers(findings)) {
    const blockers = findings.filter((f) => f.severity === "blocker").map((f) => f.message);
    throw new Error(`Refusing to write:\n${blockers.map((b) => `  - ${b}`).join("\n")}`);
  }

  const result =
    proposal.mode === "delete"
      ? (await guard.remove(proposal.target.absolute), { bytes: 0, sha256: sha256("") })
      : await guard.commit(proposal.target.absolute, proposal.content);

  updateProposal(proposalId, { committedAt: new Date().toISOString() });

  return {
    ok: true,
    path: proposal.target.absolute,
    display: proposal.target.display,
    mode: proposal.mode,
    bytes: result.bytes,
    lines: proposal.content === "" ? 0 : proposal.content.split("\n").length,
    sha256: result.sha256,
    dryRun: guard.dryRun,
    editedByHuman: proposal.content !== proposal.originalContent,
    content: proposal.content,
  };
}
