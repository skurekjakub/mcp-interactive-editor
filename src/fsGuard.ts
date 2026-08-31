import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { PathRejection, TargetInfo } from "../shared/types.js";
import { countLines } from "../shared/diff.js";

/**
 * Settings that decide which paths may be touched at all.
 *
 * The rule is deliberately dumb and checkable: a path is writable only if, once
 * fully resolved (symlinks included), it sits inside one of the roots the server
 * was started with. There is no "unless", no escape hatch, and no flag that
 * turns it off — a review panel that can be talked past is not a review panel.
 */
export interface GuardOptions {
  roots: string[];
  /** Patterns that disqualify a path, matched against the root-relative form. */
  deny: string[];
  dryRun: boolean;
}

/**
 * Paths refused before any content is considered.
 *
 * A pattern ending in `/` matches a directory segment. A pattern beginning with
 * `.` matches a whole filename, a filename with a suffix after it, or an
 * extension. Anything else matches a whole filename. Matching is anchored rather
 * than by substring, so `shortcuts.keymap.ts` is not caught by `.key`.
 */
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

/**
 * Largest file the editor will load, in bytes.
 *
 * The whole file is held as a string several times over — on disk, proposed, and
 * original — and a review of something this large is not a review anyone can
 * perform. Above the cap the path is refused with a reason rather than read,
 * because building the string is itself the failure.
 */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;

/** A path that cannot be used, carrying which check refused it. */
class PathRejected extends Error {
  constructor(
    message: string,
    readonly reason: PathRejection | "unreadable",
  ) {
    super(message);
    this.name = "PathRejected";
  }
}

/** Resolution, containment and the only code in the server that writes. */
export class FsGuard {
  readonly roots: string[];
  readonly dryRun: boolean;
  private readonly deny: string[];
  private canonicalRoots?: string[];

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
   * Resolves the configured roots to their canonical spellings.
   *
   * Roots have to be canonicalised the same way targets are, or containment
   * compares two different spellings of one directory and refuses everything.
   * Windows hands out 8.3 short paths for temp directories that `realpath`
   * expands, and macOS resolves `/tmp` and `/var` into `/private`.
   *
   * @returns The canonical root paths.
   */
  private async resolveRoots(): Promise<string[]> {
    if (this.canonicalRoots) return this.canonicalRoots;

    let complete = true;
    const resolved = await Promise.all(
      this.roots.map(async (root) => {
        try {
          return await realpath(root);
        } catch {
          complete = false;
          return root;
        }
      }),
    );

    // Only memoise once every root resolved. Caching a fallback spelling makes a
    // root that appears later permanently unmatchable, which is the exact
    // failure the canonicalisation exists to prevent.
    if (complete) this.canonicalRoots = resolved;
    return resolved;
  }

