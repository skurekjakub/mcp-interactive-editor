import { describe, expect, it } from "vitest";
import { MAX_FILE_BYTES } from "../../src/fsGuard.js";
import { MAX_PATH_CHARS, contentInput, pathInput } from "../../src/tools/limits.js";

/**
 * @module
 *
 * What a tool call is allowed to carry.
 *
 * The guard caps what it reads off disk. Nothing capped what arrives over the
 * wire, so a proposal could be arbitrarily larger than any file this editor
 * would agree to open — and it was held three times over, diffed, linted on
 * every keystroke, and finally written.
 */

describe("the path a tool will accept", () => {
  it("takes an ordinary path", () => {
    expect(pathInput.safeParse("src/thing.ts").success).toBe(true);
  });

  it("refuses an empty path rather than resolving it to a directory", () => {
    expect(pathInput.safeParse("").success).toBe(false);
  });

  it("refuses a path longer than any filesystem would accept", () => {
    // Arrange: without this the path survives propose and attach, then fails at
    // rename with a raw errno quoting the internal temp file name.
    const absurd = "a".repeat(MAX_PATH_CHARS + 1);

    // Act & Assert.
    expect(pathInput.safeParse(absurd).success).toBe(false);
  });

  it("accepts a path right at the limit", () => {
    expect(pathInput.safeParse("a".repeat(MAX_PATH_CHARS)).success).toBe(true);
  });
});

describe("the content a tool will accept", () => {
  it("takes an ordinary file", () => {
    expect(contentInput.safeParse("hello\n").success).toBe(true);
  });

  it("takes an empty file, which is what a delete proposes", () => {
    expect(contentInput.safeParse("").success).toBe(true);
  });

  it("refuses more than the editor would ever open from disk", () => {
    // Arrange: the same cap the guard applies to a read, so a proposal cannot be
    // larger than a file this editor would agree to review.
    const overflowing = "x".repeat(MAX_FILE_BYTES + 1);

    // Act.
    const parsed = contentInput.safeParse(overflowing);

    // Assert.
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toMatch(/larger than/);
  });
});
