/**
 * @module
 *
 * The exclusive right to commit a proposal, arbitrated by the filesystem.
 *
 * `mkdir` fails rather than succeeds when the directory is already there, and it
 * does so atomically across processes. That is the whole mechanism: the loser is
 * told no by the filesystem instead of racing the winner to `rename`, which on
 * POSIX would leave one approved proposal written twice and reported twice.
 */
import { mkdir, rm, stat } from "node:fs/promises";
import { recordPath } from "../store.js";

/**
 * How long a claim may stand before it is taken to belong to a process that
 * died holding it.
 *
 * A claim is held for the few hundred milliseconds a write takes. One older
 * than this is a crash, and a proposal nobody can ever commit is the wrong way
 * to remember that crash.
 */
const STALE_CLAIM_MS = 60_000;

/**
 * Takes the exclusive right to commit a proposal.
 *
 * @param proposalId - The proposal to claim.
 * @returns True when this caller now holds the claim.
 * @throws {Error} When the id is not one this server could have issued.
 */
export async function claimForCommit(proposalId: string): Promise<boolean> {
  const lock = recordPath("locks", proposalId);
  if (await take(lock)) return true;
  if (!(await isStale(lock))) return false;

  await rm(lock, { recursive: true, force: true });
  return take(lock);
}

/**
 * Gives back a commit claim.
 *
 * @param proposalId - The proposal to release.
 * @returns A promise that settles once the claim is gone.
 * @throws {Error} When the id is not one this server could have issued.
 */
export async function releaseCommit(proposalId: string): Promise<void> {
  await rm(recordPath("locks", proposalId), { recursive: true, force: true });
}

/**
 * Attempts to create the lock directory.
 *
 * @param lock - The directory that is the claim.
 * @returns True when this call created it.
 */
async function take(lock: string): Promise<boolean> {
  try {
    await mkdir(lock, { mode: 0o700 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Reports whether a standing claim has outlived any write that could hold it.
 *
 * @param lock - The directory that is the claim.
 * @returns True when it is older than {@link STALE_CLAIM_MS}.
 */
async function isStale(lock: string): Promise<boolean> {
  try {
    const info = await stat(lock);
    return Date.now() - info.mtimeMs > STALE_CLAIM_MS;
  } catch {
    // Released between the failed take and this look, so it is not stale; the
    // caller reports the claim as taken and the panel retries.
    return false;
  }
}
