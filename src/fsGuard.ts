import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { TargetInfo } from "../shared/types.js";

/**
 * Everything that decides whether a path is allowed to be touched at all.
 *
 * The rule is deliberately dumb and checkable: a path is writable only if, once
 * fully resolved (symlinks included), it sits inside one of the roots the
 * server was started with. There is no "unless", no escape hatch, and no flag
 * that turns it off — a review panel you can talk your way past is not a review panel.
 */
export interface GuardOptions {
  roots: string[];
  /** Substrings that disqualify a path outright, matched against the root-relative form. */
  deny: string[];
  dryRun: boolean;
}

export const DEFAULT_DENY = [
  ".git/",
  "node_modules/",
  ".env",
  ".ssh/",
  "id_rsa",
  ".pem",
  ".key",
  ".p12",
  ".pfx",
  "credentials",
  ".aws/",
  ".npmrc",
];

export class PathRejected extends Error {
  constructor(
    message: string,
    readonly reason: "outside-roots" | "denied" | "not-a-file" | "unreadable",
  ) {
    super(message);
    this.name = "PathRejected";
  }
}

export class FsGuard {
  readonly roots: string[];
  readonly dryRun: boolean;
  private readonly deny: string[];

  constructor(options: GuardOptions) {
    if (options.roots.length === 0) {
      throw new Error(
        "mcp-interactive-editor needs at least one --root. Refusing to start with none.",
      );
    }
    this.roots = options.roots.map((r) => resolve(r));
    this.deny = options.deny.map((d) => d.toLowerCase());
    this.dryRun = options.dryRun;
  }

  /**
   * Resolve a requested path against the roots.
   *
   * Symlinks are resolved on the deepest existing ancestor, so a link planted
   * inside a root that points outside it cannot be used to escape. A path that
   * fails any check comes back with `absolute: null` rather than throwing,
   * because the View needs to render the rejection, not crash on it.
   */
  async describe(requested: string): Promise<TargetInfo> {
    const rejected = (): TargetInfo => ({
      requested,
      absolute: null,
      display: requested,
      root: null,
      exists: false,
    });

    if (requested.trim() === "") return rejected();

    // Relative paths are interpreted against the first root, which is the only
    // sensible reading of "write to src/foo.ts" when several roots exist.
    const candidate = isAbsolute(requested)
      ? resolve(requested)
      : resolve(this.roots[0], requested);

    let real: string;
    try {
      real = await realpathDeepest(candidate);
    } catch {
      return rejected();
    }

    const root = this.roots.find((r) => contains(r, real)) ?? null;
    if (!root) return rejected();

    const rel = relative(root, real);
    if (this.isDenied(rel)) return rejected();

    let exists = false;
    let onDisk: TargetInfo["onDisk"];
    try {
      const info = await stat(real);
      if (info.isDirectory()) {
        throw new PathRejected(`${requested} is a directory.`, "not-a-file");
      }
      const body = await readFile(real, "utf8");
      exists = true;
      onDisk = {
        bytes: info.size,
        lines: body === "" ? 0 : body.split("\n").length,
        sha256: sha256(body),
        mtimeMs: info.mtimeMs,
      };
    } catch (error) {
      if (error instanceof PathRejected) throw error;
      // ENOENT is the normal case for a new file; anything else means we cannot
      // vouch for what is there, so treat it as unwritable.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return rejected();
    }

    return {
      requested,
      absolute: real,
      display: toPosix(rel) || toPosix(real),
      root,
      exists,
      onDisk,
    };
  }

  private isDenied(relativePath: string): boolean {
    const normalised = toPosix(relativePath).toLowerCase();
    if (normalised.startsWith("../")) return true;
    return this.deny.some((needle) =>
      needle.endsWith("/")
        ? normalised.startsWith(needle) || normalised.includes(`/${needle}`)
        : normalised.includes(needle),
    );
  }

  async read(absolute: string): Promise<string> {
    try {
      return await readFile(absolute, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw new PathRejected(`Cannot read ${absolute}.`, "unreadable");
    }
  }

  /**
   * Write via a temp file in the same directory, then rename. A rename inside
   * one filesystem is atomic, so a crash mid-write leaves the original intact
   * rather than half a file.
   */
  async commit(absolute: string, content: string): Promise<{ bytes: number; sha256: string }> {
    const bytes = Buffer.byteLength(content, "utf8");
    const digest = sha256(content);
    if (this.dryRun) return { bytes, sha256: digest };

    await mkdir(dirname(absolute), { recursive: true });
    const temp = join(dirname(absolute), `.${Date.now()}.interactive-editor.tmp`);
    await writeFile(temp, content, "utf8");
    try {
      await rename(temp, absolute);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
    return { bytes, sha256: digest };
  }

  async remove(absolute: string): Promise<void> {
    if (this.dryRun) return;
    await rm(absolute, { force: true });
  }
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** True when `child` is `parent` itself or sits underneath it. */
function contains(parent: string, child: string): boolean {
  if (parent === child) return true;
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * `realpath` on a path that does not exist yet throws, so walk up to the
 * deepest ancestor that does exist, resolve that, and re-append the rest.
 */
async function realpathDeepest(target: string): Promise<string> {
  const missing: string[] = [];
  let current = target;

  for (;;) {
    try {
      await access(current, constants.F_OK);
      const resolved = await realpath(current);
      return missing.length === 0 ? resolved : join(resolved, ...missing.reverse());
    } catch {
      const parent = dirname(current);
      if (parent === current) throw new Error(`Cannot resolve ${target}`);
      missing.push(current.slice(parent.length + 1));
      current = parent;
    }
  }
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}
