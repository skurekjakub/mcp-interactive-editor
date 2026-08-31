/**
 * @module
 *
 * Bounds on what a tool call may carry.
 *
 * The guard caps what it reads from disk. Nothing capped what arrived over the
 * wire, so a proposal could be arbitrarily larger than any file this editor
 * would agree to open — held three times over in memory, diffed, linted on every
 * keystroke, and finally written.
 */
import { z } from "zod";
import { MAX_FILE_BYTES } from "../fsGuard.js";

/**
 * Longest path a tool call may name.
 *
 * Comfortably past Windows' `MAX_PATH` and every POSIX `PATH_MAX`, so it refuses
 * only what the filesystem would refuse anyway — but it refuses it here, with a
 * sentence naming the file, rather than at `rename` with a raw errno quoting an
 * internal temp name.
 */
export const MAX_PATH_CHARS = 4096;

/** A file path a tool will accept. */
export const pathInput = z
  .string()
  .min(1, "The path is empty.")
  .max(MAX_PATH_CHARS, `The path is longer than ${MAX_PATH_CHARS} characters.`);

/**
 * File content a tool will accept.
 *
 * Measured in characters against a byte budget. The two differ only above the
 * BMP, and always in the safe direction: a string of this many characters is at
 * least this many bytes, so nothing over the budget slips past.
 */
export const contentInput = z
  .string()
  .max(
    MAX_FILE_BYTES,
    `The content is larger than the ${MAX_FILE_BYTES / (1024 * 1024)} MB this editor will review.`,
  );
