/**
 * @module
 *
 * The question the commit path asks about the connected host.
 *
 * Kept apart from registration so it can be answered from a plain object rather
 * than only from a live server over a transport.
 */
import type { ClientCapabilities } from "@modelcontextprotocol/sdk/types.js";
import { RESOURCE_MIME_TYPE, getUiCapability } from "@modelcontextprotocol/ext-apps/server";

/**
 * Reports whether the connected host renders MCP Apps.
 *
 * `visibility: ["app"]` is a request to the host, not a guarantee — a host that
 * does not implement MCP Apps hands every tool to the agent, `editor_attach`
 * included, and the agent can then mark its own proposal as reviewed. A client's
 * declared capabilities are the one input the agent does not get to author, so
 * that is what the commit path asks.
 *
 * MCP Apps § Client Capabilities marks `mimeTypes` REQUIRED, and
 * `getUiCapability` performs no validation of its own. An absent list is
 * therefore a malformed declaration, not a permissive one: treating it as
 * support would let `extensions: {"io.modelcontextprotocol/ui": {}}` open the
 * commit path on a host that renders nothing.
 *
 * @param capabilities - What the client declared on initialize, if anything.
 * @returns True only when the client declared the App resource mime type.
 * @gate Carries the "nobody commits what nobody saw" invariant.
 */
export function rendersPanel(capabilities: ClientCapabilities | undefined): boolean {
  /*
   * Narrowed by hand rather than trusted.
   *
   * `getUiCapability`'s own declaration names a type its package does not
   * export, so its return type resolves to the error type and every property
   * read off it typechecks against nothing. `skipLibCheck` hides the
   * declaration error, which leaves the most security-critical predicate here
   * as the one line the compiler is not reading. Checking the shape explicitly
   * puts it back under the compiler, and survives the SDK fixing its types.
   */
  const ui: unknown = getUiCapability(capabilities);
  if (typeof ui !== "object" || ui === null) return false;

  const declared = (ui as { mimeTypes?: unknown }).mimeTypes;
  return Array.isArray(declared) && declared.includes(RESOURCE_MIME_TYPE);
}
