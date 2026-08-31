import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RESOURCE_MIME_TYPE, registerAppResource } from "@modelcontextprotocol/ext-apps/server";
import { VIEW_URI } from "./context.js";

/**
 * How the host should frame and confine the panel.
 *
 * The bundle is inlined, so the View needs nothing from the network. Every list
 * stays empty on purpose: an editor that can phone home is a worse thing than
 * the writes it is guarding.
 */
const UI_META = {
  csp: { connectDomains: [], resourceDomains: [], frameDomains: [] },
  prefersBorder: true,
} as const;

/**
 * Registers the panel as one self-contained HTML resource.
 *
 * @param server - The MCP server to register against.
 */
export function registerEditorView(server: McpServer): void {
  registerAppResource(
    server,
    "Interactive Editor",
    VIEW_URI,
    { mimeType: RESOURCE_MIME_TYPE, _meta: { ui: UI_META } },
    async (uri) => ({
      /*
       * The same metadata on the content item, not only on the listing entry.
       * MCP Apps § Resource Metadata builds the sandbox CSP from what
       * `resources/read` returns; the listing entry is documented as a
       * fallback, and a server is free to omit UI resources from
       * `resources/list` entirely — in which case the listing is never read and
       * `prefersBorder` is lost with it.
       */
      contents: [
        {
          uri: uri.href,
          mimeType: RESOURCE_MIME_TYPE,
          text: await loadViewHtml(),
          _meta: { ui: UI_META },
        },
      ],
    }),
  );
}

/**
 * Where the built panel might sit, relative to the module asking.
 *
 * The server runs from three different trees and they disagree:
 *
 *   .mcpb / plugin   <root>/server/index.js        -> <root>/ui
 *   compiled         <root>/dist/src/tools/view.js -> <root>/dist/ui
 *   from source      <repo>/src/tools/view.ts      -> <repo>/dist/ui
 *
 * The shipped bundle is the flat one, and it is the layout that matters most:
 * getting it wrong means the host asks for the panel, receives nothing, and
 * reports an empty UI resource rather than anything that points here.
 */
const PANEL_CANDIDATES = ["../ui/index.html", "../../ui/index.html", "../../dist/ui/index.html"];

let cachedHtml: string | undefined;

/**
 * Loads the built panel, trying each candidate location.
 *
 * @returns The panel's HTML.
 * @throws {Error} When no candidate holds a complete build.
 */
async function loadViewHtml(): Promise<string> {
  if (cachedHtml) return cachedHtml;

  const here = dirname(fileURLToPath(import.meta.url));
  const missing: string[] = [];
  const rejected: string[] = [];

  for (const candidate of PANEL_CANDIDATES) {
    const path = resolve(here, candidate);

    let html: string;
    try {
      html = await readFile(path, "utf8");
    } catch {
      missing.push(path);
      continue;
    }

    const problem = whyNotPanel(html);
    if (problem) {
      rejected.push(`${path} — ${problem}`);
      continue;
    }

    cachedHtml = html;
    return cachedHtml;
  }

  // Which failure this was decides the fix, and all a host ever surfaces is that
  // the resource came back empty.
  throw new Error(
    [
      "Could not serve the editor panel.",
      ...(rejected.length > 0
        ? ["Found, but not usable as the panel:", ...rejected.map((r) => `  ${r}`)]
        : []),
      ...(missing.length > 0 ? ["Not found:", ...missing.map((p) => `  ${p}`)] : []),
      "`npm run build` produces it; `npm run bundle` puts it beside the server for",
      "the shipped tree.",
    ].join("\n"),
  );
}

/**
 * The built panel is one self-contained file with everything inlined, so it is
 * always far larger than this. The threshold exists to reject a truncated or
 * half-written build, which would otherwise be served and render as a blank
 * surface.
 */
const MIN_PANEL_BYTES = 10_000;

/**
 * Reports why a candidate is not a usable panel, or null when it is one.
 *
 * `ui/index.html` in the source tree is a vite entry stub that loads
 * `/src/main.tsx`, and it is reachable from more than one of the candidates
 * above. Two of those candidates also resolve above the package root, so
 * whatever is found there deserves suspicion rather than trust: this surface
 * gets the app-only tools, `editor_commit` included.
 *
 * Returns null when the content is the panel, or the reason it is not.
 */
function whyNotPanel(html: string): string | null {
  if (html.includes("/src/main.tsx")) return "this is the vite entry stub, not a build";
  if (html.length < MIN_PANEL_BYTES) {
    return `only ${html.length} bytes, so it is not a complete build`;
  }
  return null;
}
