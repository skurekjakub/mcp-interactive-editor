import { describe, expect, it } from "vitest";
import {
  annotatePassage,
  attachPassage,
  describePassages,
  isAnswered,
  passageFromRows,
  passageFromSelection,
  quotePassages,
  rangeOf,
  sortPassages,
  unanswered,
  type Passage,
} from "../../shared/passages.js";

const passage = (over: Partial<Passage> = {}): Passage => ({
  id: "editor:0-4",
  source: "editor",
  text: "hello",
  startLine: 1,
  endLine: 1,
  ...over,
});

describe("passageFromSelection", () => {
  const draft = "one\ntwo\nthree\nfour\n";

  it("is nothing at all for a bare click", () => {
    expect(passageFromSelection(draft, 5, 5)).toBeNull();
  });

  it("counts lines from the start of the draft, not from zero", () => {
    // "two" begins at index 4, on line 2.
    const selected = passageFromSelection(draft, 4, 7);
    expect(selected).toMatchObject({ text: "two", startLine: 2, endLine: 2, source: "editor" });
  });

  it("spans every line the selection touches", () => {
    const selected = passageFromSelection(draft, 4, 13);
    expect(selected?.text).toBe("two\nthree");
    expect(selected?.startLine).toBe(2);
    expect(selected?.endLine).toBe(3);
  });

  it("keeps the character range, so the draft can be edited around it", () => {
    expect(passageFromSelection(draft, 4, 7)).toMatchObject({ start: 4, end: 7 });
  });

  it("identifies a region by where it is, so the same one cannot stack twice", () => {
    expect(passageFromSelection(draft, 4, 7)?.id).toBe(passageFromSelection(draft, 4, 7)?.id);
    expect(passageFromSelection(draft, 4, 7)?.id).not.toBe(passageFromSelection(draft, 0, 3)?.id);
  });
});

describe("passageFromRows", () => {
  it("is nothing when the selection touched no rows", () => {
    expect(passageFromRows([])).toBeNull();
  });

  it("joins the rows and takes the range from the first and last", () => {
    const selected = passageFromRows([
      { line: 12, text: "  - run: npm ci" },
      { line: 13, text: "  - run: npm test" },
    ]);

    expect(selected).toMatchObject({
      source: "diff",
      text: "  - run: npm ci\n  - run: npm test",
      startLine: 12,
      endLine: 13,
    });
  });

  it("carries the row text as given, markers already stripped by the pane", () => {
    expect(passageFromRows([{ line: 3, text: "plain" }])?.text).toBe("plain");
  });
});

