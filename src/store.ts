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
 * The store is therefore a directory rather than a map. Decided here: where that
 * directory is, and which files inside it an id may name. The three kinds of
 * record each have their own module: `store/records.ts` holds the proposals,
 * `store/claims.ts` the mutex a commit takes, and `store/tombstones.ts` the note
 * left behind when a record is dropped.
 */
import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";

/**
 * Bumped when the on-disk shape of a proposal changes.
 *
 * Two builds of this server can be installed at once and started against the
 * same roots, which would otherwise point them at one directory holding records
 * only one of them can read.
 */
const SCHEMA = "v1";

/** The kinds of record the store holds, each in its own directory. */
export type RecordKind = "proposals" | "locks" | "tombstones";

const KINDS: RecordKind[] = ["proposals", "locks", "tombstones"];

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
  return join(tmpdir(), `mcp-interactive-editor-${owner()}`, `${SCHEMA}-${key}`);
}

/**
 * Names the account this process runs under, for the store's parent directory.
 *
 * `tmpdir()` is one directory for every user on Linux, and the store is created
 * readable by its owner alone. A parent named for the account keeps a second
 * user on the same machine from finding the first one's directory in the way
 * and failing to start.
 *
 * @returns A short token that is stable for this account and safe in a path.
 */
function owner(): string {
  const uid = process.getuid?.();
  if (uid !== undefined) return String(uid);
  try {
    return userInfo().username.replace(/[^A-Za-z0-9_-]/g, "_");
  } catch {
    return "user";
  }
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
  for (const kind of KINDS) {
    await mkdir(join(at, kind), { recursive: true, mode: 0o700 });
  }
}

/**
 * Returns the directory holding one kind of record.
 *
 * @param kind - Which records.
 * @returns The absolute directory path.
 * @throws {Error} When the store was never configured, which is a wiring bug.
 */
export function storeDir(kind: RecordKind): string {
  if (!root) throw new Error("The proposal store was used before it was configured.");
  return join(root, kind);
}

/**
 * Reports whether an id has the shape this server issues.
 *
 * Ids reach the store from the panel, and a panel is a browser. A traversal in
 * the id would otherwise choose the file, so only the shape a UUID has is
 * accepted anywhere an id becomes a path.
 *
 * @param id - The candidate id.
 * @returns True when it is shaped like a UUID.
 */
export function isProposalId(id: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(id);
}

/**
 * Returns the path of one record.
 *
 * @param kind - Which kind of record.
 * @param id - The proposal's id.
 * @param suffix - An extension to append, when the record kind has one.
 * @returns The absolute path.
 * @throws {Error} When the id is not one this server could have issued.
 */
export function recordPath(kind: RecordKind, id: string, suffix = ""): string {
  if (!isProposalId(id)) throw new Error(`Not a proposal id: ${id}`);
  return join(storeDir(kind), `${id}${suffix}`);
}

/**
 * Empties the store.
 *
 * @returns A promise that settles once the directory is fresh again.
 * @remarks Exists for tests, which must not inherit proposals across cases.
 */
export async function clearStore(): Promise<void> {
  if (!root) throw new Error("The proposal store was used before it was configured.");
  const here = root;
  await rm(here, { recursive: true, force: true });
  await configureStore(here);
}
