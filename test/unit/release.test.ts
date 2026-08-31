import { describe, expect, it } from "vitest";
import { declaredVersions, versionDrift } from "../../scripts/versions.mjs";

/**
 * Every file that states the version, and therefore every file the drift check
 * has to be looking at.
 *
 * Named rather than counted. A floor below the true number lets a declaration
 * site be dropped from the checker while the count still passes, and a
 * declaration nobody reads is one that can drift in silence — with the check
 * still reporting agreement.
 */
const DECLARED_IN = [
  "package.json",
  "package-lock.json",
  'package-lock.json packages[""]',
  ".claude-plugin/plugin.json",
  "src/version.ts",
  "ui/src/lib/version.ts",
];

describe("the declared version", () => {
  /*
   * Claude Code caches an installed plugin under its declared version and
   * rebuilds only when that number changes. A tree whose declarations disagree
   * ships a plugin that every existing install ignores, and the symptom is
   * indistinguishable from a restart that did not take.
   */
  it("agrees everywhere it is declared", () => {
    // Act.
    const drift = versionDrift();

    // Assert.
    expect(drift).toEqual([]);
  });

  it("is checked in every file that declares it", () => {
    // Act.
    const looked = declaredVersions().map((entry) => entry.where);

    // Assert.
    expect(looked).toEqual(expect.arrayContaining(DECLARED_IN));
    expect(looked.some((where) => where.startsWith("marketplace plugin "))).toBe(true);
  });

  it("is found in every declaration, not merely absent from some", () => {
    // Assert: a missing literal reads as agreement unless it is checked for.
    for (const entry of declaredVersions()) {
      expect(entry.version, entry.where).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});
