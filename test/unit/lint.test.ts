import { describe, expect, it } from "vitest";
import { countLines } from "../../shared/diff.js";
import { composeState } from "../../shared/state.js";
import { DESTRUCTIVE_DELETION_RATIO, hasBlockers } from "../../shared/lint.js";
import type { Proposal, WriteMode } from "../../shared/types.js";

function proposal(overrides: Partial<Proposal> = {}): Proposal {
  const baseline = overrides.baseline ?? "";
  const content = overrides.content ?? "";
  const mode: WriteMode = overrides.mode ?? (baseline === "" ? "create" : "overwrite");

  return {
    proposalId: "test",
    createdAt: 0,
    mode,
    content,
    originalContent: content,
    baseline,
    attached: true,
    destructiveAcknowledged: false,
    ...overrides,
    // Built last, and merged rather than replaced, so a test can override one
    // target field without silently blanking the rest of it.
    target: {
      requested: "src/thing.ts",
      absolute: "/root/src/thing.ts",
      display: "src/thing.ts",
      root: "/root",
      exists: baseline !== "",
      ...(baseline !== ""
        ? {
            onDisk: {
              bytes: baseline.length,
              lines: countLines(baseline),
              sha256: "x",
              mode: 0o644,
            },
          }
        : {}),
      ...overrides.target,
    },
  };
}

/**
 * Lint through the assembly the server actually commits against.
 *
 * A private copy of "diff first, then lint against those stats" would leave this
 * file — the one named for destructive-write blocking — passing while the
 * assembly that gates a real commit computed something else entirely.
 */
function lint(p: Proposal, roots: string[] = ["/root"]) {
  return composeState(p, { roots, dryRun: false, serverVersion: "test" }).findings;
}

const ids = (p: Proposal) => lint(p).map((f) => f.id);

describe("path checks", () => {
  it("blocks a target that resolved outside every root", () => {
    const findings = lint(proposal({ target: { absolute: null } as never, content: "x\n" }));
    expect(findings[0]).toMatchObject({ id: "path-unresolved", severity: "blocker" });
  });

  it("blocks creating a file that already exists", () => {
    const findings = lint(
      proposal({ mode: "create", baseline: "already here\n", content: "new\n" }),
    );
    expect(findings.find((f) => f.id === "create-exists")?.severity).toBe("blocker");
  });

  it("warns, but does not block, when an overwrite target is missing", () => {
    const findings = lint(proposal({ mode: "overwrite", baseline: "", content: "new\n" }));
    expect(findings.find((f) => f.id === "overwrite-missing")?.severity).toBe("warning");
    expect(hasBlockers(findings)).toBe(false);
  });

  it("tells the human which check refused the path, not just that one did", () => {
    // Arrange: a file inside a root that the deny list caught.
    const denied = proposal({
      content: "x\n",
      target: { absolute: null, rejection: "denied", deniedBy: ".env" } as never,
    });

    // Act.
    const finding = lint(denied).find((f) => f.id === "path-unresolved");

    // Assert: naming the deny pattern is the difference between a fixable
    // refusal and one that reports a file as being outside its own project.
    expect(finding?.detail).toContain(".env");
    expect(finding?.detail).not.toContain("outside");
  });

  it("lists the writable roots when the path really is outside them", () => {
    const outside = proposal({
      content: "x\n",
      target: { absolute: null, rejection: "outside-roots" } as never,
    });

    const finding = lint(outside, ["/only/here"]).find((f) => f.id === "path-unresolved");

    expect(finding?.detail).toContain("/only/here");
  });

  it("notes that a traversal path was normalised", () => {
    const findings = lint(
      proposal({ content: "x\n", target: { requested: "src/../src/thing.ts" } as never }),
    );
    expect(findings.find((f) => f.id === "path-traversal")?.severity).toBe("info");
  });
});

