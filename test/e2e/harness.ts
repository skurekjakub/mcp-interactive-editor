import { afterAll, beforeAll, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult, ClientCapabilities } from "@modelcontextprotocol/sdk/types.js";
import { EXTENSION_ID, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import type { EditorState, ProposalHandle } from "../../shared/types.js";

/**
 * Every e2e suite runs twice: once against the compiled `dist/`, and once
 * against the flat tree that the `.mcpb` and the Claude Code plugin actually
 * execute. The two layouts differ on disk, and that difference already shipped a
 * panel that resolved to the wrong file and rendered nothing. If it only passes
 * for one of these, it is not passing.
 *
 * The bundle is run from a COPY outside the repository, and that is the entire
 * point of testing it. Run in place and `../../dist/ui/index.html` resolves —
 * from `<repo>/bundle/server` up to `<repo>/dist/ui` — onto the real panel. That
 * path does not exist inside the shipped archive, so a server that had lost the
 * flat layout candidate would still satisfy every assertion while the `.mcpb`
 * was broken. Only a copy with nothing above it can see that.
 */
const PACKED_ROOT = mkdtempSync(join(tmpdir(), "interactive-editor-packed-"));
cpSync(fileURLToPath(new URL("../../bundle/", import.meta.url)), PACKED_ROOT, { recursive: true });

afterAll(() => {
  rmSync(PACKED_ROOT, { recursive: true, force: true });
});

/** The two server entry points, labelled for the suite title. */
export const ENTRY_POINTS = [
  ["dist", fileURLToPath(new URL("../../dist/src/server.js", import.meta.url))],
  ["the packed bundle", join(PACKED_ROOT, "server", "index.js")],
] as const;

/**
 * What a host that actually renders MCP Apps declares at initialize. The commit
 * path asks for this, so the default test client has to look like a real host —
 * and the tests that check the refusal deliberately do not.
 */
export const RENDERS_PANEL = {
  extensions: { [EXTENSION_ID]: { mimeTypes: [RESOURCE_MIME_TYPE] } },
} as unknown as ClientCapabilities;

/** A terminal agent: every tool reaches the model, and no panel ever appears. */
export const NO_PANEL: ClientCapabilities = {};

/**
 * The flags most suites start their server with.
 *
 * An opening call waits for the human under `--block-on-review`, so the timings
 * are pinned small: a test that never attaches a panel falls straight through
 * the grace period rather than sitting out the real thirty seconds.
 */
export const BLOCKING_ARGS = [
  "--block-on-review",
  "--review-grace-ms",
  "250",
  "--review-timeout-ms",
  "4000",
];

/** Calls one tool on one client. */
export type Caller = (name: string, args?: Record<string, unknown>) => Promise<CallToolResult>;

/**
 * Spawns a server and connects a client to it over stdio.
 *
 * @param server - Path of the server entry point.
 * @param args - Command-line arguments for the server.
 * @param capabilities - What the client declares at initialize.
 * @returns The connected client.
 */
export async function spawnServer(
  server: string,
  args: string[],
  capabilities: ClientCapabilities = RENDERS_PANEL,
): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [server, ...args],
    stderr: "ignore",
  });
  const client = new Client({ name: "editor-tests", version: "1.0.0" }, { capabilities });
  await client.connect(transport);
  return client;
}

/**
 * Binds a client to a caller.
 *
 * @param client - The connected client.
 * @returns A function that calls a tool by name.
 */
export function callOn(client: Client): Caller {
  return (name, args = {}) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>;
}

/** A server, its root, and a client connected to it, alive for one suite. */
export interface Rig {
  root: string;
  client: Client;
  call: Caller;
}

/**
 * Starts a server over a fresh root before the suite and tears it down after.
 *
 * @param server - Path of the server entry point.
 * @param options - Extra arguments and the capabilities to declare.
 * @returns A rig whose fields are filled in once the suite starts.
 */
export function useServer(
  server: string,
  options: { args?: string[]; capabilities?: ClientCapabilities } = {},
): Rig {
  const rig = {} as Rig;

  beforeAll(async () => {
    rig.root = await mkdtemp(join(tmpdir(), "interactive-editor-"));
    rig.client = await spawnServer(
      server,
      ["--root", rig.root, ...(options.args ?? BLOCKING_ARGS)],
      options.capabilities,
    );
    rig.call = callOn(rig.client);
  });

  afterAll(async () => {
    await rig.client?.close();
    await rm(rig.root, { recursive: true, force: true });
  });

  return rig;
}

/**
 * Reads the full editor state out of a panel-side result.
 *
 * @param result - The result of a panel tool.
 * @returns The state it carried.
 */
export function stateOf(result: CallToolResult): EditorState {
  return result.structuredContent as unknown as EditorState;
}

/**
 * Reads the claim ticket out of an opening tool's result.
 *
 * @param result - The result of an opening tool.
 * @returns The handle it carried.
 */
export function handleOf(result: CallToolResult): ProposalHandle {
  return result.structuredContent as unknown as ProposalHandle;
}

/**
 * Joins the text blocks of a result.
 *
 * @param result - Any tool result.
 * @returns Its text, one block per line.
 */
export function textOf(result: CallToolResult): string {
  return (result.content as Array<{ text?: string }>).map((c) => c.text ?? "").join("\n");
}

/**
 * Does what the panel does on mount: trades the handle in for the state behind it.
 *
 * @param call - The caller to attach through.
 * @param proposalId - The proposal to attach to.
 * @returns The full state.
 */
export async function attach(call: Caller, proposalId: string): Promise<EditorState> {
  return stateOf(await call("editor_attach", { proposalId }));
}

/**
 * Reads the same state without attaching, for tests that must stay unattached.
 *
 * A no-op update is what the panel sends anyway, so this exercises a real path.
 *
 * @param call - The caller to read through.
 * @param proposalId - The proposal to read.
 * @returns The full state.
 */
export async function peek(call: Caller, proposalId: string): Promise<EditorState> {
  return stateOf(await call("editor_update", { proposalId }));
}

/**
 * Proposes a write and reads the resulting state without attaching.
 *
 * @param call - The caller to propose through.
 * @param args - The `propose_write` arguments.
 * @returns The full state of the new proposal.
 */
export async function openPanel(call: Caller, args: Record<string, unknown>): Promise<EditorState> {
  return peek(call, handleOf(await call("propose_write", args)).proposalId);
}

/**
 * Asserts that a call was refused with a reason matching the pattern.
 *
 * A tool that throws comes back as `isError: true` with the reason in the text,
 * not as a protocol-level rejection — which is exactly what the panel reads, so
 * this asserts on the same shape the View does.
 *
 * @param call - The caller to refuse through.
 * @param name - The tool to call.
 * @param args - Its arguments.
 * @param pattern - What the refusal must say.
 * @returns The refused result.
 */
export async function refusal(
  call: Caller,
  name: string,
  args: Record<string, unknown>,
  pattern: RegExp,
): Promise<CallToolResult> {
  const result = await call(name, args);
  expect(result.isError, `${name} should have refused, got: ${textOf(result)}`).toBe(true);
  expect(textOf(result)).toMatch(pattern);
  return result;
}
