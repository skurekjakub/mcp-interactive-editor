/**
 * @module
 *
 * The deny list: names refused inside a root before any content is considered.
 *
 * Pure, so the matching can be tested without a filesystem under it.
 */

/**
 * Paths refused before any content is considered.
 *
 * A pattern ending in `/` matches a directory segment. A pattern beginning with
 * `.` matches a whole filename, a filename with a suffix after it, or an
 * extension. Anything else matches a whole filename, with or without an
 * extension. Matching is anchored rather than by substring, so
 * `shortcuts.keymap.ts` is not caught by `.key`.
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
 * Reports which deny pattern refuses a path, if any.
 *
 * Compared without regard to case: the secrets these patterns guard are spelled
 * however the tool that wrote them chose, and `.ENV` is `.env`.
 *
 * @param patterns - The deny list, in the operator's own spelling.
 * @param relativePath - Path relative to the root that contains it, with `/` separators.
 * @returns The matching pattern as configured, or null when nothing matched.
 */
export function matchDeny(patterns: string[], relativePath: string): string | null {
  const segments = relativePath.toLowerCase().split("/");
  const name = segments[segments.length - 1] ?? "";
  const directories = segments.slice(0, -1);

  for (const pattern of patterns) {
    const wanted = pattern.toLowerCase();
    if (wanted === "") continue;

    if (wanted.endsWith("/")) {
      if (directories.includes(wanted.slice(0, -1))) return pattern;
      continue;
    }

    if (wanted.startsWith(".")) {
      // A dot pattern is both a filename and an extension: `.env` catches
      // `.env` and `.env.local`, `.pem` catches `server.pem`.
      if (name === wanted || name.startsWith(`${wanted}.`) || name.endsWith(wanted)) {
        return pattern;
      }
      continue;
    }

    if (name === wanted || name.startsWith(`${wanted}.`)) return pattern;
  }

  return null;
}
