import { pathInput } from "./limits.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { countLines } from "../../shared/diff.js";
import type { ToolContext } from "./context.js";
import { explainRejection } from "../../shared/rejection.js";
import { errorResult } from "./wording.js";

/**
 * How much of a file to return to the model, in characters.
 *
 * A tool result becomes context, and returning a multi-megabyte file in one
 * block spends the window on something nobody asked to read in full.
 */
const READ_BUDGET = 200_000;

/**
 * Registers the tool that reads a file inside the roots.
 *
 * @param server - The MCP server to register against.
 * @param context - Guard, for resolving and reading the path.
 */
export function registerReadFile(server: McpServer, { guard }: ToolContext): void {
  registerAppTool(
    server,
    "read_file",
    {
      title: "Read a file inside the roots",
      description:
        "Reads a file the editor is allowed to write, so a proposal can be based on what is " +
        "actually there. Refuses anything outside the configured roots, and truncates very " +
        "large files.",
      inputSchema: { path: pathInput },
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async ({ path }) => {
      const target = await guard.describe(path);
      if (!target.absolute) return errorResult(explainRejection(target, guard.roots));
      if (!target.exists) {
        return { content: [{ type: "text", text: `${target.display} does not exist.` }] };
      }

      const body = await guard.read(target.absolute);
      if (body.length <= READ_BUDGET) {
        return { content: [{ type: "text", text: body }] };
      }

      const head = body.slice(0, READ_BUDGET);
      return {
        content: [
          {
            type: "text",
            text:
              `${head}\n\n… truncated. ${target.display} is ${countLines(body)} lines ` +
              `(${body.length} characters); the first ${READ_BUDGET} are shown. ` +
              `Open it in the editor to see the rest.`,
          },
        ],
      };
    },
  );
}
