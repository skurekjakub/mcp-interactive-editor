import type { ClientCapabilities } from "@modelcontextprotocol/sdk/types.js";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { describe, expect, it } from "vitest";
import { rendersPanel } from "../../src/hostCapability.js";

const EXTENSION_ID = "io.modelcontextprotocol/ui";

/** A client's declaration, shaped the way it arrives on initialize. */
function declaring(ui: unknown): ClientCapabilities {
  return { experimental: {}, extensions: { [EXTENSION_ID]: ui } } as ClientCapabilities;
}

describe("the commit gate's question about the host", () => {
  it("answers yes only when the App resource mime type is declared", () => {
    expect(rendersPanel(declaring({ mimeTypes: [RESOURCE_MIME_TYPE] }))).toBe(true);
  });

  it("refuses a host that declared the extension but no mime types", () => {
    // MCP Apps § Client Capabilities marks `mimeTypes` REQUIRED, so its absence
    // is a malformed declaration. Reading it as permissive would open the commit
    // path on a host that renders nothing.
    expect(rendersPanel(declaring({}))).toBe(false);
  });

  it("refuses a host whose declared mime types are empty", () => {
    expect(rendersPanel(declaring({ mimeTypes: [] }))).toBe(false);
  });

  it("refuses a host declaring some other mime type", () => {
    expect(rendersPanel(declaring({ mimeTypes: ["text/html"] }))).toBe(false);
  });

  it("refuses a client that never mentioned the extension", () => {
    expect(rendersPanel({ experimental: {} })).toBe(false);
  });

  it("refuses a client that declared no capabilities at all", () => {
    expect(rendersPanel(undefined)).toBe(false);
  });
});
