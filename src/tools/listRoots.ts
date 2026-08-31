import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { ToolContext } from "./context.js";

export function registerListRoots(server: McpServer, { guard }: ToolContext): void {
  registerAppTool(
    server,
    "list_roots",
    {
      title: "List writable roots",
      description: "The directories this editor will write inside. Everything else is refused.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async () => ({
      content: [
        {
          type: "text",
          text:
            `Writable roots:\n${guard.roots.map((r) => `  ${r}`).join("\n")}` +
            (guard.dryRun ? "\n\nDRY RUN: commits are simulated, nothing reaches disk." : ""),
        },
      ],
      structuredContent: { roots: guard.roots, dryRun: guard.dryRun },
    }),
  );
}
