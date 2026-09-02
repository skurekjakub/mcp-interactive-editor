import { describe, expect, it } from "vitest";
import { diffLines } from "../../shared/diff.js";
import { formatUnifiedDiff } from "../../shared/unifiedDiff.js";

const MARKER = "\\ No newline at end of file";

/** Renders the diff between two texts with the marker information supplied. */
function render(before: string, after: string): string {
  return formatUnifiedDiff(diffLines(before, after).hunks, "file.txt", { before, after });
}

describe("formatUnifiedDiff", () => {
  it("says so plainly when there is nothing to show", () => {
    const { hunks } = diffLines("x", "x");
    expect(formatUnifiedDiff(hunks, "file.txt")).toBe("(no changes to file.txt)");
  });

  it("marks added and removed lines the way a patch does", () => {
    const { hunks } = diffLines("a\nb", "a\nc");
    const text = formatUnifiedDiff(hunks, "file.txt");

    expect(text).toContain("--- file.txt (on disk)");
    expect(text).toContain("+++ file.txt (proposed)");
    expect(text).toContain("-b");
    expect(text).toContain("+c");
    expect(text).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
  });

  it("renders no marker at all when it is not told how the files end", () => {
    const { hunks } = diffLines("a\nb", "a\nc");
    expect(formatUnifiedDiff(hunks, "file.txt")).not.toContain(MARKER);
  });
});

describe("the marker for an unterminated final line", () => {
  it("follows the final line of each side when the hunk reaches it", () => {
    // Arrange & Act: both sides end without a newline, and both final lines
    // are in the hunk, so each carries the marker `patch` expects after it.
    const text = render("a\nb", "a\nc");

    // Assert.
    expect(text).toBe(
      [
        "--- file.txt (on disk)",
        "+++ file.txt (proposed)",
        "@@ -1,2 +1,2 @@",
        " a",
        "-b",
        MARKER,
        "+c",
        MARKER,
      ].join("\n"),
    );
  });

  it("stays off a hunk that stops short of the end of the file", () => {
    // Arrange: a change near the top of an unterminated file. The hunk ends a
    // few lines of context later, well before the last line.
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 1", "changed");

    // Act.
    const text = render(before, after);

    // Assert: a marker after a terminated line describes a file that does not
    // exist, and a patch built from the text would not apply.
    expect(text).toContain("+changed");
    expect(text).not.toContain(MARKER);
  });

  it("marks a shared final line once when both sides are unterminated", () => {
    // Arrange & Act: the last line is unchanged and unterminated on both sides.
    const text = render("a\nb\nz", "a\nc\nz");

    // Assert.
    expect(text.split("\n").filter((l) => l === MARKER)).toHaveLength(1);
    expect(text.endsWith(` z\n${MARKER}`)).toBe(true);
  });

  it("says nothing on a shared final line when only one side is unterminated", () => {
    // Arrange & Act: the diff cannot render a line that is terminated on one
    // side and not the other, so the newline finding carries that instead.
    const text = render("a\nb\nz\n", "a\nc\nz");

    // Assert.
    expect(text).not.toContain(MARKER);
  });
});