  /**
   * Resolves a requested path against the roots.
   *
   * Symlinks are resolved on the deepest existing ancestor, so a link planted
   * inside a root pointing outside it cannot be used to escape.
   *
   * Every failure returns `absolute: null` with a `rejection` naming the check
   * that refused it, rather than throwing. The View renders the refusal, and a
   * caller that cannot tell "outside the roots" from "matched the deny list"
   * reports a file inside the project as being outside it.
   *
   * @param requested - Path as the model supplied it, absolute or root-relative.
   * @returns The resolved target, or a rejection naming the failed check.
   */
  async describe(requested: string): Promise<TargetInfo> {
    const rejected = (reason: PathRejection, deniedBy?: string): TargetInfo => ({
      requested,
      absolute: null,
      display: requested,
      root: null,
      exists: false,
      rejection: reason,
      ...(deniedBy ? { deniedBy } : {}),
    });

    if (requested.trim() === "") return rejected("unresolvable");

    const roots = await this.resolveRoots();

    // Relative paths are interpreted against the first root, which is the only
    // sensible reading of "write to src/foo.ts" when several roots exist.
    const candidate = isAbsolute(requested) ? resolve(requested) : resolve(roots[0], requested);

    let real: string;
    try {
      real = await realpathDeepest(candidate);
    } catch {
      return rejected("unresolvable");
    }

    const root = roots.find((r) => contains(r, real)) ?? null;
    if (!root) return rejected("outside-roots");

    const rel = relative(root, real);
    const deniedBy = this.deniedBy(rel);
    if (deniedBy) return rejected("denied", deniedBy);

    let exists = false;
    let onDisk: TargetInfo["onDisk"];
    try {
      const info = await stat(real);
      if (info.isDirectory()) return rejected("not-a-file");
      if (info.size > MAX_FILE_BYTES) return rejected("too-large");

      const body = await readFile(real, "utf8");
      exists = true;
      onDisk = {
        bytes: info.size,
        lines: countLines(body),
        sha256: sha256(body),
        mode: info.mode,
      };
    } catch (error) {
      // ENOENT is the normal case for a new file; anything else means the
      // contents cannot be vouched for, so the path is not writable.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return rejected("unresolvable");
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

  /**
   * Reports which deny pattern refuses a path, if any.
   *
   * @param relativePath - Path relative to the root that contains it.
   * @returns The matching pattern, or null when nothing matched.
   */
  private deniedBy(relativePath: string): string | null {
    const normalised = toPosix(relativePath).toLowerCase();
    if (normalised.startsWith("../")) return "..";

    const segments = normalised.split("/");
    const name = segments[segments.length - 1] ?? "";
    const directories = segments.slice(0, -1);

    for (const pattern of this.deny) {
      if (pattern === "") continue;
      if (pattern.endsWith("/")) {
        if (directories.includes(pattern.slice(0, -1))) return pattern;
        continue;
      }
      if (pattern.startsWith(".")) {
        // A dot pattern is both a filename and an extension: `.env` catches
        // `.env` and `.env.local`, `.pem` catches `server.pem`.
        if (name === pattern || name.startsWith(`${pattern}.`) || name.endsWith(pattern)) {
          return pattern;
        }
        continue;
      }
      if (name === pattern || name.startsWith(`${pattern}.`)) return pattern;
    }
    return null;
  }

  /**
   * Reads a file inside the roots.
   *
   * @param absolute - An already-resolved path.
   * @returns The file contents, or the empty string when it does not exist.
   * @throws {PathRejected} When the file exists but cannot be read, or exceeds
   *   {@link MAX_FILE_BYTES}.
   */
  async read(absolute: string): Promise<string> {
    try {
      const info = await stat(absolute);
      if (info.size > MAX_FILE_BYTES) {
        throw new PathRejected(
          `${absolute} is ${info.size} bytes, over the ${MAX_FILE_BYTES}-byte limit.`,
          "too-large",
        );
      }
      return await readFile(absolute, "utf8");
    } catch (error) {
      if (error instanceof PathRejected) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw new PathRejected(`Cannot read ${absolute}.`, "unreadable");
    }
  }

  /**
   * Writes content to a path, atomically.
   *
   * The write goes to a temp file in the same directory and is then renamed,
   * because a rename within one filesystem is atomic: a crash mid-write leaves
   * the original intact rather than half a file.
   *
   * @param absolute - An already-resolved path inside a root.
   * @param content - The bytes to write.
   * @param mode - Permissions of the file being replaced, restored after the
   *   write so editing a `0755` script does not silently make it `0644`.
   * @returns The size and hash of what was written.
   */
  async commit(
    absolute: string,
    content: string,
    mode?: number,
  ): Promise<{ bytes: number; sha256: string }> {
    const bytes = Buffer.byteLength(content, "utf8");
    const digest = sha256(content);
    if (this.dryRun) return { bytes, sha256: digest };

    await mkdir(dirname(absolute), { recursive: true });
    // A random component, because two commits in the same directory within one
    // millisecond would otherwise choose the same temp name.
    const temp = join(dirname(absolute), `.${randomUUID()}.interactive-editor.tmp`);
    await writeFile(temp, content, "utf8");
    try {
      if (mode !== undefined) await chmod(temp, mode & 0o7777);
      await rename(temp, absolute);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
    return { bytes, sha256: digest };
  }

  /**
   * Deletes a path inside the roots.
   *
   * @param absolute - An already-resolved path.
   */
  async remove(absolute: string): Promise<void> {
    if (this.dryRun) return;
    await rm(absolute, { force: true });
  }
}

/**
 * Hashes text with SHA-256.
 *
 * @param text - The content to hash.
 * @returns The digest as lowercase hex.
 */
export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Reports whether one path contains another.
 *
 * @param parent - The containing directory.
 * @param child - The path being tested.
 * @returns True when `child` is `parent` itself or sits underneath it.
 */
function contains(parent: string, child: string): boolean {
  if (parent === child) return true;
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Resolves symlinks on the deepest ancestor of a path that exists.
 *
 * `realpath` throws on a path that does not exist yet, which is the normal case
 * for a file about to be created, so the existing prefix is resolved and the
 * missing tail re-appended.
 *
 * @param target - The path to resolve.
 * @returns The canonical path.
 * @throws {Error} When no ancestor of the path can be resolved.
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
      // `basename`, not a slice past the parent: a filesystem root already ends
      // with its separator, so measuring one past it drops the first character
      // of the segment — and the write lands on a path nobody asked for.
      missing.push(basename(current));
      current = parent;
    }
  }
}

/**
 * Rewrites a path with forward slashes.
 *
 * @param p - A path in the platform's own spelling.
 * @returns The same path with `/` separators.
 */
function toPosix(p: string): string {
  return p.split(sep).join("/");
}
