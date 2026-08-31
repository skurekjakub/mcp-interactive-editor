import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DEFAULT_DENY, FsGuard, sha256 } from "../../src/fsGuard.js";

let root: string;
let outside: string;
let guard: FsGuard;

beforeAll(async () => {
  const base = await mkdtemp(join(tmpdir(), "guard-"));
  root = join(base, "root");
  outside = join(base, "outside");
  await mkdir(root, { recursive: true });
  await mkdir(outside, { recursive: true });

  await writeFile(join(root, "inside.txt"), "inside\n", "utf8");
  await writeFile(join(outside, "secret.txt"), "secret\n", "utf8");

  guard = new FsGuard({ roots: [root], deny: DEFAULT_DENY, dryRun: false });
});

afterAll(async () => {
  await rm(resolve(root, ".."), { recursive: true, force: true });
});

describe("construction", () => {
  it("refuses to exist without a root", () => {
    expect(() => new FsGuard({ roots: [], deny: [], dryRun: false })).toThrow(
      /at least one --root/,
    );
  });
});

describe("resolving paths", () => {
  it("accepts a file inside the root and reports what is on disk", async () => {
    const target = await guard.describe(join(root, "inside.txt"));

    expect(target.absolute).toBeTruthy();
    expect(target.display).toBe("inside.txt");
    expect(target.exists).toBe(true);
    expect(target.onDisk).toMatchObject({ lines: 1, sha256: sha256("inside\n") });
  });

  it("accepts a file that does not exist yet", async () => {
    const target = await guard.describe(join(root, "nested", "deep", "new.txt"));

    expect(target.absolute).toBeTruthy();
    expect(target.exists).toBe(false);
    expect(target.onDisk).toBeUndefined();
  });

  it("resolves a relative path against the first root", async () => {
    const target = await guard.describe("inside.txt");
    expect(target.absolute).toBe((await guard.describe(join(root, "inside.txt"))).absolute);
  });

  it("rejects a path outside the root", async () => {
    const target = await guard.describe(join(outside, "secret.txt"));
    expect(target.absolute).toBeNull();
  });

  it("rejects traversal that climbs out of the root", async () => {
    const target = await guard.describe(join(root, "..", "outside", "secret.txt"));
    expect(target.absolute).toBeNull();
  });

  it("rejects an empty path", async () => {
    expect((await guard.describe("   ")).absolute).toBeNull();
  });

  /*
   * A rejection has to be renderable. The host mounts the panel on the tool
   * call, so a throw leaves it with no handle to claim and it spins until the
   * claim timeout instead of showing the reason.
   */
  it("rejects a directory without throwing, naming the reason", async () => {
    const target = await guard.describe(root);

    expect(target.absolute).toBeNull();
    expect(target.rejection).toBe("not-a-file");
  });

  it("distinguishes a denied path from one outside the roots", async () => {
    const denied = await guard.describe(join(root, ".env"));
    const outside = await guard.describe(join(root, "..", "elsewhere.txt"));

    expect(denied.rejection).toBe("denied");
    expect(denied.deniedBy).toBe(".env");
    expect(outside.rejection).toBe("outside-roots");
  });

  it("anchors deny patterns so ordinary files are not caught by substring", async () => {
    for (const name of ["shortcuts.keymap.ts", "notes.environment.md", "notes.pemberton.md"]) {
      const target = await guard.describe(join(root, name));
      expect(target.rejection, name).toBeUndefined();
      expect(target.absolute, name).toBeTruthy();
    }
  });
});

