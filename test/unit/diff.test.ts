import { describe, expect, it } from "vitest";
import { diffLines, formatUnifiedDiff, splitLines } from "../../shared/diff.js";

const lines = (n: number, prefix = "line") =>
  Array.from({ length: n }, (_, i) => `${prefix} ${i}`).join("\n");

describe("splitLines", () => {
  it("treats an empty string as no lines, not one blank line", () => {
    expect(splitLines("")).toEqual([]);
  });

  it("normalises CRLF so a diff does not report every line as changed", () => {
    expect(splitLines("a\r\nb")).toEqual(["a", "b"]);
  });

  it("counts a trailing newline as a final empty line", () => {
    expect(splitLines("a\n")).toEqual(["a", ""]);
  });
});

describe("diffLines", () => {
  it("reports nothing for identical input", () => {
    const { hunks, stats } = diffLines("same\ncontent\n", "same\ncontent\n");
    expect(hunks).toEqual([]);
    expect(stats).toEqual({ added: 0, removed: 0 });
  });

  it("treats an empty baseline as a pure addition", () => {
    const { stats } = diffLines("", "one\ntwo\nthree");
    expect(stats.added).toBe(3);
    expect(stats.removed).toBe(0);
  });

  it("isolates a single changed line in a large file", () => {
    const before = lines(400);
    const after = before.replace("line 200", "line 200 CHANGED");
    const { hunks, stats } = diffLines(before, after);

    expect(stats).toEqual({ added: 1, removed: 1 });
    expect(hunks).toHaveLength(1);
    // Context only, not the other 398 lines.
    expect(hunks[0].lines.length).toBeLessThan(10);
  });

  it("keeps old and new line numbers on the right sides", () => {
    const { hunks } = diffLines("a\nb\nc", "a\nB\nc");
    const changed = hunks[0].lines.filter((l) => l.kind !== "equal");

    const removed = changed.find((l) => l.kind === "remove");
    const added = changed.find((l) => l.kind === "add");

    expect(removed).toMatchObject({ text: "b", oldLine: 2, newLine: null });
    expect(added).toMatchObject({ text: "B", oldLine: null, newLine: 2 });
  });

  it("merges nearby changes into one hunk and keeps distant ones apart", () => {
    const before = lines(100);
    const after = before
      .replace("line 5", "FIVE")
      .replace("line 6", "SIX")
      .replace("line 80", "EIGHTY");

    const { hunks } = diffLines(before, after);
    expect(hunks).toHaveLength(2);
  });

  it("counts a wholesale rewrite as removing everything and adding everything", () => {
    const { stats } = diffLines(lines(10), lines(10, "totally different"));
    expect(stats.added).toBe(10);
    expect(stats.removed).toBe(10);
  });

  it("falls back to a flagged replacement when both sides are too large to compare", () => {
    const before = lines(2000, "old");
    const after = lines(2000, "new");
    const { stats } = diffLines(before, after);

    expect(stats.truncated).toBe(true);
    expect(stats.added).toBe(2000);
    expect(stats.removed).toBe(2000);
  });

  it("does not flag truncation when a shared prefix keeps the comparison small", () => {
    const before = lines(4000);
    const after = `${before}\nappended`;
    const { stats } = diffLines(before, after);

    expect(stats.truncated).toBeUndefined();
    expect(stats.added).toBe(1);
  });
});

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
});
