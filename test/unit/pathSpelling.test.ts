import { describe, expect, it } from "vitest";
import type { TargetInfo } from "../../shared/types.js";
import { namesTarget, sameTarget } from "../../src/pathSpelling.js";

/** A resolved target, as the guard would describe it. */
function target(requested: string, absolute: string | null): TargetInfo {
  return { requested, absolute, display: requested, root: "/root", exists: true };
}

const opened = target("/root/src/b.txt", "/root/src/b.txt");

describe("namesTarget", () => {
  it("matches the spelling the proposal was opened with", () => {
    expect(namesTarget(target("a.txt", "/root/a.txt"), "a.txt", false)).toBe(true);
  });

  it("matches the resolved absolute path", () => {
    expect(namesTarget(target("a.txt", "/root/a.txt"), "/root/a.txt", false)).toBe(true);
  });

  it("matches a relative spelling only as whole trailing segments", () => {
    // Arrange & Act & Assert: `rc/b.txt` is the tail of the characters, not of
    // the segments, and matching it would hand this proposal to another file.
    expect(namesTarget(opened, "src/b.txt", false)).toBe(true);
    expect(namesTarget(opened, "b.txt", false)).toBe(true);
    expect(namesTarget(opened, "rc/b.txt", false)).toBe(false);
  });

  it("accepts either separator", () => {
    expect(namesTarget(opened, "src\\b.txt", false)).toBe(true);
  });

  it("folds case only where the filesystem does", () => {
    expect(namesTarget(opened, "SRC/B.TXT", true)).toBe(true);
    expect(namesTarget(opened, "SRC/B.TXT", false)).toBe(false);
  });

  it("matches a refused target by its own spelling and nothing else", () => {
    const refused = target("../escape.txt", null);

    expect(namesTarget(refused, "../escape.txt", false)).toBe(true);
    expect(namesTarget(refused, "escape.txt", false)).toBe(false);
  });
});

describe("sameTarget", () => {
  it("compares the resolved location, not the spelling", () => {
    expect(sameTarget(target("a.txt", "/root/a.txt"), target("/root/a.txt", "/root/a.txt"))).toBe(
      true,
    );
  });

  it("never treats two refused targets as the same file", () => {
    // Neither names a file, so neither can be a draft of the other.
    expect(sameTarget(target("x", null), target("x", null))).toBe(false);
  });

  it("does not fold case, because a case-sensitive filesystem does not", () => {
    expect(sameTarget(target("a", "/root/a.txt"), target("A", "/root/A.txt"))).toBe(false);
  });
});