describe("the deny list", () => {
  it.each([
    [".env", "an env file at the root"],
    ["sub/.env", "an env file anywhere"],
    [".git/config", "anything in .git"],
    ["node_modules/pkg/index.js", "anything in node_modules"],
    [".ssh/known_hosts", "anything in .ssh"],
    ["deploy.pem", "certificates"],
    ["server.key", "keys"],
    ["id_rsa", "private keys by name"],
    [".aws/credentials", "cloud credentials"],
  ])("refuses %s (%s)", async (relative) => {
    const target = await guard.describe(join(root, relative));
    expect(target.absolute).toBeNull();
  });

  it("lets an ordinary file through", async () => {
    const target = await guard.describe(join(root, "src", "environment.ts"));
    expect(target.absolute).toBeTruthy();
  });

  it("can be dropped entirely when asked", async () => {
    const permissive = new FsGuard({ roots: [root], deny: [], dryRun: false });
    expect((await permissive.describe(join(root, ".env"))).absolute).toBeTruthy();
  });

  it("takes extra patterns", async () => {
    const strict = new FsGuard({ roots: [root], deny: [...DEFAULT_DENY, ".lock"], dryRun: false });
    expect((await strict.describe(join(root, "package.lock"))).absolute).toBeNull();
  });
});

describe("symlinks", () => {
  it("refuses a link inside the root that points outside it", async ({ skip }) => {
    const link = join(root, "escape-hatch.txt");
    try {
      await symlink(join(outside, "secret.txt"), link);
    } catch {
      // Windows needs developer mode or elevation to create symlinks.
      skip();
      return;
    }

    const target = await guard.describe(link);
    expect(target.absolute).toBeNull();
    await rm(link, { force: true });
  });

  /**
   * Regression: the roots have to be canonicalised the same way targets are.
   * When they were not, a root configured by any non-canonical spelling matched
   * nothing and the guard refused every write in it. Real cases are Windows 8.3
   * temp paths and macOS resolving /tmp into /private/tmp — this reproduces the
   * shape with a symlink, which is the same mismatch.
   */
  it("accepts a root given by a path that realpath rewrites", async ({ skip }) => {
    const linkedRoot = join(resolve(root, ".."), "root-by-another-name");
    try {
      await symlink(root, linkedRoot, "junction");
    } catch {
      skip();
      return;
    }

    const viaLink = new FsGuard({ roots: [linkedRoot], deny: DEFAULT_DENY, dryRun: false });
    const target = await viaLink.describe(join(linkedRoot, "inside.txt"));

    expect(
      target.absolute,
      "a root behind a symlink must still contain its own files",
    ).toBeTruthy();
    expect(target.exists).toBe(true);

    await rm(linkedRoot, { force: true, recursive: false });
  });
});

describe("writing", () => {
  it("creates missing parent directories and writes atomically", async () => {
    const target = await guard.describe(join(root, "a", "b", "c.txt"));
    const result = await guard.commit(target.absolute!, "written\n");

    expect(result.sha256).toBe(sha256("written\n"));
    expect(await readFile(join(root, "a", "b", "c.txt"), "utf8")).toBe("written\n");
  });

  it("leaves no temp files behind", async () => {
    const { readdir } = await import("node:fs/promises");
    const target = await guard.describe(join(root, "tidy.txt"));
    await guard.commit(target.absolute!, "tidy\n");

    const entries = await readdir(root);
    expect(entries.filter((e) => e.includes("interactive-editor.tmp"))).toHaveLength(0);
  });

  it("reads a missing file as empty rather than throwing", async () => {
    expect(await guard.read(join(root, "definitely-not-here.txt"))).toBe("");
  });

  it("removes a file", async () => {
    const path = join(root, "temporary.txt");
    await writeFile(path, "bye\n", "utf8");
    await guard.remove(path);
    await expect(readFile(path, "utf8")).rejects.toThrow(/ENOENT/);
  });
});

describe("dry run", () => {
  it("reports what would happen and changes nothing", async () => {
    const dry = new FsGuard({ roots: [root], deny: DEFAULT_DENY, dryRun: true });
    const path = join(root, "phantom.txt");

    const result = await dry.commit(path, "not real\n");
    expect(result.sha256).toBe(sha256("not real\n"));
    expect(result.bytes).toBe(9);
    await expect(readFile(path, "utf8")).rejects.toThrow(/ENOENT/);
  });

  it("does not delete either", async () => {
    const dry = new FsGuard({ roots: [root], deny: DEFAULT_DENY, dryRun: true });
    const path = join(root, "survivor.txt");
    await writeFile(path, "still here\n", "utf8");

    await dry.remove(path);
    expect(await readFile(path, "utf8")).toBe("still here\n");
  });
});
