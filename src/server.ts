#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { type Cli, HELP, parseArgs } from "./cli.js";
import { FsGuard } from "./fsGuard.js";
import { serveHttp } from "./http.js";
import { configureStore, storePathFor } from "./store.js";
import { registerTools } from "./tools/index.js";
import { SERVER_VERSION } from "./version.js";

/**
 * Starts the server on whichever transport was asked for.
 *
 * @returns A promise that settles when the transport closes.
 */
async function main(): Promise<void> {
  let cli: Cli;
  try {
    cli = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n\n${HELP}`);
    process.exit(2);
  }

  if (cli.help) {
    process.stdout.write(HELP);
    process.exit(0);
  }

  if (cli.roots.length === 0) {
    process.stderr.write(`No --root given.\n\n${HELP}`);
    process.exit(2);
  }

  const guard = new FsGuard({ roots: cli.roots, deny: cli.deny, dryRun: cli.dryRun });

  /*
   * Proposals live in a directory, not in this process.
   *
   * A host is free to spawn this server more than once and route different
   * callers to different copies — Claude Desktop does, from two managers that
   * do not coordinate. The model then opens a proposal in one process and the
   * panel asks the other to attach to it. Deriving the directory from the
   * settings makes the siblings meet, and keeps servers with different roots
   * apart.
   */
  await configureStore(storePathFor({ roots: guard.roots, deny: cli.deny, dryRun: cli.dryRun }));
  const commitVisibility: Array<"model" | "app"> = cli.terminalApproval
    ? ["model", "app"]
    : ["app"];

  const toolOptions = {
    commitVisibility,
    terminalApproval: cli.terminalApproval,
    blockOnReview: cli.blockOnReview,
    ...(cli.reviewTimeoutMs !== undefined ? { reviewTimeoutMs: cli.reviewTimeoutMs } : {}),
    ...(cli.reviewGraceMs !== undefined ? { reviewGraceMs: cli.reviewGraceMs } : {}),
  };

  const instructions =
    "propose_write opens an editable review panel: the human gets a live diff against disk, " +
    "edits your draft in place, and either saves it or comments on it. Reach for it when a " +
    "write is worth a second pair of eyes, and open_file when they would rather write the " +
    "change themselves.\n\n" +
    "It returns as soon as the panel is open. The outcome reaches you separately: a receipt " +
    "if they saved, or their comments quoted against the lines they are about. Comments mean " +
    "the draft was declined — nothing was written, so redraft from what they said rather than " +
    "re-proposing the same content.\n\n" +
    "Started with --block-on-review, the call instead waits and its own result is the outcome.";

  // Under stdio, stdout is the transport and anything logged there corrupts the
  // protocol, so every line the server prints goes to stderr.
  process.stderr.write(
    `interactive-editor ready. Roots:\n${guard.roots.map((r) => `  ${r}`).join("\n")}\n` +
      (guard.dryRun ? "DRY RUN: no writes will reach disk.\n" : "") +
      (cli.terminalApproval
        ? "TERMINAL APPROVAL: the commit tool is exposed to the agent. Your client's\n" +
          "approve/deny prompt is the only gate — do not allowlist that tool.\n"
        : ""),
  );

  if (cli.http) {
    await serveHttp({
      port: cli.httpPort,
      guard,
      tools: toolOptions,
      instructions,
      allowedOrigins: cli.allowedOrigins,
    });
    process.stderr.write(
      `HTTP transport on http://127.0.0.1:${cli.httpPort}/mcp\n` +
        `Browser origins allowed:\n${cli.allowedOrigins.map((o) => `  ${o}`).join("\n")}\n`,
    );
    return;
  }

  const server = new McpServer(
    { name: "interactive-editor", version: SERVER_VERSION },
    { instructions },
  );
  registerTools(server, guard, toolOptions);
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  process.stderr.write(`interactive-editor failed to start: ${(error as Error).message}\n`);
  process.exit(1);
});
