/**
 * @module
 *
 * Comparing spellings of a path without resolving them.
 *
 * A host is free to normalise a path on the way through — slashes, case,
 * relative to absolute — so the spelling the panel hands back is not always the
 * one the proposal was opened with. Resolving it would anchor a relative path
 * to the working directory, which is not where the guard anchored it, so the
 * spellings are compared as text with the separator and case folded the way the
 * running filesystem folds them.
 */
import type { TargetInfo } from "../shared/types.js";

/**
 * Whether the running filesystem treats differently-cased names as one name.
 *
 * Windows and the default macOS volume fold case; Linux does not, and folding
 * there would let one file's spelling claim another file's proposal.
 */
const FOLDS_CASE = process.platform === "win32" || process.platform === "darwin";

/**
 * Normalises a path for comparison without resolving it.
 *
 * @param p - The path to normalise.
 * @param foldsCase - Whether to fold case, as the running filesystem does.
 * @returns The path with one separator style, folded if asked.
 */
function forCompare(p: string, foldsCase: boolean): string {
  const slashed = p.split("\\").join("/");
  return foldsCase ? slashed.toLowerCase() : slashed;
}

/**
 * Reports whether a path the host echoed back names this target.
 *
 * The already-resolved absolute path is what it is measured against. A
 * relative spelling is matched as a trailing run of whole segments rather than
 * resolved, because the working directory is not the root the guard resolved
 * against.
 *
 * @param target - The proposal's resolved target.
 * @param path - The spelling the panel was handed.
 * @param foldsCase - Whether to fold case; defaults to what the platform does.
 * @returns True when the path names this target.
 */
export function namesTarget(target: TargetInfo, path: string, foldsCase = FOLDS_CASE): boolean {
  const wanted = forCompare(path, foldsCase);
  if (forCompare(target.requested, foldsCase) === wanted) return true;
  if (!target.absolute) return false;

  const absolute = forCompare(target.absolute, foldsCase);
  return absolute === wanted || absolute.endsWith(`/${wanted}`);
}

/**
 * Reports whether two resolved targets name the same file.
 *
 * The guard has already resolved both, against the configured root and through
 * every symlink. Re-resolving the requested spelling instead would resolve it
 * against the working directory, which is not the root in the shipped bundle —
 * two spellings of one file would then compare unequal, no supersede would fire,
 * and two live drafts of the same file would each commit and each report
 * success, the older one silently overwriting the newer.
 *
 * Compared verbatim, without case folding: on a case-sensitive filesystem
 * `a.txt` and `A.txt` are different files, and folding them together would close
 * a review the human still has open.
 *
 * @param a - One resolved target.
 * @param b - The other resolved target.
 * @returns True when both resolved to the same location.
 */
export function sameTarget(a: TargetInfo, b: TargetInfo): boolean {
  return a.absolute !== null && a.absolute === b.absolute;
}
