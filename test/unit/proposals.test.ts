import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FsGuard } from "../../src/fsGuard.js";
import {
  clearProposals,
  createProposal,
  findOpenProposal,
  getProposal,
  openProposals,
  resolveProposal,
} from "../../src/proposals.js";

let root: string;
let guard: FsGuard;

beforeAll(async () => {
  // Canonicalised: the guard resolves its roots, and macOS rewrites /var into
  // /private/var, so the raw temp path is not the path a target resolves to.
  root = await realpath(await mkdtemp(join(tmpdir(), "proposals-")));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "a.txt"), "original\n", "utf8");
  guard = new FsGuard({ roots: [root], deny: [], dryRun: true });
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

beforeEach(() => {
  clearProposals();
});

/** Open a write proposal against the fixture root. */
const propose = (path: string, content: string) =>
  createProposal(guard, { path, content, mode: "overwrite" });

describe("two drafts of one file", () => {
  it("supersedes the earlier one when the second names the file differently", async () => {
    // Arrange: the same file, once absolutely and once relative to the root. The
    // guard resolves a relative path against the root; the working directory is
    // somewhere else entirely, so anything that re-resolves the requested
    // spelling sees two different files.
    const first = await propose(join(root, "a.txt"), "FIRST\n");

    // Act.
    const second = await propose("a.txt", "SECOND\n");

    // Assert: both live would mean two approved writes to one file, the older
    // silently landing last and both reporting success.
    expect(getProposal(first.proposalId).resolution).toBe("superseded");
    expect(openProposals().map((p) => p.proposalId)).toEqual([second.proposalId]);
  });

  it("leaves a proposal for a different file alone", async () => {
    const other = await propose(join(root, "src", "b.txt"), "b\n");
    await propose("a.txt", "a\n");

    expect(getProposal(other.proposalId).resolvedAt).toBeUndefined();
  });

  it("does not supersede across a path that was refused", async () => {
    // Two unresolvable targets are not the same target, whatever they were
    // called: neither names a file, so neither can be a draft of the other.
    const first = await createProposal(guard, {
      path: join(root, "..", "outside-one.txt"),
      content: "x\n",
      mode: "overwrite",
    });
    await createProposal(guard, {
      path: join(root, "..", "outside-two.txt"),
      content: "y\n",
      mode: "overwrite",
    });

    expect(getProposal(first.proposalId).resolvedAt).toBeUndefined();
  });
});

describe("claiming a proposal by the path the host echoed back", () => {
  it("matches the exact spelling it was opened with", async () => {
    const opened = await propose("a.txt", "x\n");

    expect(findOpenProposal("a.txt")?.proposalId).toBe(opened.proposalId);
  });

  it("matches an absolute spelling of a proposal opened relatively", async () => {
    const opened = await propose("a.txt", "x\n");

    expect(findOpenProposal(join(root, "a.txt"))?.proposalId).toBe(opened.proposalId);
  });

  it("matches a relative spelling of a proposal opened absolutely", async () => {
    // The relative path is matched as a trailing segment rather than resolved,
    // because resolving anchors it to the working directory and the guard
    // anchored it to the root.
    const opened = await propose(join(root, "src", "b.txt"), "x\n");

    expect(findOpenProposal("src/b.txt")?.proposalId).toBe(opened.proposalId);
  });

  it("matches whichever separator the host chose", async () => {
    const opened = await propose(join(root, "src", "b.txt"), "x\n");

    expect(findOpenProposal("src\\b.txt")?.proposalId).toBe(opened.proposalId);
  });

  it("hands over the only open proposal when the path matches nothing", async () => {
    // A panel retrying a string it can never match dies on a loading screen.
    const opened = await propose("a.txt", "x\n");

    expect(findOpenProposal("whatever-the-host-said")?.proposalId).toBe(opened.proposalId);
  });

  it("guesses nothing when several are open and none match", async () => {
    // Handing over somebody else's proposal puts a human in front of the wrong
    // file. The retry finds the right one once it exists.
    await propose("a.txt", "x\n");
    await propose("src/b.txt", "y\n");

    expect(findOpenProposal("no-such-file.txt")).toBeUndefined();
  });

  it("skips a proposal that has already resolved", async () => {
    const opened = await propose("a.txt", "x\n");
    resolveProposal(opened.proposalId, "discarded");

    expect(findOpenProposal("a.txt")).toBeUndefined();
  });
});

describe("retention", () => {
  it("keeps every open proposal reachable up to the limit", async () => {
    for (let i = 0; i < 32; i += 1) await propose(`src/f${i}.txt`, "x\n");

    expect(openProposals()).toHaveLength(32);
  });

  it("tells a panel its proposal was superseded rather than that the id is unknown", async () => {
    // Arrange: overflow the store so the oldest open proposal is dropped.
    const first = await propose("src/f0.txt", "x\n");
    for (let i = 1; i <= 32; i += 1) await propose(`src/f${i}.txt`, "x\n");

    // Act & Assert: "unknown proposal" reads as a server restart, which is a
    // different problem with a different fix.
    expect(() => getProposal(first.proposalId)).toThrow(/superseded to make room/);
  });

  it("still reports a genuinely unknown id as unknown", () => {
    expect(() => getProposal("11111111-2222-3333-4444-555555555555")).toThrow(/previous run/);
  });

  it("drops resolved proposals before open ones", async () => {
    const keep = await propose("src/keep.txt", "x\n");
    for (let i = 0; i < 40; i += 1) {
      const spent = await propose(`src/spent${i}.txt`, "x\n");
      resolveProposal(spent.proposalId, "discarded");
    }

    expect(getProposal(keep.proposalId).resolvedAt).toBeUndefined();
  });
});

describe("the resolved target", () => {
  it("resolves a relative path against the root, not the working directory", async () => {
    const opened = await propose("a.txt", "x\n");

    expect(opened.target.absolute).toBe(join(root, "a.txt"));
    expect(opened.target.absolute).not.toBe(resolve("a.txt"));
  });

  it("reads the file on disk as the baseline", async () => {
    const opened = await propose("a.txt", "x\n");

    expect(opened.baseline).toBe("original\n");
  });

  it("has no baseline for a file that does not exist yet", async () => {
    const opened = await propose("src/brand-new.txt", "x\n");

    expect(opened.baseline).toBe("");
  });
});
