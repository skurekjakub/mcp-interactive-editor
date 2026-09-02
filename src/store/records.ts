/**
 * @module
 *
 * The proposal records themselves, one JSON file each.
 *
 * Every mutation is a whole-file replace through a rename, which is atomic
 * within a filesystem, so a sibling process reading a record never sees half of
 * it.
 */
import { randomUUID } from "node:crypto";
import { readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import type { Proposal } from "../../shared/types.js";
import { isProposalId, recordPath, storeDir } from "../store.js";

/** The extension a proposal record carries. */
const RECORD_SUFFIX = ".json";

/**
 * Reads one proposal.
 *
 * @param proposalId - Which proposal to read.
 * @returns The proposal, or undefined when no record exists.
 */
export async function readProposal(proposalId: string): Promise<Proposal | undefined> {
  if (!isProposalId(proposalId)) return undefined;

  try {
    const raw = await readFile(recordPath("proposals", proposalId, RECORD_SUFFIX), "utf8");
    return JSON.parse(raw) as Proposal;
  } catch {
    // A record being unreadable and a record being absent want the same answer:
    // the caller has no proposal, and says so in its own words.
    return undefined;
  }
}

/**
 * Writes a proposal, replacing any record already there.
 *
 * The temp name carries a random component as well as the pid. Two writes of
 * one record can be in flight in a single process at once — the panel's
 * debounced sync and its pre-commit flush — and a temp name they shared would
 * let the first rename take the file out from under the second.
 *
 * @param proposal - The proposal to store.
 * @returns A promise that settles once the record is durable.
 * @throws {Error} When the proposal's id is not one this server could have issued.
 */
export async function writeProposal(proposal: Proposal): Promise<void> {
  const target = recordPath("proposals", proposal.proposalId, RECORD_SUFFIX);
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(proposal), { encoding: "utf8", mode: 0o600 });
  await rename(temp, target);
}

/**
 * Reads every proposal in the store, oldest first.
 *
 * @returns The stored proposals, skipping any record that could not be read.
 */
export async function allProposals(): Promise<Proposal[]> {
  let names: string[];
  try {
    names = await readdir(storeDir("proposals"));
  } catch {
    return [];
  }

  const found = await Promise.all(
    names
      .filter((n) => n.endsWith(RECORD_SUFFIX))
      .map((n) => readProposal(n.slice(0, -RECORD_SUFFIX.length))),
  );

  return found
    .filter((p): p is Proposal => p !== undefined)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Removes a proposal's record.
 *
 * @param proposalId - Which proposal to forget.
 * @returns A promise that settles once the record is gone.
 * @throws {Error} When the id is not one this server could have issued.
 */
export async function deleteProposal(proposalId: string): Promise<void> {
  await rm(recordPath("proposals", proposalId, RECORD_SUFFIX), { force: true });
}
