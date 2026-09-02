import { describe, expect, it } from "vitest";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ENTRY_POINTS, useServer } from "./harness.js";

const uiMeta = (tool: Tool) =>
  (tool._meta as { ui?: { visibility?: string[]; resourceUri?: string } } | undefined)?.ui;

describe.each(ENTRY_POINTS)("the tool surface, running from %s", (_label, SERVER) => {
  const rig = useServer(SERVER);

  it("marks every writing tool app-only so the host keeps it away from the model", async () => {
    const { tools } = await rig.client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));

    for (const name of ["editor_commit", "editor_update", "editor_attach", "editor_discard"]) {
      expect(uiMeta(byName.get(name)!)?.visibility, `${name} must be app-only`).toEqual(["app"]);
    }

    for (const name of [
      "propose_write",
      "propose_delete",
      "open_file",
      "read_file",
      "list_roots",
    ]) {
      expect(uiMeta(byName.get(name)!)?.visibility, `${name} should reach the model`).toContain(
        "model",
      );
    }
  });

  it("points the editor-opening tools at the View", async () => {
    const { tools } = await rig.client.listTools();
    for (const name of ["propose_write", "propose_delete", "open_file"]) {
      const tool = tools.find((t) => t.name === name)!;
      expect(uiMeta(tool)?.resourceUri).toBe("ui://interactive-editor/panel.html");
    }

    const { resources } = await rig.client.listResources();
    expect(resources.some((r) => r.uri === "ui://interactive-editor/panel.html")).toBe(true);
  });

  it("serves the View as self-contained MCP App HTML", async () => {
    const read = await rig.client.readResource({ uri: "ui://interactive-editor/panel.html" });
    const [content] = read.contents as Array<{ mimeType?: string; text?: string }>;

    expect(content.mimeType).toBe("text/html;profile=mcp-app");
    expect(content.text).toContain("<!doctype html>");
    expect(content.text ?? "", "an empty View is what a host reports as length 0").not.toBe("");
    expect((content.text ?? "").length).toBeGreaterThan(10_000);
    expect(content.text ?? "", "this is the source stub, not the built panel").not.toContain(
      "/src/main.tsx",
    );
    expect(content.text, "the View must not load external scripts").not.toMatch(
      /<script[^>]+src=["']http/i,
    );
  });

  /*
   * The spec builds the sandbox CSP from what `resources/read` returns, and
   * documents the listing entry as a fallback a server may not even publish.
   * Metadata that exists only on the listing rides on that fallback.
   */
  it("carries the sandbox metadata on the content item, not only the listing", async () => {
    // Act.
    const read = await rig.client.readResource({ uri: "ui://interactive-editor/panel.html" });
    const [content] = read.contents as Array<{
      _meta?: { ui?: { csp?: Record<string, string[]>; prefersBorder?: boolean } };
    }>;

    // Assert.
    const ui = content._meta?.ui;
    expect(ui, "the read item must carry _meta.ui").toBeTruthy();
    expect(ui?.prefersBorder).toBe(true);
    expect(ui?.csp).toEqual({ connectDomains: [], resourceDomains: [], frameDomains: [] });
  });
});
