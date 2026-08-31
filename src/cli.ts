/**
 * @module
 *
 * Turns an argument list into settings.
 *
 * Nothing here reads `process`, so every decision the command line makes is
 * reachable from a unit test rather than only from a spawned server.
 */
import { homedir } from "node:os";
import { resolve } from "node:path";
import { DEFAULT_DENY } from "./fsGuard.js";

/** Everything the command line can decide. */
export interface Cli {
  roots: string[];
  deny: string[];
  dryRun: boolean;
  terminalApproval: boolean;
  reviewTimeoutMs?: number;
  reviewGraceMs?: number;
  blockOnReview: boolean;
  /** True when help was asked for, which the caller prints and exits on. */
  help?: boolean;
}

/**
 * Reads the dry-run setting from the environment.
 *
 * MCPB bundles cannot add a flag conditionally, so dry run is also an env var.
 *
 * @param env - The environment to read.
 * @returns True when the environment asks for a dry run.
 */
function dryRunFromEnv(env: NodeJS.ProcessEnv): boolean {
  const raw = env.INTERACTIVE_EDITOR_DRY_RUN?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

/**
 * A dash followed by a letter, which no operator means as a value.
 *
 * Digits are excluded so a negative number reaches the check that refuses it for
 * being negative, rather than being reported as a misplaced flag.
 */
const LOOKS_LIKE_FLAG = /^--?[A-Za-z]/;

/**
 * Reads the argument that follows a flag.
 *
 * A flag consuming the next flag as its value is the failure worth guarding:
 * `--deny --dry-run` would take the deny pattern and leave the server writing to
 * disk, which is the opposite of what was asked for, reported as success.
 *
 * @param flag - The flag name, for the error message.
 * @param argv - The whole argument list.
 * @param index - Where the value should be.
 * @returns The value that followed the flag.
 * @throws {Error} When the value is missing, blank, or itself a flag.
 */
function nextValue(flag: string, argv: string[], index: number): string {
  const value = argv[index];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${flag} needs a value, and nothing followed it`);
  }
  if (LOOKS_LIKE_FLAG.test(value)) {
    throw new Error(
      `${flag} needs a value, but ${value} followed it. ` +
        `Write ${flag}=${value} if that really is the value.`,
    );
  }
  return value;
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
 * Expands a leading `~` and resolves the path.
 *
 * @param p - A path, possibly relative or home-relative.
 * @param home - The home directory to expand against.
 * @returns The absolute path.
 */
function expandHome(p: string, home: string): string {
  return p.startsWith("~") ? resolve(home, p.slice(1).replace(/^[/\\]/, "")) : resolve(p);
}

/** Where the parser reads the world from, so a test can supply its own. */
export interface ParseEnvironment {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  home?: string;
}

/**
 * Parses the command line.
 *
 * @param argv - Arguments, excluding the node binary and script path.
 * @param environment - The environment, working directory and home directory.
 * @returns The parsed settings.
 * @throws {Error} When a flag is unknown or its value is unusable.
 */
export function parseArgs(argv: string[], environment: ParseEnvironment = {}): Cli {
  const env = environment.env ?? process.env;
  const cwd = environment.cwd ?? process.cwd();
  const home = environment.home ?? homedir();

  const cli: Cli = {
    roots: [],
    deny: [...DEFAULT_DENY],
    dryRun: dryRunFromEnv(env),
    terminalApproval: false,
    blockOnReview: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root-from-cwd") {
      // For hosts that launch the server in the project directory — Claude Code
      // does. Explicit rather than implicit: a server that silently adopts its
      // working directory as writable is a server nobody audited.
      cli.roots.push(cwd);
    } else if (arg === "--terminal-approval") {
      cli.terminalApproval = true;
    } else if (arg === "--review-timeout-ms") {
      cli.reviewTimeoutMs = positiveInt(arg, nextValue(arg, argv, ++i));
    } else if (arg.startsWith("--review-timeout-ms=")) {
      cli.reviewTimeoutMs = positiveInt(
        "--review-timeout-ms",
        inlineValue("--review-timeout-ms", arg),
      );
    } else if (arg === "--block-on-review") {
      cli.blockOnReview = true;
    } else if (arg === "--review-grace-ms") {
      cli.reviewGraceMs = positiveInt(arg, nextValue(arg, argv, ++i));
    } else if (arg.startsWith("--review-grace-ms=")) {
      cli.reviewGraceMs = positiveInt("--review-grace-ms", inlineValue("--review-grace-ms", arg));
    } else if (arg === "--root") {
      cli.roots.push(expandHome(nextValue(arg, argv, ++i), home));
    } else if (arg.startsWith("--root=")) {
      cli.roots.push(expandHome(inlineValue("--root", arg), home));
    } else if (arg === "--deny") {
      cli.deny.push(nextValue(arg, argv, ++i));
    } else if (arg.startsWith("--deny=")) {
      cli.deny.push(inlineValue("--deny", arg));
    } else if (arg === "--allow-everything-in-roots") {
      cli.deny = [];
    } else if (arg === "--dry-run") {
      cli.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      cli.help = true;
    } else if (!arg.startsWith("-")) {
      cli.roots.push(expandHome(arg, home));
    } else {
      throw new Error(`Unknown flag ${arg}`);
    }
  }

  return cli;
}

/** What the server prints for `--help`, and alongside every startup refusal. */
export const HELP = `interactive-editor — a live-edit review panel in front of every file write.

Usage:
  node <path-to-server> --root <dir> [--root <dir> ...] [options]

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

A value that begins with a flag is refused rather than consumed, so a missing
argument stops the server instead of quietly changing what the next flag meant.
Write --flag=value when a value genuinely starts with a dash.

Every write goes through a View the human edits and approves. The agent can open
the editor; only a click can walk through it.
`;
