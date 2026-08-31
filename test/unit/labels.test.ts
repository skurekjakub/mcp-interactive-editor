import { describe, expect, it } from "vitest";
import type { Proposal, WriteMode } from "../../shared/types.js";
import { basename, commitLabel } from "../../ui/src/lib/labels.js";

const proposal = (mode: WriteMode, display: string): Proposal => ({
  proposalId: "p",
  mode,
  target: {
    requested: display,
    absolute: `/root/${display}`,
    display,
    root: "/root",
    exists: mode !== "create",
  },
  content: "",
  originalContent: "",
  baseline: "",
  attached: false,
  destructiveAcknowledged: false,
});

describe("commitLabel", () => {
  it("says what will be true afterwards, in lines", () => {
    const label = commitLabel(proposal("overwrite", "deploy.yml"), "a\nb\nc", false);
    expect(label).toBe("Write 3 lines to deploy.yml");
  });

  it("does not say '1 lines'", () => {
    expect(commitLabel(proposal("create", "one.txt"), "solo", false)).toBe(
      "Write 1 line to one.txt",
    );
  });

  it("counts an empty file as nothing, not as one blank line", () => {
    expect(commitLabel(proposal("create", "empty.txt"), "", false)).toBe(
      "Write 0 lines to empty.txt",
    );
  });

  it("names the act, not the size, for a delete", () => {
    expect(commitLabel(proposal("delete", "doomed.txt"), "", false)).toBe("Delete doomed.txt");
  });

  it("says simulate when nothing will reach disk", () => {
    expect(commitLabel(proposal("overwrite", "deploy.yml"), "x", true)).toBe(
      "Simulate write to deploy.yml",
    );
  });

  it("uses the file name, not the whole path", () => {
    const label = commitLabel(proposal("overwrite", "deep/nested/file.ts"), "x", false);
    expect(label).toBe("Write 1 line to file.ts");
  });
});

describe("basename", () => {
  it("takes the last segment", () => {
    expect(basename("a/b/c.txt")).toBe("c.txt");
  });

  it("leaves a bare name alone", () => {
    expect(basename("c.txt")).toBe("c.txt");
  });
});
