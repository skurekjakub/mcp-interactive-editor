import { describe, expect, it } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { deliveredIn, messageOf, refusalIn, textOf } from "../../ui/src/lib/results.js";

const result = (over: Partial<CallToolResult>): CallToolResult => ({ content: [], ...over });

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

describe("deliveredIn", () => {
  it("reports delivered when the server says so", () => {
    expect(deliveredIn(result({ structuredContent: { delivered: true } }))).toBe(true);
  });

  it("reports not delivered when the field is absent", () => {
    // The panel sends the message itself unless it is told not to, so an absent
    // field has to mean "nobody has said this yet". Reading it the other way
    // drops the outcome silently.
    expect(deliveredIn(result({ structuredContent: {} }))).toBe(false);
  });

  it("reports not delivered when there is no structured half at all", () => {
    expect(deliveredIn(result({}))).toBe(false);
  });

  it("does not accept a truthy value that is not true", () => {
    expect(deliveredIn(result({ structuredContent: { delivered: "yes" } }))).toBe(false);
  });
});
