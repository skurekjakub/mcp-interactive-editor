import type { CommitReceipt, Proposal } from "../../shared/types.js";
import { hasBlockers } from "../../shared/lint.js";
import { countLines } from "../../shared/diff.js";
import { sha256 } from "../hash.js";
import {
  buildEditorState,
  getProposal,
  isStale,
  resolveProposal,
  restatTarget,
  updateProposal,
} from "../proposals.js";
import { claimForCommit, releaseCommit } from "../store/claims.js";
import type { ToolContext } from "./context.js";

/**
 * Writes a proposal to disk, re-checking everything the View asserted.
 *
 * The View is a browser and this is the process that owns the disk, so nothing
 * arriving from it is trusted: containment, staleness and every blocker are
 * evaluated again here.
 *
 * @param context - Guard, visibility settings and the host capability probe.
 * @param proposalId - Which proposal to write.
 * @returns A receipt describing exactly what landed.
 * @throws {Error} When the proposal has resolved, was never reviewed, sits on an
 *   unwritable path, went stale, or still carries a blocking finding.
 * @gate Carries the "nobody commits what nobody saw" invariant.
 */
export async function commit(context: ToolContext, proposalId: string): Promise<CommitReceipt> {
  const opening = await getProposal(proposalId);
  if (opening.resolvedAt) {
    throw new Error(`This proposal was already ${opening.resolution ?? "resolved"}.`);
  }

  /*
   * Claim the proposal before anything else.
   *
   * `resolvedAt` is not set until the write has finished, several awaits below,
   * so two calls arriving together both read it as unset and both go on to
   * write. On POSIX the second rename overwrites the first atomically: one
   * approved proposal, two writes, two receipts saying it landed.
   *
   * The claim is a directory rather than a flag in memory because the second
   * caller is routinely in a different process — a host may run two copies of
   * this server and hand them the same proposal. `mkdir` is the arbiter both
   * processes share, and the panel's own busy flag could not do this job even
   * within one: that is React state, set a tick later than the click.
   */
  if (!(await claimForCommit(proposalId))) {
    throw new Error("This proposal is already being written. Wait for that to finish.");
  }
  try {
    // Re-read under the claim. Between the check above and the claim, the other
    // holder may have finished, and its receipt is the one that counts.
    const before = await getProposal(proposalId);
    if (before.resolvedAt) {
      throw new Error(`This proposal was already ${before.resolution ?? "resolved"}.`);
    }
    return await write(context, proposalId, before);
  } finally {
    await releaseCommit(proposalId);
  }
}

/**
 * Performs the write, once the proposal has been claimed.
 *
 * @param context - Guard, visibility settings and the host capability probe.
 * @param proposalId - Which proposal to write.
 * @param before - The proposal as it was when the claim was made.
 * @returns A receipt describing exactly what landed.
 * @throws {Error} When any re-checked condition refuses the write.
 */
async function write(
  context: ToolContext,
  proposalId: string,
  before: Proposal,
): Promise<CommitReceipt> {
  const { guard } = context;

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
  const { target, baseline } = await restatTarget(guard, before);

  // Bound once, so every write below is typed against the check rather than
  // asserting past it and depending on this guard staying above them.
  const absolute = target.absolute;
  if (!absolute) {
    throw new Error(`${target.requested} is not a writable path.`);
  }

  /*
   * Close the proposal on a staleness refusal rather than leaving it open.
   *
   * The re-read above is deliberately not stored, so a second attempt would
   * otherwise compare the same two values and refuse identically — but only for
   * as long as nothing persists the fresh baseline. Closing removes the question
   * entirely: the approved diff is gone, and the only way forward is a new
   * proposal against what is now on disk.
   */
  if (isStale(baseline, baselineAtOpen)) {
    await resolveProposal(proposalId, "superseded");
    throw new Error(
      `${target.display} changed on disk while the editor was open. ` +
        "The diff that was approved is not the diff that would be applied. " +
        "This proposal is closed; open a new one against the current file.",
    );
  }

  const proposal = await updateProposal(proposalId, { target, baseline });

  const findings = buildEditorState(guard, proposal).findings;
  if (hasBlockers(findings)) {
    const blockers = findings.filter((f) => f.severity === "blocker").map((f) => f.message);
    throw new Error(`Refusing to write:\n${blockers.map((b) => `  - ${b}`).join("\n")}`);
  }

  const result =
    proposal.mode === "delete"
      ? (await guard.remove(absolute), { bytes: 0, sha256: sha256("") })
      : await guard.commit(absolute, proposal.content, proposal.target.onDisk?.mode);

  await resolveProposal(proposalId, "committed");

  return {
    ok: true,
    path: absolute,
    display: proposal.target.display,
    mode: proposal.mode,
    bytes: result.bytes,
    lines: countLines(proposal.content),
    sha256: result.sha256,
    dryRun: guard.dryRun,
    editedByHuman: proposal.content !== proposal.originalContent,
    content: proposal.content,
  };
}
