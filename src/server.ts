#!/usr/bin/env node
/**
 * @module
 *
 * The entry point: reads the command line, builds the guard, points the store
 * at the directory this configuration shares with its siblings, and connects
 * whichever transport was asked for.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { type Cli, parseArgs } from "./cli.js";
import { FsGuard } from "./fsGuard.js";
import { HELP } from "./help.js";
import { serveHttp } from "./http.js";
import { configureStore, storePathFor } from "./store.js";
import { registerTools, type ToolOptions } from "./tools/index.js";
import { serverInstructions } from "./tools/wording.js";
import { SERVER_VERSION } from "./version.js";

/**
 * Starts the server on whichever transport was asked for.
 *
 * @returns A promise that settles when the transport closes.
 */
async function main(): Promise<void> {
  const cli = readCommandLine();
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

  const toolOptions: ToolOptions = {
    commitVisibility: cli.terminalApproval ? ["model", "app"] : ["app"],
    terminalApproval: cli.terminalApproval,
    blockOnReview: cli.blockOnReview,
    ...(cli.reviewTimeoutMs !== undefined ? { reviewTimeoutMs: cli.reviewTimeoutMs } : {}),
    ...(cli.reviewGraceMs !== undefined ? { reviewGraceMs: cli.reviewGraceMs } : {}),
  };
  const instructions = serverInstructions(cli);

  // Under stdio, stdout is the transport and anything logged there corrupts the
  // protocol, so every line the server prints goes to stderr.
  process.stderr.write(banner(guard, cli));

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

/**
 * Parses the command line, or prints why it could not and exits.
 *
 * @returns The settings, once they are known to be usable.
 */
function readCommandLine(): Cli {
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

  return cli;
}

/**
 * Describes the running configuration for the operator's log.
 *
 * @param guard - The guard, for its roots and dry-run flag.
 * @param cli - The parsed settings.
 * @returns The lines to print on startup.
 */
function banner(guard: FsGuard, cli: Cli): string {
  return (
    `interactive-editor ready. Roots:\n${guard.roots.map((r) => `  ${r}`).join("\n")}\n` +
    (guard.dryRun ? "DRY RUN: no writes will reach disk.\n" : "") +
    (cli.terminalApproval
      ? "TERMINAL APPROVAL: the commit tool is exposed to the agent. Your client's\n" +
        "approve/deny prompt is the only gate — do not allowlist that tool.\n"
      : "")
  );
}

main().catch((error) => {
  process.stderr.write(`interactive-editor failed to start: ${(error as Error).message}\n`);
  process.exit(1);
});
