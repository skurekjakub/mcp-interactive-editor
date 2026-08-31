#!/usr/bin/env node
import { homedir } from "node:os";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DEFAULT_DENY, FsGuard } from "./fsGuard.js";
import { registerTools } from "./tools/index.js";
import { SERVER_VERSION } from "./version.js";

/** Everything the command line can decide. */
interface Cli {
  roots: string[];
  deny: string[];
  dryRun: boolean;
  terminalApproval: boolean;
  reviewTimeoutMs?: number;
  reviewGraceMs?: number;
  blockOnReview: boolean;
}

/**
 * Reads the dry-run setting from the environment.
 *
 * MCPB bundles cannot add a flag conditionally, so dry run is also an env var.
 *
 * @returns True when the environment asks for a dry run.
 */
function dryRunFromEnv(): boolean {
  const raw = process.env.INTERACTIVE_EDITOR_DRY_RUN?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

/**
 * Reads a positive-integer flag value.
 *
 * An unvalidated `Number()` turns a typo into `NaN`, and every comparison
 * against `NaN` is false — so a mistyped timing flag disables the wait it was
 * meant to configure and reports the timeout as "within NaN minutes".
 *
 * @param flag - The flag name, for the error message.
 * @param raw - The argument that followed it, if any.
 * @returns The parsed number.
 * @throws {Error} When the value is missing, not a number, or not positive.
 */
function positiveInt(flag: string, raw: string | undefined): number {
  const value = Number(raw);
  if (raw === undefined || raw === "" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${flag} needs a positive number of milliseconds, got ${raw ?? "nothing"}`);
  }
  return value;
}

/**
 * Reads the value attached to a `--flag=value` argument.
 *
 * An empty value is refused rather than accepted. `--root=` would otherwise
 * resolve to the working directory and silently make it writable, which is
 * exactly what an operator writing `--root="$PROJECT_DIR"` with an unset
 * variable must not get; `--deny=` would put the empty string in the deny list
 * and refuse every path in the roots.
 *
 * @param flag - The flag name, for the error message.
 * @param arg - The whole argument, including its `=`.
 * @returns The value after the `=`.
 * @throws {Error} When the value is empty.
 */
function inlineValue(flag: string, arg: string): string {
  const value = arg.slice(flag.length + 1);
  if (value.trim() === "") throw new Error(`${flag} needs a value`);
  return value;
}

/**
 * Parses the command line.
 *
 * @param argv - Arguments, excluding the node binary and script path.
 * @returns The parsed settings.
 * @throws {Error} When a flag is unknown or its value is unusable.
 */
function parseArgs(argv: string[]): Cli {
  const cli: Cli = {
    roots: [],
    deny: [...DEFAULT_DENY],
    dryRun: dryRunFromEnv(),
    terminalApproval: false,
    blockOnReview: false,
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
    } else if (arg === "--review-timeout-ms") {
      cli.reviewTimeoutMs = positiveInt(arg, argv[++i]);
    } else if (arg.startsWith("--review-timeout-ms=")) {
      cli.reviewTimeoutMs = positiveInt(
        "--review-timeout-ms",
        inlineValue("--review-timeout-ms", arg),
      );
    } else if (arg === "--block-on-review") {
      cli.blockOnReview = true;
    } else if (arg === "--review-grace-ms") {
      cli.reviewGraceMs = positiveInt(arg, argv[++i]);
    } else if (arg.startsWith("--review-grace-ms=")) {
      cli.reviewGraceMs = positiveInt("--review-grace-ms", inlineValue("--review-grace-ms", arg));
    } else if (arg === "--root") {
      const value = argv[++i];
      if (!value) throw new Error("--root needs a directory");
      cli.roots.push(expandHome(value));
    } else if (arg.startsWith("--root=")) {
      cli.roots.push(expandHome(inlineValue("--root", arg)));
    } else if (arg === "--deny") {
      const value = argv[++i];
      if (!value) throw new Error("--deny needs a pattern");
      cli.deny.push(value);
    } else if (arg.startsWith("--deny=")) {
      cli.deny.push(inlineValue("--deny", arg));
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

/**
 * Expands a leading `~` and resolves the path.
 *
 * @param p - A path, possibly relative or home-relative.
 * @returns The absolute path.
 */
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
  --block-on-review            Hold the opening call open until the human accepts or
                               comments, so its result is the decision. Needs a host
                               that dispatches the panel's calls while one is open;
                               where it does not, the panel never loads. Off by default.
  --review-timeout-ms <ms>     How long an opening call waits for the human. Default 600000.
  --review-grace-ms <ms>       How long to wait for the panel to attach. Default 30000.
  -h, --help                   This.

Every write goes through a View the human edits and approves. The agent can open
the editor; only a click can walk through it.
`;

/**
 * Starts the server on stdio.
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

  if (cli.roots.length === 0) {
    process.stderr.write(`No --root given.\n\n${HELP}`);
    process.exit(2);
  }

  const guard = new FsGuard({ roots: cli.roots, deny: cli.deny, dryRun: cli.dryRun });
  const commitVisibility: Array<"model" | "app"> = cli.terminalApproval
    ? ["model", "app"]
    : ["app"];

  const server = new McpServer(
    { name: "interactive-editor", version: SERVER_VERSION },
    {
      instructions:
        "propose_write opens an editable review panel: the human gets a live diff against disk, " +
        "edits your draft in place, and either saves it or comments on it. Reach for it when a " +
        "write is worth a second pair of eyes, and open_file when they would rather write the " +
        "change themselves.\n\n" +
        "It returns as soon as the panel is open. The outcome reaches you separately: a receipt " +
        "if they saved, or their comments quoted against the lines they are about. Comments mean " +
        "the draft was declined — nothing was written, so redraft from what they said rather than " +
        "re-proposing the same content.\n\n" +
        "Started with --block-on-review, the call instead waits and its own result is the outcome.",
    },
  );

  registerTools(server, guard, {
    commitVisibility,
    terminalApproval: cli.terminalApproval,
    blockOnReview: cli.blockOnReview,
    ...(cli.reviewTimeoutMs !== undefined ? { reviewTimeoutMs: cli.reviewTimeoutMs } : {}),
    ...(cli.reviewGraceMs !== undefined ? { reviewGraceMs: cli.reviewGraceMs } : {}),
  });

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
