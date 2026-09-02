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
import { DEFAULT_DENY } from "./fs/deny.js";

/** Everything the command line can decide. */
export interface Cli {
  roots: string[];
  deny: string[];
  dryRun: boolean;
  terminalApproval: boolean;
  reviewTimeoutMs?: number;
  reviewGraceMs?: number;
  blockOnReview: boolean;
  /** Serve over Streamable HTTP instead of stdio. */
  http: boolean;
  /** Port for the HTTP transport. */
  httpPort: number;
  /** Browser origins allowed to reach the HTTP transport. */
  allowedOrigins: string[];
  /** True when help was asked for, which the caller prints and exits on. */
  help?: boolean;
}

/** Where the reference host and the common inspectors serve their pages from. */
const DEFAULT_ORIGINS = [
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://localhost:6274",
  "http://127.0.0.1:6274",
];

/** Port the HTTP transport uses when none is given. */
const DEFAULT_HTTP_PORT = 3001;

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
 * Reads a positive whole-number flag value.
 *
 * An unvalidated `Number()` turns a typo into `NaN`, and every comparison
 * against `NaN` is false — so a mistyped timing flag disables the wait it was
 * meant to configure and reports the timeout as "within NaN minutes". A
 * fraction is refused for the same reason: a port of 3001.5 is not a port.
 *
 * @param flag - The flag name, for the error message.
 * @param raw - The argument that followed it, if any.
 * @param what - What the number is, for the error message.
 * @returns The parsed number.
 * @throws {Error} When the value is missing, not a whole number, or not positive.
 */
function positiveInteger(flag: string, raw: string | undefined, what: string): number {
  const value = Number(raw);
  if (raw === undefined || raw === "" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${flag} needs ${what}, got ${raw ?? "nothing"}`);
  }
  return value;
}

/** How a timing flag's value is described when it is refused. */
const MILLISECONDS = "a positive whole number of milliseconds";

/** How the port flag's value is described when it is refused. */
const PORT = "a port number";

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
 * Only a bare `~` or `~/` is the home directory. `~alice/x` names another
 * account's home in a shell, which is not something to guess at: it is left as
 * written and resolved as an ordinary relative path.
 *
 * @param p - A path, possibly relative or home-relative.
 * @param home - The home directory to expand against.
 * @param cwd - The directory a relative path is resolved against.
 * @returns The absolute path.
 */
function expandHome(p: string, home: string, cwd: string): string {
  if (p === "~") return resolve(home);
  if (p.startsWith("~/") || p.startsWith("~\\")) return resolve(home, p.slice(2));
  return resolve(cwd, p);
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
    http: false,
    httpPort: DEFAULT_HTTP_PORT,
    allowedOrigins: [...DEFAULT_ORIGINS],
  };

  const root = (p: string) => expandHome(p, home, cwd);

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
      cli.reviewTimeoutMs = positiveInteger(arg, nextValue(arg, argv, ++i), MILLISECONDS);
    } else if (arg.startsWith("--review-timeout-ms=")) {
      cli.reviewTimeoutMs = positiveInteger(
        "--review-timeout-ms",
        inlineValue("--review-timeout-ms", arg),
        MILLISECONDS,
      );
    } else if (arg === "--block-on-review") {
      cli.blockOnReview = true;
    } else if (arg === "--review-grace-ms") {
      cli.reviewGraceMs = positiveInteger(arg, nextValue(arg, argv, ++i), MILLISECONDS);
    } else if (arg.startsWith("--review-grace-ms=")) {
      cli.reviewGraceMs = positiveInteger(
        "--review-grace-ms",
        inlineValue("--review-grace-ms", arg),
        MILLISECONDS,
      );
    } else if (arg === "--root") {
      cli.roots.push(root(nextValue(arg, argv, ++i)));
    } else if (arg.startsWith("--root=")) {
      cli.roots.push(root(inlineValue("--root", arg)));
    } else if (arg === "--deny") {
      cli.deny.push(nextValue(arg, argv, ++i));
    } else if (arg.startsWith("--deny=")) {
      cli.deny.push(inlineValue("--deny", arg));
    } else if (arg === "--allow-everything-in-roots") {
      cli.deny = [];
    } else if (arg === "--http") {
      cli.http = true;
    } else if (arg === "--http-port") {
      cli.http = true;
      cli.httpPort = positiveInteger(arg, nextValue(arg, argv, ++i), PORT);
    } else if (arg.startsWith("--http-port=")) {
      cli.http = true;
      cli.httpPort = positiveInteger("--http-port", inlineValue("--http-port", arg), PORT);
    } else if (arg === "--allow-origin") {
      cli.allowedOrigins.push(nextValue(arg, argv, ++i));
    } else if (arg.startsWith("--allow-origin=")) {
      cli.allowedOrigins.push(inlineValue("--allow-origin", arg));
    } else if (arg === "--dry-run") {
      cli.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      cli.help = true;
    } else if (!arg.startsWith("-")) {
      cli.roots.push(root(arg));
    } else {
      throw new Error(`Unknown flag ${arg}`);
    }
  }

  return cli;
}
