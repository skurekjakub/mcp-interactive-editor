import { describe, expect, it } from "vitest";
import { declaredVersions, versionDrift } from "../../scripts/versions.mjs";

describe("the declared version", () => {
  /*
   * Claude Code caches an installed plugin under its declared version and
   * rebuilds only when that number changes. A tree whose declarations disagree
   * ships a plugin that every existing install ignores, and the symptom is
   * indistinguishable from a restart that did not take.
   */
  it("agrees everywhere it is declared", () => {
    // Arrange.
    const declared = declaredVersions();

    // Act.
    const drift = versionDrift();

    // Assert.
    expect(declared.length).toBeGreaterThanOrEqual(6);
    expect(drift).toEqual([]);
  });

  it("is found in every declaration, not merely absent from some", () => {
    // Assert: a missing literal reads as agreement unless it is checked for.
    for (const entry of declaredVersions()) {
      expect(entry.version, entry.where).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});
