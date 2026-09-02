import { describe, expect, it } from "vitest";
import type { EditorState, Finding, PathRejection, Proposal } from "../../shared/types.js";
import { composeState } from "../../shared/state.js";
import {
  MODEL_DIFF_CHAR_BUDGET,
  MODEL_DIFF_LINE_BUDGET,
  describeState,
  diffForModel,
  handleFor,
  serverInstructions,
} from "../../src/tools/wording.js";

function stateFor(
  baseline: string,
  content: string,
  over: {
    absolute?: string | null;
    rejection?: PathRejection;
    deniedBy?: string;
    findings?: Finding[];
    dryRun?: boolean;
  } = {},
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
      ...(over.rejection ? { rejection: over.rejection } : {}),
      ...(over.deniedBy ? { deniedBy: over.deniedBy } : {}),
    },
    content,
    originalContent: content,
    baseline,
    attached: false,
    destructiveAcknowledged: false,
    createdAt: 0,
  };

  // Composed the way the server composes it, then the findings are pinned so a
  // case can say exactly which ones it is about.
  const state = composeState(proposal, {
    roots: ["/root"],
    dryRun: over.dryRun ?? false,
    serverVersion: "test",
  });
  return { ...state, findings: over.findings ?? [] };
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
    const text = describeState(stateFor("", "x", { absolute: null, rejection: "outside-roots" }));
    expect(text).toMatch(/outside the roots/);
    expect(text).toContain("/root");
    expect(text).not.toContain("@@");
  });

  /*
   * A file inside a root that the deny list caught is not outside the roots, and
   * saying so prints "is outside the roots" directly above the root containing
   * it. There is no way to debug that from the message.
   */
  it("names the deny pattern rather than blaming the roots", () => {
    const text = describeState(
      stateFor("", "x", { absolute: null, rejection: "denied", deniedBy: ".env" }),
    );
    expect(text).toMatch(/deny list/);
    expect(text).toContain(".env");
    expect(text).not.toMatch(/outside the roots/);
  });

  it("says a directory is a directory", () => {
    const text = describeState(stateFor("", "x", { absolute: null, rejection: "not-a-file" }));
    expect(text).toMatch(/is a directory/);
  });
});

describe("serverInstructions", () => {
  it("does not promise a wait on a server that returns at once", () => {
    // Assert: the instructions and the tool descriptions reach the model as one
    // account, and one of them promising a verdict when the other delivers a
    // diff tells the model its next observation is something it is not.
    const text = serverInstructions({ blockOnReview: false });

    expect(text).toMatch(/returns as soon as the panel is open/i);
    expect(text).not.toMatch(/does not return until/i);
  });

  it("promises the wait when the server blocks on the review", () => {
    const text = serverInstructions({ blockOnReview: true });

    expect(text).toMatch(/does not return until/i);
    expect(text).not.toMatch(/returns as soon as/i);
  });
});

describe("how much diff the model is given", () => {
  it("caps a diff whose lines are enormous, not just one with many lines", () => {
    // Arrange: a single line big enough to be the whole context window. A line
    // budget counts this as one line and hands all of it over, which is the
    // cost the claim ticket exists to avoid.
    const huge = `${"x".repeat(2_000_000)}\n`;

    // Act.
    const rendered = diffForModel(stateFor("before\n", huge));

    // Assert.
    expect(rendered.length).toBeLessThan(MODEL_DIFF_CHAR_BUDGET * 2);
    expect(rendered).toMatch(/truncated|more diff lines/);
  });

  it("still caps a diff with many ordinary lines", () => {
    const many = `${Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n")}\n`;

    const rendered = diffForModel(stateFor("", many));

    expect(rendered.split("\n").length).toBeLessThanOrEqual(MODEL_DIFF_LINE_BUDGET + 1);
    expect(rendered).toMatch(/more diff lines/);
  });

  it("hands over a small diff whole, with no note", () => {
    const rendered = diffForModel(stateFor("a\n", "b\n"));

    expect(rendered).not.toMatch(/more diff lines|truncated/);
  });
});
