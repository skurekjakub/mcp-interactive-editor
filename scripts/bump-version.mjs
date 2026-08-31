#!/usr/bin/env node
/**
 * Bump the declared version everywhere it is load-bearing.
 *
 * The version is not decoration here. Claude Code materialises an installed
 * plugin into
 *
 *   ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/
 *
 * and only rebuilds that directory when the *declared* version changes.
 * Refreshing the marketplace clone is not enough. Ship a change without a bump
 * and every existing install keeps running the tree it first installed, no
 * matter what `main` says — which is a bug that looks exactly like "the restart
 * did not work".
 *
 * Usage: npm run bump -- 0.3.0
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const next = process.argv[2];

if (!/^\d+\.\d+\.\d+$/.test(next ?? "")) {
  process.stderr.write("Usage: npm run bump -- <major.minor.patch>\n");
  process.exit(2);
}

const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
const writeJson = (rel, doc) =>
  writeFileSync(join(ROOT, rel), `${JSON.stringify(doc, null, 2)}\n`, "utf8");

const current = readJson("package.json").version;
if (current === next) {
  process.stderr.write(`Already at ${next}. Nothing to do.\n`);
  process.exit(0);
}

const touched = [];

/** The manifests. `.claude-plugin/plugin.json` is the one that is the cache key. */
for (const rel of ["package.json", "package-lock.json", ".claude-plugin/plugin.json"]) {
  const doc = readJson(rel);
  doc.version = next;
  // The lockfile repeats it for the root package entry.
  if (doc.packages?.[""]) doc.packages[""].version = next;
  writeJson(rel, doc);
  touched.push(rel);
}

const marketplace = readJson(".claude-plugin/marketplace.json");
for (const plugin of marketplace.plugins) plugin.version = next;
writeJson(".claude-plugin/marketplace.json", marketplace);
touched.push(".claude-plugin/marketplace.json");

/** The two places the running code names itself over the wire. */
for (const rel of ["src/server.ts", "ui/src/hooks/useProposalSession.ts"]) {
  const path = join(ROOT, rel);
  const before = readFileSync(path, "utf8");
  const after = before.replace(
    /(name: "interactive-editor", version: ")\d+\.\d+\.\d+(")/,
    `$1${next}$2`,
  );
  if (after === before) {
    process.stderr.write(`Could not find the version literal in ${rel}. Aborting.\n`);
    process.exit(1);
  }
  writeFileSync(path, after, "utf8");
  touched.push(rel);
}

process.stdout.write(`${current} -> ${next}\n${touched.map((t) => `  ${t}`).join("\n")}\n\n`);
process.stdout.write(
  "Deliberately untouched: server.json. It describes a published .mcpb with a\n" +
    "checksum, so it should lag until that release actually exists.\n\n" +
    "Next: add the section to CHANGELOG.md, then `npm run verify && npm run bundle`.\n",
);
