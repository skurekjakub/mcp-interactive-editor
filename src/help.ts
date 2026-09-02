/**
 * @module
 *
 * The usage text, kept apart from the parser that it describes.
 */

/** What the server prints for `--help`, and alongside every startup refusal. */
export const HELP = `interactive-editor — a live-edit review panel in front of every file write.

Usage:
  node <path-to-server> --root <dir> [--root <dir> ...] [options]

Options:
  --root <dir>                 A directory the editor may write inside. Required, repeatable.
  --root-from-cwd              Add the working directory as a root. For hosts that
                               launch the server inside the project (Claude Code).
  --deny <pattern>             Extra name to refuse: a filename, an extension such as
                               .pem, or a directory such as secrets/. Repeatable.
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
  --http                       Serve over Streamable HTTP on 127.0.0.1 instead of stdio.
                               For browser hosts and inspectors, which cannot spawn
                               a process. Stdio stays the default.
  --http-port <n>              Port for --http. Default 3001.
  --allow-origin <origin>      Extra browser origin allowed to call the HTTP endpoint.
                               Repeatable. The reference host and inspector ports
                               are allowed already.
  -h, --help                   This.

A value that begins with a flag is refused rather than consumed, so a missing
argument stops the server instead of quietly changing what the next flag meant.
Write --flag=value when a value genuinely starts with a dash.

Every write goes through a View the human edits and approves. The agent can open
the editor; only a click can walk through it.
`;
