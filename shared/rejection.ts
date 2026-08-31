/**
 * @module
 *
 * One account of why a path was refused, for both people who are told.
 *
 * The model reads it in a tool result and the human reads it as a finding in the
 * panel. Two hand-written versions drift, and the drift is unobservable from
 * either side: whoever is looking at the wrong one has no way to know a fuller
 * reason exists.
 */
import type { PathRejection, TargetInfo } from "./types.js";

/**
 * States why a path cannot be written, naming the check that refused it.
 *
 * Collapsing every rejection into "outside the roots" reports a file inside the
 * project as being outside it, directly above the root that contains it, which
 * cannot be debugged from the message.
 *
 * @param target - The refused target.
 * @param roots - The configured writable roots, for the "outside" case.
 * @returns A sentence naming the failed check, with no subject.
 */
export function rejectionDetail(target: TargetInfo, roots: string[]): string {
  const reason: PathRejection = target.rejection ?? "unresolvable";

  switch (reason) {
    case "outside-roots":
      return (
        `It is outside the roots this editor will write to.\n` +
        `Writable roots:\n${roots.map((r) => `  ${r}`).join("\n")}`
      );
    case "denied":
      return (
        `It matches the deny list${target.deniedBy ? ` (${target.deniedBy})` : ""}, ` +
        `so this editor will not touch it even though it is inside a writable root. ` +
        `Start the server with --deny to choose your own patterns.`
      );
    case "not-a-file":
      return "It is a directory, not a file.";
    case "too-large":
      return "It is too large to review in an editor.";
    case "unresolvable":
    default:
      return "It could not be resolved to a path on disk.";
  }
}

/**
 * Explains a refusal to the model, naming the path and the failed check.
 *
 * @param target - The refused target.
 * @param roots - The configured writable roots, for the "outside" case.
 * @returns The refusal, ready to return as an error result.
 */
export function explainRejection(target: TargetInfo, roots: string[]): string {
  return `Refused: "${target.requested}" — ${rejectionDetail(target, roots)}`;
}