describe("destructive changes", () => {
  const original = `${Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n")}\n`;

  it(`blocks removing more than ${DESTRUCTIVE_DELETION_RATIO * 100}% of a file`, () => {
    const findings = lint(proposal({ baseline: original, content: "line 0\n" }));
    const finding = findings.find((f) => f.id === "large-deletion");

    expect(finding?.severity).toBe("blocker");
    // 100 lines, not 101: the newline terminating the last one does not start
    // another, and a count that says otherwise skews this very ratio.
    expect(finding?.message).toMatch(/removes 99 of 100 lines \(99%\)/);
    expect(hasBlockers(findings)).toBe(true);
  });

  it("stays quiet on a small file, where the ratio means nothing", () => {
    // A one-line file whose line changes is a 50% deletion on paper and an
    // ordinary edit in practice. Nagging here would train the reflex away.
    const findings = lint(proposal({ baseline: "before\n", content: "after\n" }));
    expect(hasBlockers(findings)).toBe(false);
    expect(ids(proposal({ baseline: "before\n", content: "after\n" }))).not.toContain(
      "large-deletion",
    );
  });

  it("still blocks once the file is big enough for the share to mean something", () => {
    const twelve = `${Array.from({ length: 12 }, (_, i) => `l${i}`).join("\n")}\n`;
    const findings = lint(proposal({ baseline: twelve, content: "l0\nl1\n" }));
    expect(findings.find((f) => f.id === "large-deletion")?.severity).toBe("blocker");
  });

  it("downgrades to a note once it is acknowledged", () => {
    const findings = lint(
      proposal({ baseline: original, content: "line 0\n", destructiveAcknowledged: true }),
    );
    expect(findings.find((f) => f.id === "large-deletion")?.severity).toBe("info");
    expect(hasBlockers(findings)).toBe(false);
  });

  it("leaves a small edit alone", () => {
    const findings = lint(
      proposal({ baseline: original, content: original.replace("line 4", "line four") }),
    );
    expect(hasBlockers(findings)).toBe(false);
    expect(ids(proposal({ baseline: original, content: original }))).not.toContain(
      "large-deletion",
    );
  });

  it("blocks emptying a file", () => {
    const findings = lint(proposal({ baseline: "something\n", content: "   \n" }));
    expect(findings.find((f) => f.id === "emptied")?.severity).toBe("blocker");
  });

  it("blocks a deletion until acknowledged", () => {
    const p = proposal({ mode: "delete", baseline: "goodbye\n", content: "" });
    expect(lint(p).find((f) => f.id === "delete")?.severity).toBe("blocker");
    expect(
      lint({ ...p, destructiveAcknowledged: true }).find((f) => f.id === "delete")?.severity,
    ).toBe("info");
  });

  it("warns when the diff had to fall back to a wholesale replacement", () => {
    const big = Array.from({ length: 2000 }, (_, i) => `old ${i}`).join("\n");
    const other = Array.from({ length: 2000 }, (_, i) => `new ${i}`).join("\n");
    const findings = lint(
      proposal({ baseline: big, content: other, destructiveAcknowledged: true }),
    );

    expect(findings.find((f) => f.id === "diff-truncated")?.severity).toBe("warning");
  });
});

