/**
 * @module
 *
 * One account of what a commit did, for the model that proposed it.
 *
 * Two routes reach the model with this news — the tool result the panel's commit
 * returns, and the context update the panel pushes — and they are read as one
 * story. Wording them separately is how one of them ends up describing a payload
 * the other one carries.
 */
import type { CommitReceipt } from "./types.js";

/**
 * Describes what a commit actually did.
 *
 * @param receipt - Proof of what landed.
 * @returns One sentence naming the file, its size and whether a human changed it.
 */
export function describeCommit(receipt: CommitReceipt): string {
  const verb = receipt.mode === "delete" ? "Deleted" : "Wrote";
  const edited = receipt.editedByHuman
    ? " The human edited your proposal before approving it, so what landed is not what you wrote."
    : "";

  return (
    `${verb} ${receipt.display} (${receipt.lines} lines, ${receipt.bytes} bytes).` +
    (receipt.dryRun ? " DRY RUN — nothing reached disk." : "") +
    edited
  );
}

/**
 * Describes a commit and quotes what landed when a human rewrote it.
 *
 * Only the panel holds the committed body: it is stripped before a receipt
 * travels back through a blocking opener, so this is the one route that can
 * quote it, and the sentence promising it must appear on the same route.
 *
 * @param receipt - Proof of what landed, including its content.
 * @returns The description, followed by the file body when it differs.
 */
export function describeCommitWithContent(receipt: CommitReceipt): string {
  const description = describeCommit(receipt);
  if (!receipt.editedByHuman || receipt.content === undefined) return description;

  return `${description}\n\nWhat landed:\n\n${receipt.content}`;
}
