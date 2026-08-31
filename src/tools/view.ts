import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RESOURCE_MIME_TYPE, registerAppResource } from "@modelcontextprotocol/ext-apps/server";
import { VIEW_URI } from "./context.js";

/**
 * The panel itself, served as one self-contained HTML resource.
 */
export function registerEditorView(server: McpServer): void {
  registerAppResource(
    server,
    "Interactive Editor",
    VIEW_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      _meta: {
        ui: {
          // The bundle is inlined, so the View needs nothing from the network.
          // Every list stays empty on purpose: an editor that can phone home is
          // a worse thing than the writes it is guarding.
          csp: { connectDomains: [], resourceDomains: [], frameDomains: [] },
          prefersBorder: true,
        },
      },
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: RESOURCE_MIME_TYPE, text: await loadViewHtml() }],
    }),
  );
}

let cachedHtml: string | undefined;

async function loadViewHtml(): Promise<string> {
  if (cachedHtml) return cachedHtml;
  const here = dirname(fileURLToPath(import.meta.url));
  // Both are two levels up, but from different trees: compiled, `here` is
  // dist/src/tools; under tsx it is src/tools and the built panel is still the
  // one to serve. (The old fallback here climbed one level too far and would
  // have looked outside the package.)
  const candidates = [
    resolve(here, "../../ui/index.html"), // dist/src/tools -> dist/ui
    resolve(here, "../../dist/ui/index.html"), // src/tools -> dist/ui
  ];
  for (const candidate of candidates) {
    try {
      cachedHtml = await readFile(candidate, "utf8");
      return cachedHtml;
    } catch {
      continue;
    }
  }
  throw new Error("The panel is not built. Run `npm run build` first.");
}
