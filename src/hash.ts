/**
 * @module
 *
 * The one fingerprint every part of the server agrees on.
 */
import { createHash } from "node:crypto";

/**
 * Hashes text with SHA-256.
 *
 * @param text - The content to hash.
 * @returns The digest as lowercase hex.
 */
export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
