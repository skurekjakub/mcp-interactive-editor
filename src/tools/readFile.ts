import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { ToolContext } from "./context.js";
import { errorResult } from "./results.js";

export function registerReadFile(server: McpServer, { guard }: ToolContext): void {
  registerAppTool(
    server,
    "read_file",
    {
      title: "Read a file inside the roots",
      description:
        "Read a file the editor is allowed to write, so a proposal can be based on what is actually " +
        "there. Refuses anything outside the configured roots.",
      inputSchema: { path: z.string() },
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async ({ path }) => {
      const target = await guard.describe(path);
      if (!target.absolute) {
        return errorResult(`${path} is outside the roots this server will touch.`);
      }
      if (!target.exists) {
        return { content: [{ type: "text", text: `${target.display} does not exist.` }] };
      }
      const body = await guard.read(target.absolute);
      return { content: [{ type: "text", text: body }] };
    },
  );
}
