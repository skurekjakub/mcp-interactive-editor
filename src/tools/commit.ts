import type { CommitReceipt } from "../../shared/types.js";
import { hasBlockers } from "../../shared/lint.js";
import { sha256 } from "../fsGuard.js";
import { buildEditorState, getProposal, refreshTarget, updateProposal } from "../proposals.js";
import type { ToolContext } from "./context.js";

/**
 * The commit path. Everything the View asserted is checked again here, because
 * the View is a browser and this is the process that owns the disk.
 */
export async function commit(context: ToolContext, proposalId: string): Promise<CommitReceipt> {
  const { guard } = context;
  const before = getProposal(proposalId);

  if (before.committedAt) throw new Error("This proposal has already been resolved.");

  /*
   * The load-bearing check, and the reason `attached` is not enough on its own.
   *
   * `attached` is set by `editor_attach`, which is marked app-only — but that
   * marking is a request to the host, not a guarantee. A host that does not
   * implement MCP Apps hands every tool to the agent, including that one, so the
   * agent can set the flag itself and the review never happened. Asking the host
   * whether it can render the panel at all is the question that cannot be
   * answered by the party trying to get through the door.
   */
  if (!context.terminalApproval && !context.canRenderPanel()) {
    throw new Error(
      "This host does not render MCP Apps, so the editor never appeared and nobody has " +
        "seen this diff. Refusing to write. Start the server with --terminal-approval to " +
        "fall back to your client's own approve/deny prompt instead.",
    );
  }

  if (!before.attached) {
    // A write that no View ever rendered is a write no human ever saw.
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