describe("content hygiene", () => {
  it("offers to add a missing final newline", () => {
    const finding = lint(proposal({ content: "no newline" })).find(
      (f) => f.id === "no-final-newline",
    );
    expect(finding?.fix?.content).toBe("no newline\n");
  });

  it("does not complain about an empty file having no newline", () => {
    expect(ids(proposal({ content: "" }))).not.toContain("no-final-newline");
  });

  it("offers to normalise mixed line endings", () => {
    const finding = lint(proposal({ content: "a\r\nb\nc\n" })).find((f) => f.id === "mixed-eol");
    expect(finding?.severity).toBe("warning");
    expect(finding?.fix?.content).toBe("a\nb\nc\n");
  });

  it("flags CRLF content going into an LF file", () => {
    const finding = lint(proposal({ baseline: "a\nb\n", content: "a\r\nb\r\n" })).find(
      (f) => f.id === "eol-mismatch",
    );
    expect(finding?.fix?.content).toBe("a\nb\n");
  });

  it("offers to strip trailing whitespace", () => {
    const finding = lint(proposal({ content: "a   \nb\t\n" })).find(
      (f) => f.id === "trailing-whitespace",
    );
    expect(finding?.fix?.content).toBe("a\nb\n");
  });

  it("notices an indentation style that disagrees with the file", () => {
    const tabbed = "function a() {\n\treturn 1;\n}\n\tif (x) {\n\t\ty();\n\t}\n";
    const spaced = "function a() {\n  return 1;\n}\n  if (x) {\n    y();\n  }\n";
    const finding = lint(proposal({ baseline: tabbed, content: spaced })).find(
      (f) => f.id === "indent-mismatch",
    );

    expect(finding?.message).toContain("tabs");
    expect(finding?.message).toContain("spaces");
  });

  it("blocks null bytes outright", () => {
    const findings = lint(proposal({ content: `binary${String.fromCharCode(0)}payload` }));
    expect(findings.find((f) => f.id === "binary-content")?.severity).toBe("blocker");
  });

  it("skips hygiene checks entirely for a deletion", () => {
    const findings = ids(proposal({ mode: "delete", baseline: "x\n", content: "" }));
    expect(findings).not.toContain("no-final-newline");
    expect(findings).not.toContain("emptied");
  });
});

describe("ordering", () => {
  it("puts blockers first so the reason the button is dead is the first thing read", () => {
    const findings = lint(
      proposal({
        baseline: `${Array.from({ length: 50 }, (_, i) => `l${i}`).join("\n")}\n`,
        content: "l0",
      }),
    );

    expect(findings[0].severity).toBe("blocker");
    expect(findings.at(-1)?.severity).toBe("info");
  });
});

describe("changes the diff cannot show", () => {
  it("warns when a CRLF file would be rewritten to LF", () => {
    // Arrange: lines compare equal once terminators are stripped, so the diff is
    // empty and every finding except this one is silent.
    const crlf = proposal({ baseline: "one\r\ntwo\r\n", content: "one\ntwo\n" });

    // Act.
    const finding = lint(crlf).find((f) => f.id === "eol-rewrite");

    // Assert: the write rewrites every line in the file, so it has to be said.
    expect(finding?.severity).toBe("warning");
    expect(finding?.fix?.content).toBe("one\r\ntwo\r\n");
  });

  it("still catches the opposite direction", () => {
    const lf = proposal({ baseline: "one\ntwo\n", content: "one\r\ntwo\r\n" });

    expect(ids(lf)).toContain("eol-mismatch");
  });

  it("says nothing when both sides agree on CRLF", () => {
    const same = proposal({ baseline: "one\r\ntwo\r\n", content: "one\r\nTWO\r\n" });

    expect(ids(same)).not.toContain("eol-rewrite");
  });

  it("reports a change that is only the newline at the end of the file", () => {
    const finding = lint(proposal({ baseline: "a\nb", content: "a\nb\n" })).find(
      (f) => f.id === "newline-at-eof",
    );

    expect(finding?.severity).toBe("info");
  });
});

describe("content the caller controls the size of", () => {
  it("finds trailing whitespace without scanning quadratically", () => {
    // Arrange: a long run of spaces the line does not end with. An anchored
    // `/[ \t]+$/m` gives one character back per attempt from every offset, which
    // is minutes of a blocked event loop at this size.
    const hostile = `${" ".repeat(40_000)}x\ntrailing   \n`;

    // Act.
    const started = Date.now();
    const finding = lint(proposal({ content: hostile })).find(
      (f) => f.id === "trailing-whitespace",
    );
    const elapsed = Date.now() - started;

    // Assert: the run before the `x` is not trailing whitespace; the spaces
    // before the second newline are.
    expect(finding?.fix?.content).toBe(`${" ".repeat(40_000)}x\ntrailing\n`);
    expect(elapsed).toBeLessThan(1_000);
  });

  it("leaves line endings and the final newline alone when stripping", () => {
    const finding = lint(proposal({ baseline: "x\r\n", content: "a  \r\nb\t\r\n" })).find(
      (f) => f.id === "trailing-whitespace",
    );

    expect(finding?.fix?.content).toBe("a\r\nb\r\n");
  });
});
