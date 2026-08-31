#!/usr/bin/env node
import { homedir } from "node:os";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DEFAULT_DENY, FsGuard } from "./fsGuard.js";
import { registerTools } from "./tools/index.js";

interface Cli {
  roots: string[];
  deny: string[];
  dryRun: boolean;
  terminalApproval: boolean;
}

/** MCPB bundles cannot add a flag conditionally, so dry run is also an env var. */
function dryRunFromEnv(): boolean {
  const raw = process.env.INTERACTIVE_EDITOR_DRY_RUN?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

function parseArgs(argv: string[]): Cli {
  const cli: Cli = {
    roots: [],
    deny: [...DEFAULT_DENY],
    dryRun: dryRunFromEnv(),
    terminalApproval: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root-from-cwd") {
      // For hosts that launch the server in the project directory — Claude Code
      // does. Explicit rather than implicit: a server that silently adopts its
      // working directory as writable is a server nobody audited.
      cli.roots.push(process.cwd());
    } else if (arg === "--terminal-approval") {
      cli.terminalApproval = true;
    } else if (arg === "--root") {
      const value = argv[++i];
      if (!value) throw new Error("--root needs a directory");
      cli.roots.push(expandHome(value));
    } else if (arg.startsWith("--root=")) {
      cli.roots.push(expandHome(arg.slice("--root=".length)));
    } else if (arg === "--deny") {
      const value = argv[++i];
      if (!value) throw new Error("--deny needs a pattern");
      cli.deny.push(value);
    } else if (arg.startsWith("--deny=")) {
      cli.deny.push(arg.slice("--deny=".length));
    } else if (arg === "--allow-everything-in-roots") {
      cli.deny = [];
    } else if (arg === "--dry-run") {
      cli.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(HELP);
      process.exit(0);
    } else if (!arg.startsWith("-")) {
      cli.roots.push(expandHome(arg));
    } else {
      throw new Error(`Unknown flag ${arg}`);
    }
  }

  return cli;
}

function expandHome(p: string): string {
  return p.startsWith("~") ? resolve(homedir(), p.slice(1).replace(/^[/\\]/, "")) : resolve(p);
}

const HELP = `mcp-interactive-editor — a live-edit review panel in front of every file write.

Usage:
  mcp-interactive-editor --root <dir> [--root <dir> ...] [options]

Options:
  --root <dir>                 A directory the editor may write inside. Required, repeatable.
  --root-from-cwd              Add the working directory as a root. For hosts that
                               launch the server inside the project (Claude Code).
  --deny <substring>           Extra path substring to refuse. Repeatable.
  --allow-everything-in-roots  Drop the built-in deny list (.git, node_modules, .env, keys...).
  --dry-run                    Run the whole flow but never touch disk.
  --terminal-approval          Expose the commit tool to the agent, for hosts that
                               cannot render the editor. You get your client's
                               approve/deny prompt instead of an editor. Weaker.
  -h, --help                   This.

Every write goes through a View the human edits and approves. The agent can open
the editor; only a click can walk through it.
`;

async function main(): Promise<void> {
  let cli: Cli;
  try {
    cli = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n\n${HELP}`);
    process.exit(2);
  }

  if (cli.roots.length === 0) {
    process.stderr.write(`No --root given.\n\n${HELP}`);
    process.exit(2);
  }

  const guard = new FsGuard({ roots: cli.roots, deny: cli.deny, dryRun: cli.dryRun });
  const commitVisibility: Array<"model" | "app"> = cli.terminalApproval
    ? ["model", "app"]
    : ["app"];

  const server = new McpServer(
    { name: "interactive-editor", version: "0.2.1" },
    {
      instructions:
        "propose_write opens an editable review panel: the human gets a live diff against disk, " +
        "edits your draft in place, and saves. Reach for it when a write is worth a second pair " +
        "of eyes, and open_file when they would rather write the change themselves. Passages they " +
        "select in either pane come back to you as quotes with line numbers.",
    },
  );

  registerTools(server, guard, { commitVisibility, terminalApproval: cli.terminalApproval });

  // stdout is the transport; anything logged there corrupts the protocol.
  process.stderr.write(
    `interactive-editor ready. Roots:\n${guard.roots.map((r) => `  ${r}`).join("\n")}\n` +
      (guard.dryRun ? "DRY RUN: no writes will reach disk.\n" : "") +
      (cli.terminalApproval
        ? "TERMINAL APPROVAL: the commit tool is exposed to the agent. Your client's\n" +
          "approve/deny prompt is the only gate — do not allowlist that tool.\n"
        : ""),
  );

  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  process.stderr.write(`interactive-editor failed to start: ${(error as Error).message}\n`);
  process.exit(1);
});
