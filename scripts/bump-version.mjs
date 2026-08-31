#!/usr/bin/env node
/**
 * Bump the declared version everywhere it is load-bearing.
 *
 * The version is not decoration here. Claude Code materialises an installed
 * plugin into
 *
 *   ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/
 *
 * and only rebuilds that directory when the declared version changes.
 * Refreshing the marketplace clone is not enough. Ship a change without a bump
 * and every existing install keeps running the tree it first installed, no
 * matter what `main` says — which is a bug that looks exactly like "the restart
 * did not work".
 *
 * Every edit is computed and checked before anything is written. A partial bump
 * is worse than no bump: the guard below reads `package.json`, so a run that
 * failed halfway would report "already at that version" on the retry and leave
 * the rest stale for good.
 *
 * Usage: npm run bump -- 0.3.0
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const next = process.argv[2];

if (!/^\d+\.\d+\.\d+$/.test(next ?? "")) {
  process.stderr.write("Usage: npm run bump -- <major.minor.patch>\n");
  process.exit(2);
}

const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const current = JSON.parse(read("package.json")).version;

if (current === next) {
  process.stderr.write(`package.json is already at ${next}. Nothing to do.\n`);
  process.exit(0);
}

/** Every planned edit, as {rel, content}. Nothing is written until all succeed. */
const planned = [];
const problems = [];

/** The manifests. `.claude-plugin/plugin.json` is the one that is the cache key. */
for (const rel of ["package.json", "package-lock.json", ".claude-plugin/plugin.json"]) {
  const doc = JSON.parse(read(rel));
  if (doc.version !== current) {
    problems.push(`${rel}: expected ${current}, found ${doc.version}`);
    continue;
  }
  doc.version = next;
  // The lockfile repeats it for the root package entry.
  if (doc.packages?.[""]) doc.packages[""].version = next;
  planned.push({ rel, content: `${JSON.stringify(doc, null, 2)}\n` });
}

const marketplace = JSON.parse(read(".claude-plugin/marketplace.json"));
for (const plugin of marketplace.plugins) {
  if (plugin.version !== current) {
    problems.push(
      `marketplace plugin ${plugin.name}: expected ${current}, found ${plugin.version}`,
    );
  }
  plugin.version = next;
}
planned.push({
  rel: ".claude-plugin/marketplace.json",
  content: `${JSON.stringify(marketplace, null, 2)}\n`,
});

/** The two places the running code names itself over the wire. */
for (const rel of ["src/server.ts", "ui/src/hooks/useProposalSession.ts"]) {
  const before = read(rel);
  const pattern = /(name: "interactive-editor", version: ")\d+\.\d+\.\d+(")/;
  if (!pattern.test(before)) {
    problems.push(`${rel}: could not find the version literal`);
    continue;
  }
  planned.push({ rel, content: before.replace(pattern, `$1${next}$2`) });
}

if (problems.length > 0) {
  process.stderr.write(
    `Refusing to bump — nothing has been written:\n${problems.map((p) => `  ${p}`).join("\n")}\n`,
  );
  process.exit(1);
}

for (const { rel, content } of planned) writeFileSync(join(ROOT, rel), content, "utf8");

/*
 * Re-serialising JSON does not always agree with how prettier would print it,
 * and `npm run verify` runs `format:check`, so an unformatted tree makes a
 * correct bump look like a failure.
 *
 * Prettier's own entry point is run under this node, rather than through `npx`:
 * `shell: true` concatenates argv instead of escaping it and is deprecated for
 * that reason, and spawning `npx.cmd` without a shell fails outright on Windows
 * with EINVAL. Resolving the module sidesteps both.
 */
execFileSync(
  process.execPath,
  [
    createRequire(import.meta.url).resolve("prettier/bin/prettier.cjs"),
    "--write",
    ...planned.map((p) => p.rel),
  ],
  { cwd: ROOT, stdio: "ignore" },
);

process.stdout.write(
  `${current} -> ${next}\n${planned.map((p) => `  ${p.rel}`).join("\n")}\n\n` +
    "server.json is not touched here. It describes a published .mcpb with a\n" +
    "checksum, so it moves only when you actually cut the release — update its\n" +
    "version, identifier URL and fileSha256 from the artifact you upload.\n\n" +
    "Next: add the CHANGELOG.md section, then `npm run verify`.\n",
);