describe("attachPassage", () => {
  it("stacks distinct regions", () => {
    const stacked = attachPassage([passage({ id: "a" })], passage({ id: "b" }));
    expect(stacked.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("refuses to attach the same region twice", () => {
    const once = [passage({ id: "a" })];
    expect(attachPassage(once, passage({ id: "a" }))).toBe(once);
  });
});

describe("annotatePassage", () => {
  it("puts a comment on one passage and leaves the others alone", () => {
    const before = [passage({ id: "a" }), passage({ id: "b" })];
    const after = annotatePassage(before, "b", "why this?");

    expect(after.find((p) => p.id === "b")?.note).toBe("why this?");
    expect(after.find((p) => p.id === "a")?.note).toBeUndefined();
  });

  it("does nothing for an id that is not there", () => {
    const before = [passage({ id: "a" })];
    expect(annotatePassage(before, "nope", "x")).toEqual(before);
  });
});

describe("isAnswered / unanswered", () => {
  it("treats blank and whitespace-only comments as unanswered", () => {
    expect(isAnswered(passage())).toBe(false);
    expect(isAnswered(passage({ note: "" }))).toBe(false);
    expect(isAnswered(passage({ note: "   \n  " }))).toBe(false);
    expect(isAnswered(passage({ note: "ok" }))).toBe(true);
  });

  it("lists exactly the ones still waiting", () => {
    const some = [
      passage({ id: "a", note: "done" }),
      passage({ id: "b" }),
      passage({ id: "c", note: "  " }),
    ];
    expect(unanswered(some).map((p) => p.id)).toEqual(["b", "c"]);
  });
});

describe("sortPassages", () => {
  it("puts them in reading order, not clicking order", () => {
    const clicked = [
      passage({ id: "late", startLine: 7, endLine: 7 }),
      passage({ id: "early", startLine: 3, endLine: 3 }),
    ];
    expect(sortPassages(clicked).map((p) => p.id)).toEqual(["early", "late"]);
  });

  it("breaks ties on where the region ends", () => {
    const same = [
      passage({ id: "long", startLine: 2, endLine: 9 }),
      passage({ id: "short", startLine: 2, endLine: 3 }),
    ];
    expect(sortPassages(same).map((p) => p.id)).toEqual(["short", "long"]);
  });

  it("does not mutate what it was given", () => {
    const clicked = [passage({ id: "b", startLine: 9 }), passage({ id: "a", startLine: 1 })];
    sortPassages(clicked);
    expect(clicked.map((p) => p.id)).toEqual(["b", "a"]);
  });
});

describe("rangeOf", () => {
  it("names a single line", () => {
    expect(rangeOf(passage({ startLine: 7, endLine: 7 }))).toBe("line 7");
  });

  it("names a span", () => {
    expect(rangeOf(passage({ startLine: 7, endLine: 9 }))).toBe("lines 7–9");
  });
});

describe("describePassages", () => {
  it("counts once there is more than one", () => {
    expect(describePassages([])).toBe("nothing");
    expect(describePassages([passage()])).toBe("line 1");
    expect(describePassages([passage(), passage({ id: "b" })])).toBe("2 passages");
  });
});

describe("quotePassages", () => {
  it("quotes one passage with its path and range", () => {
    const message = quotePassages("deploy.yml", [passage({ startLine: 3, endLine: 4 })], "");

    // The shape is the same for one passage as for ten: the file names itself
    // once, then every region gets its own labelled block. A comment has to be
    // able to sit under any of them without the header moving.
    expect(message).toContain("`deploy.yml`:");
    expect(message).toContain("lines 3–4:");
    expect(message).toContain("```\nhello\n```");
  });

  it("puts the note last, so it reads as being about everything above", () => {
    const message = quotePassages("deploy.yml", [passage()], "why is this here?");
    expect(message.trimEnd().endsWith("why is this here?")).toBe(true);
  });

  it("omits the note when there is none", () => {
    expect(quotePassages("deploy.yml", [passage()], "").trimEnd().endsWith("```")).toBe(true);
  });

  it("labels each passage once several are stacked", () => {
    const message = quotePassages(
      "deploy.yml",
      [
        passage({ id: "a", startLine: 1, endLine: 2, text: "first" }),
        passage({ id: "b", startLine: 9, endLine: 9, text: "second", source: "diff" }),
      ],
      "reconcile these",
    );

    expect(message).toContain("lines 1–2:");
    expect(message).toContain("line 9 (from the diff):");
    expect(message).toContain("first");
    expect(message).toContain("second");
    expect(message.trimEnd().endsWith("reconcile these")).toBe(true);
  });

  it("marks where a passage came from, so the lines can be found again", () => {
    const fromDiff = quotePassages("deploy.yml", [passage({ source: "diff" })], "");
    expect(fromDiff).toContain("(from the diff)");
    expect(quotePassages("deploy.yml", [passage()], "")).not.toContain("(from the diff)");
  });

  it("widens the fence so a quoted code fence cannot close it early", () => {
    const markdown = "before\n```bash\nnpm run verify\n```\nafter";
    const message = quotePassages("CONTRIBUTING.md", [passage({ text: markdown })], "explain");

    expect(message).toContain("````\n" + markdown + "\n````");
    // The instruction must still be outside the quote, not swallowed by it.
    expect(message.trimEnd().endsWith("explain")).toBe(true);
  });

  it("falls back to the bare note when nothing is selected", () => {
    expect(quotePassages("deploy.yml", [], "just asking")).toBe("just asking");
  });

  it("emits passages in reading order, whatever order they were clicked in", () => {
    const message = quotePassages(
      "test.md",
      [
        passage({ id: "late", startLine: 7, endLine: 7, text: "seventh", source: "diff" }),
        passage({ id: "early", startLine: 3, endLine: 3, text: "third", source: "diff" }),
      ],
      "",
    );

    expect(message.indexOf("line 3"), "line 3 must come first").toBeLessThan(
      message.indexOf("line 7"),
    );
  });

  it("puts each comment directly under the passage it belongs to", () => {
    const message = quotePassages(
      "test.md",
      [
        passage({ id: "a", startLine: 1, endLine: 1, text: "first", note: "why is this here?" }),
        passage({ id: "b", startLine: 5, endLine: 5, text: "second", note: "and this?" }),
      ],
      "",
    );

    // Each comment is a blockquote immediately after its own fence, so no reader
    // has to guess which remark belongs to which region.
    expect(message).toContain("```\nfirst\n```\n> why is this here?");
    expect(message).toContain("```\nsecond\n```\n> and this?");
  });

  it("quotes a multi-line comment on every line", () => {
    const message = quotePassages("test.md", [passage({ note: "one\ntwo" })], "");
    expect(message).toContain("> one\n> two");
  });

  it("leaves a passage bare when it has no comment yet", () => {
    const message = quotePassages("test.md", [passage({ text: "solo" })], "");
    expect(message).not.toContain(">");
    expect(message.trimEnd().endsWith("```")).toBe(true);
  });
});
