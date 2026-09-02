/**
 * @module
 *
 * The note left behind when a proposal's record is dropped.
 *
 * The id outlives the proposal: a panel still on screen goes on asking about one
 * that has been dropped to make room. Without this the only honest answer is
 * that the id is unknown, which reads as a server restart and sends whoever is
 * debugging it somewhere else entirely.
 */
import { readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Resolution } from "../../shared/types.js";
import { isProposalId, recordPath, storeDir } from "../store.js";

/**
 * How long a tombstone is kept.
 *
 * Long enough that a panel left open overnight is still told what became of
 * its proposal; short enough that the directory does not grow without bound
 * under a server that lives for weeks.
 */
const TOMBSTONE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Records how a proposal ended, for after its record is gone.
 *
 * @param proposalId - The proposal being forgotten.
 * @param resolution - How it ended.
 * @returns A promise that settles once the marker is written.
 * @throws {Error} When the id is not one this server could have issued.
 */
export async function writeTombstone(proposalId: string, resolution: Resolution): Promise<void> {
  await writeFile(recordPath("tombstones", proposalId), resolution, {
    encoding: "utf8",
    mode: 0o600,
  });
}

/**
 * Reads how a forgotten proposal ended.
 *
 * @param proposalId - The proposal to ask about.
 * @returns Its resolution, or undefined when nothing was recorded.
 */
export async function readTombstone(proposalId: string): Promise<Resolution | undefined> {
  if (!isProposalId(proposalId)) return undefined;
  try {
    return (await readFile(recordPath("tombstones", proposalId), "utf8")) as Resolution;
  } catch {
    return undefined;
  }
}

/**
 * Removes tombstones old enough that no panel can still be asking about them.
 *
 * @param now - The current time, in milliseconds since the epoch.
 * @returns A promise that settles once the expired markers are gone.
 */
export async function pruneTombstones(now: number = Date.now()): Promise<void> {
  const dir = storeDir("tombstones");
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }

  await Promise.all(
    names.map(async (name) => {
      const path = join(dir, name);
      try {
        const info = await stat(path);
        if (now - info.mtimeMs > TOMBSTONE_TTL_MS) await rm(path, { force: true });
      } catch {
        // A sibling process pruning at the same moment removed it first.
      }
    }),
  );
}
