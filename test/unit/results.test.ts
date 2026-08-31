import { describe, expect, it } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { messageOf, refusalIn, textOf } from "../../ui/src/lib/results.js";

const result = (over: Partial<CallToolResult>): CallToolResult =>
  ({ content: [], ...over }) as CallToolResult;

describe("refusalIn", () => {
  /*
   * The panel treated a refused call as an empty one: it retried
   * `editor_pending` for thirty seconds and then reported that asking "kept
   * coming back empty", while the host had been answering with the reason every
   * hundred milliseconds.
   */
  it("is null when the call succeeded", () => {
    expect(refusalIn(result({ content: [{ type: "text", text: "fine" }] }))).toBeNull();
  });

  it("returns the reason when the call refused", () => {
    const refused = result({
      isError: true,
      content: [{ type: "text", text: "This tool requires approval." }],
    });
    expect(refusalIn(refused)).toBe("This tool requires approval.");
  });

  it("still says something when a refusal carries no text", () => {
    expect(refusalIn(result({ isError: true }))).toMatch(/without saying why/i);
  });

  it("joins every text block, because refusals are not always one line", () => {
    const refused = result({
      isError: true,
      content: [
        { type: "text", text: "Refusing to write:" },
        { type: "text", text: "  - the file changed on disk" },
      ],
    });
    expect(refusalIn(refused)).toContain("changed on disk");
  });
});

describe("textOf", () => {
  it("ignores blocks that are not text", () => {
    const mixed = result({
      content: [
        { type: "image", data: "…", mimeType: "image/png" },
        { type: "text", text: "kept" },
      ],
    });
    expect(textOf(mixed)).toBe("kept");
  });
});

describe("messageOf", () => {
  it("prefers a real Error's message", () => {
    expect(messageOf(new Error("boom"))).toBe("boom");
  });

  it("copes with whatever else a rejection threw", () => {
    expect(messageOf("just a string")).toBe("just a string");
  });
});
