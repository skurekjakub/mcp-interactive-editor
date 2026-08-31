/**
 * @module
 *
 * Where proposals live, so that more than one server process can see them.
 *
 * A stdio server is spawned by its host, and a host is free to spawn it more
 * than once: Claude Desktop runs two managers that each start every configured
 * server and leave both alive. The model's call lands on one of them and the
 * panel's calls land on the other, so a proposal held in one process's memory is
 * invisible to the process being asked to attach to it.
 *
 * The store is therefore a directory rather than a map. Every mutation is a
 * whole-file replace through a rename, which is atomic within a filesystem, and
 * the one operation that must happen exactly once takes a lock the filesystem
 * itself arbitrates.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Proposal, Resolution } from "../shared/types.js";

/**
 * Bumped when the on-disk shape of a proposal changes.
 *
 * Two builds of this server can be installed at once and started against the
 * same roots, which would otherwise point them at one directory holding records
 * only one of them can read.
 */
const SCHEMA = "v1";

/** Where this process reads and writes proposals. Set by {@link configureStore}. */
let root: string | undefined;

/**
 * Derives the directory two sibling processes will agree on.
 *
 * The siblings are spawned from one host entry, so their arguments are
 * identical and hashing those arguments is what makes them meet. Servers
 * started against different roots hash differently and stay apart, which is the
 * behaviour that matters: a proposal must never be claimable by a server that
 * was never allowed to write to it.
 *
 * @param identity - The settings that decide which server this is.
 * @returns An absolute directory path, not yet created.
 */
export function storePathFor(identity: {
  roots: string[];
  deny: string[];
  dryRun: boolean;
}): string {
  const canonical = JSON.stringify({
    roots: [...identity.roots].sort(),
    deny: [...identity.deny].sort(),
    dryRun: identity.dryRun,
  });
  const key = createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 16);
  return join(tmpdir(), "mcp-interactive-editor", `${SCHEMA}-${key}`);
}

/**
 * Points this process at a store directory and creates it.
 *
 * @param at - The directory to use, from {@link storePathFor} or a test.
 * @returns A promise that settles once the directory exists.
 */
export async function configureStore(at: string): Promise<void> {
  root = at;
  // 0o700 because the records carry file contents a human has not yet approved,
  // and on a shared machine `tmpdir()` is readable by everyone by default.
  await mkdir(join(at, "proposals"), { recursive: true, mode: 0o700 });
  await mkdir(join(at, "locks"), { recursive: true, mode: 0o700 });
  await mkdir(join(at, "tombstones"), { recursive: true, mode: 0o700 });
}

/**
 * Returns the configured store directory.
 *
 * @returns The directory every read and write below is relative to.
 * @throws {Error} When the store was never configured, which is a wiring bug.
 */
function dir(): string {
  if (!root) throw new Error("The proposal store was used before it was configured.");
  return root;
}

/**
 * Returns the file a proposal is kept in.
 *
 * @param proposalId - The proposal's id, which is a UUID this server generated.
 * @returns The absolute path of its record.
 */
function fileFor(proposalId: string): string {
  return join(dir(), "proposals", `${proposalId}.json`);
}

/**
 * Reads one proposal.
 *
 * @param proposalId - Which proposal to read.
 * @returns The proposal, or undefined when no record exists.
 */
export async function readProposal(proposalId: string): Promise<Proposal | undefined> {
  // Ids reach this from the panel, and a panel is a browser. A traversal in the
  // id would otherwise choose the file, so only the shape a UUID has is read.
  if (!/^[0-9a-f-]{36}$/i.test(proposalId)) return undefined;

  try {
    return JSON.parse(await readFile(fileFor(proposalId), "utf8")) as Proposal;
  } catch {
    // A record being unreadable and a record being absent want the same answer:
    // the caller has no proposal, and says so in its own words.
    return undefined;
  }
}

/**
 * Writes a proposal, replacing any record already there.
 *
 * The write lands on a temp file that is then renamed, because a sibling process
 * reading the record while it is being written would otherwise see half of it.
 *
 * @param proposal - The proposal to store.
 * @returns A promise that settles once the record is durable.
 */
export async function writeProposal(proposal: Proposal): Promise<void> {
  const target = fileFor(proposal.proposalId);
  const temp = `${target}.${process.pid}.tmp`;
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
    names = await readdir(join(dir(), "proposals"));
  } catch {
    return [];
  }

  const found = await Promise.all(
    names.filter((n) => n.endsWith(".json")).map((n) => readProposal(n.slice(0, -".json".length))),
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
 */
export async function deleteProposal(proposalId: string): Promise<void> {
  await rm(fileFor(proposalId), { force: true });
}

/**
 * Takes the exclusive right to commit a proposal.
 *
 * `mkdir` fails rather than succeeds when the directory is already there, and it
 * does so atomically across processes. That is the whole mechanism: the loser is
 * told no by the filesystem instead of racing the winner to `rename`, which on
 * POSIX would leave one approved proposal written twice and reported twice.
 *
 * @param proposalId - The proposal to claim.
 * @returns True when this caller now holds the claim.
 */
export async function claimForCommit(proposalId: string): Promise<boolean> {
  try {
    await mkdir(join(dir(), "locks", proposalId), { mode: 0o700 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Gives back a commit claim.
 *
 * @param proposalId - The proposal to release.
 * @returns A promise that settles once the claim is gone.
 */
export async function releaseCommit(proposalId: string): Promise<void> {
  await rm(join(dir(), "locks", proposalId), { recursive: true, force: true });
}

/**
 * Records how a proposal ended, for after its record is gone.
 *
 * The id outlives the proposal: a panel still on screen goes on asking about one
 * that has been dropped to make room. Without this the only honest answer is
 * that the id is unknown, which reads as a server restart and sends whoever is
 * debugging it somewhere else entirely.
 *
 * @param proposalId - The proposal being forgotten.
 * @param resolution - How it ended.
 * @returns A promise that settles once the marker is written.
 */
export async function writeTombstone(proposalId: string, resolution: Resolution): Promise<void> {
  await writeFile(join(dir(), "tombstones", proposalId), resolution, {
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
  if (!/^[0-9a-f-]{36}$/i.test(proposalId)) return undefined;
  try {
    return (await readFile(join(dir(), "tombstones", proposalId), "utf8")) as Resolution;
  } catch {
    return undefined;
  }
}

/**
 * Empties the store.
 *
 * @returns A promise that settles once the directory is fresh again.
 * @remarks Exists for tests, which must not inherit proposals across cases.
 */
export async function clearStore(): Promise<void> {
  const here = dir();
  await rm(here, { recursive: true, force: true });
  await configureStore(here);
}
