/**
 * @module
 *
 * Path arithmetic the guard relies on: containment, canonical spelling, and
 * the separator-neutral form shown to humans.
 */
import { constants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";

/**
 * Reports whether one path contains another.
 *
 * @param parent - The containing directory.
 * @param child - The path being tested.
 * @returns True when `child` is `parent` itself or sits underneath it.
 */
export function contains(parent: string, child: string): boolean {
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
export async function realpathDeepest(target: string): Promise<string> {
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
export function toPosix(p: string): string {
  return p.split(sep).join("/");
}
