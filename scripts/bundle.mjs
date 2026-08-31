#!/usr/bin/env node
/**
 * Produce `bundle/`, the self-contained artifact that both distribution paths
 * use: the `.mcpb` archive for one-click install in Claude Desktop, and the
 * Claude Code plugin, which gets a git clone with no build step available.
 *
 * Layout matters. The server resolves the View at `../ui/index.html` relative
 * to its own file, so:
 *
 *   bundle/
 *     manifest.json     <- MCPB metadata, read by Claude Desktop
 *     server/index.js   <- every dependency inlined by esbuild
 *     ui/index.html     <- the editor, already a single inlined file
 */
import { build } from "esbuild";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "bundle");

const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));

await rm(out, { recursive: true, force: true });
await mkdir(resolve(out, "server"), { recursive: true });
await mkdir(resolve(out, "ui"), { recursive: true });

await build({
  entryPoints: [resolve(root, "src/server.ts")],
  outfile: resolve(out, "server/index.js"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  minify: false, // A server that writes to your disk should stay readable.
  sourcemap: false,
  banner: {
    // esbuild's ESM output can reference these; Node does not define them for ESM.
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      "const require = __createRequire(import.meta.url);",
    ].join("\n"),
  },
});

await copyFile(resolve(root, "dist/ui/index.html"), resolve(out, "ui/index.html")).catch(() => {
  throw new Error("dist/ui/index.html is missing. Run `npm run build` first.");
});

const manifest = {
  manifest_version: "0.3",
  name: pkg.name,
  display_name: "Interactive Editor",
  version: pkg.version,
  description: pkg.description,
  long_description:
    "Claude proposes a file write. A panel opens with the proposed content in an editor and a " +
    "live diff against what is on disk. You edit it by hand and press the button; nothing " +
    "reaches the filesystem until you do. Claude cannot approve its own write — the commit tool " +
    "is not in its tool list.",
  author: { name: pkg.author },
  homepage: pkg.homepage,
  documentation: pkg.homepage,
  support: pkg.bugs?.url,
  license: pkg.license,
  keywords: pkg.keywords,
  server: {
    type: "node",
    entry_point: "server/index.js",
    mcp_config: {
      command: "node",
      args: ["${__dirname}/server/index.js", "${user_config.roots}"],
      env: {
        INTERACTIVE_EDITOR_DRY_RUN: "${user_config.dry_run}",
      },
    },
  },
  user_config: {
    roots: {
      type: "directory",
      title: "Writable folders",
      description:
        "Folders the editor may write inside. Anything outside these is refused, symlinks included.",
      multiple: true,
      required: true,
    },
    dry_run: {
      type: "boolean",
      title: "Dry run",
      description:
        "Run the whole flow but never touch disk. Good for a first pass on a real project.",
      required: false,
      default: false,
    },
  },
  compatibility: {
    platforms: ["darwin", "win32", "linux"],
    runtimes: { node: ">=20.10.0" },
  },
};

await writeFile(resolve(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

process.stdout.write(`bundle/ built for ${pkg.name} v${pkg.version}\n`);
