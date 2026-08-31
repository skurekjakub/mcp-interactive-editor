import { describe, expect, it } from "vitest";
import type { EditorState, Finding, Proposal } from "../../shared/types.js";
import { diffLines } from "../../shared/diff.js";
import {
  MODEL_DIFF_LINE_BUDGET,
  describeState,
  diffForModel,
  handleFor,
} from "../../src/tools/results.js";

function stateFor(
  baseline: string,
  content: string,
  over: { absolute?: string | null; findings?: Finding[]; dryRun?: boolean } = {},
): EditorState {
  const proposal: Proposal = {
    proposalId: "11111111-2222-3333-4444-555555555555",
    mode: "overwrite",
    target: {
      requested: "/root/file.txt",
      absolute: over.absolute === undefined ? "/root/file.txt" : over.absolute,
      display: "file.txt",
      root: "/root",
      exists: true,
    },
    content,
    originalContent: content,
    baseline,
    attached: false,
    destructiveAcknowledged: false,
  };

  return {
    proposal,
    findings: over.findings ?? [],
    diff: diffLines(baseline, content).hunks,
    roots: ["/root"],
    dryRun: over.dryRun ?? false,
  };
}

describe("handleFor", () => {
  it("is a claim ticket, not the file", () => {
    const handle = handleFor(stateFor("before\n", "after\n"));

    expect(Object.keys(handle).sort()).toEqual(["display", "mode", "proposalId"]);
    expect(JSON.stringify(handle)).not.toContain("before");
    expect(JSON.stringify(handle)).not.toContain("after");
  });

  it("marks a refusal, so the panel can say so before it attaches", () => {
    expect(handleFor(stateFor("", "x", { absolute: null })).refused).toBe(true);
  });
});

describe("diffForModel", () => {
  it("leaves a small diff whole", () => {
    const printed = diffForModel(stateFor("one\n", "two\n"));
    expect(printed).toContain("+two");
    expect(printed).not.toMatch(/more diff lines/);
  });

  it("caps a diff that is really the file typed twice", () => {
    const body = `${Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n")}\n`;
    const printed = diffForModel(stateFor("", body));
    const lines = printed.split("\n");

    expect(lines.length).toBe(MODEL_DIFF_LINE_BUDGET + 1);
    expect(printed).toContain("+line 0");
    expect(printed).not.toContain("+line 399");
    expect(lines[lines.length - 1]).toMatch(/more diff lines/);
  });
});

describe("describeState", () => {
  it("leads with the fact that nothing has been written", () => {
    expect(describeState(stateFor("one\n", "two\n"))).toMatch(/nothing has been written/i);
  });

  it("names the mode, the file and the size of the change", () => {
    const text = describeState(stateFor("one\n", "one\ntwo\n"));
    expect(text).toContain("OVERWRITE  file.txt");
    expect(text).toContain("+1 / -0 lines");
  });

  it("says when a commit would be simulated", () => {
    expect(describeState(stateFor("a\n", "b\n", { dryRun: true }))).toContain("(dry run)");
  });

  it("lists findings with their severity", () => {
    const findings: Finding[] = [
      { id: "x", rule: "trailing-newline", severity: "warning", message: "No trailing newline." },
    ];
    const text = describeState(stateFor("a\n", "b", { findings }));
    expect(text).toContain("[warning] No trailing newline.");
  });

  it("explains a refusal with the roots, instead of a diff", () => {
    const text = describeState(stateFor("", "x", { absolute: null }));
    expect(text).toMatch(/outside the roots/);
    expect(text).toContain("/root");
    expect(text).not.toContain("@@");
  });
});
