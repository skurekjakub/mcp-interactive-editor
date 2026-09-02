import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { Proposal } from "../../shared/types.js";
import { clearStore, configureStore, storePathFor } from "../../src/store.js";
import { claimForCommit, releaseCommit } from "../../src/store/claims.js";
import { allProposals, readProposal, writeProposal } from "../../src/store/records.js";
import { pruneTombstones, readTombstone, writeTombstone } from "../../src/store/tombstones.js";

const ID = "11111111-2222-3333-4444-555555555555";
const OTHER = "22222222-3333-4444-5555-666666666666";

/** A stored proposal with the fields the store cares about. */
function proposal(proposalId: string, content: string): Proposal {
  return {
    proposalId,
    mode: "overwrite",
    target: {
      requested: "a.txt",
      absolute: "/root/a.txt",
      display: "a.txt",
      root: "/root",
      exists: true,
    },
    content,
    originalContent: content,
    baseline: "",
    attached: false,
    destructiveAcknowledged: false,
    createdAt: Date.now(),
  };
}

/**
 * Backdates a file so that it reads as having been written long ago.
 *
 * @param path - The file to age.
 */
async function age(path: string): Promise<void> {
  const then = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  await utimes(path, then, then);
}

let store: string;

beforeAll(async () => {
  store = await mkdtemp(join(tmpdir(), "store-"));
  await configureStore(store);
});

afterAll(async () => {
  await rm(store, { recursive: true, force: true });
});

beforeEach(async () => {
  await clearStore();
});

describe("where the store lives", () => {
  const identity = { roots: ["/b", "/a"], deny: [".env"], dryRun: false };

  it("brings siblings started with the same settings to one directory", () => {
    expect(storePathFor(identity)).toBe(storePathFor({ ...identity, roots: ["/a", "/b"] }));
  });

  it("keeps servers with different roots apart", () => {
    expect(storePathFor(identity)).not.toBe(storePathFor({ ...identity, roots: ["/a"] }));
  });

  it("keeps a dry run apart from a real one", () => {
    expect(storePathFor(identity)).not.toBe(storePathFor({ ...identity, dryRun: true }));
  });

  it("sits under a parent directory named for the account running it", () => {
    // Arrange & Act: the store is created readable by its owner alone, and on a
    // machine where every user shares one temp directory a parent that is not
    // named for the account is one the second user cannot create anything in.
    const parent = basename(dirname(storePathFor(identity)));

    // Assert.
    expect(parent).toMatch(/^mcp-interactive-editor-.+/);
  });
});

describe("records", () => {
  it("round-trips a proposal", async () => {
    await writeProposal(proposal(ID, "hello"));

    expect((await readProposal(ID))?.content).toBe("hello");
    expect((await allProposals()).map((p) => p.proposalId)).toEqual([ID]);
  });

  it("survives writes of one record landing together", async () => {
    // Arrange & Act: the panel's debounced sync and its pre-commit flush can
    // both be in flight at once, in one process, for one proposal. Windows
    // refuses to replace a file another rename is replacing at that instant,
    // and one pair collides only sometimes, so this lands enough of them that
    // a writer which gives up on the first refusal cannot pass.
    const contents = ["one", "two", "three", "four"];
    for (let round = 0; round < 25; round++) {
      await Promise.all(contents.map((c) => writeProposal(proposal(ID, c))));
    }

    // Assert: whichever landed last is whole, and no temp file survives.
    expect(contents).toContain((await readProposal(ID))?.content);
    const leftovers = (await readdir(join(store, "proposals"))).filter((n) => !n.endsWith(".json"));
    expect(leftovers).toEqual([]);
  });

  it("reads a missing record as absent", async () => {
    expect(await readProposal(ID)).toBeUndefined();
  });

  it("refuses an id that could name a file outside the store", async () => {
    // Arrange: the id arrives from a browser.
    const hostile = proposal("../../escape", "x");

    // Act & Assert: the write is refused outright, and the read finds nothing
    // rather than reading whatever sits at that path.
    await expect(writeProposal(hostile)).rejects.toThrow(/Not a proposal id/);
    expect(await readProposal("../../escape")).toBeUndefined();
  });
});

describe("the commit claim", () => {
  it("is held by one caller at a time", async () => {
    expect(await claimForCommit(ID)).toBe(true);
    expect(await claimForCommit(ID)).toBe(false);

    await releaseCommit(ID);
    expect(await claimForCommit(ID)).toBe(true);
  });

  it("is independent per proposal", async () => {
    await claimForCommit(ID);
    expect(await claimForCommit(OTHER)).toBe(true);
  });

  it("can be taken over once its holder has plainly died", async () => {
    // Arrange: a claim older than any write could hold it, left by a process
    // that crashed mid-commit.
    await claimForCommit(ID);
    await age(join(store, "locks", ID));

    // Act & Assert: without this the proposal can never be committed by anyone.
    expect(await claimForCommit(ID)).toBe(true);
  });

  it("refuses an id that could name a directory outside the store", async () => {
    await expect(claimForCommit("../../escape")).rejects.toThrow(/Not a proposal id/);
  });
});

describe("tombstones", () => {
  it("records how a dropped proposal ended", async () => {
    await writeTombstone(ID, "superseded");

    expect(await readTombstone(ID)).toBe("superseded");
    expect(await readTombstone(OTHER)).toBeUndefined();
  });

  it("forgets a tombstone old enough that no panel can still be asking", async () => {
    // Arrange.
    await writeTombstone(ID, "superseded");
    await writeTombstone(OTHER, "superseded");
    await age(join(store, "tombstones", ID));

    // Act.
    await pruneTombstones();

    // Assert: the fresh one is kept; the store does not grow without bound.
    expect(await readTombstone(ID)).toBeUndefined();
    expect(await readTombstone(OTHER)).toBe("superseded");
  });
});
