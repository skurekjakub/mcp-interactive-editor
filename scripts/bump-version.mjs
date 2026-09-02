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
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  MANIFESTS,
  ROOT,
  VERSION_LITERAL,
  VERSION_MODULES,
  read,
  versionDrift,
} from "./versions.mjs";

const next = process.argv[2];

if (!/^\d+\.\d+\.\d+$/.test(next ?? "")) {
  process.stderr.write("Usage: npm run bump -- <major.minor.patch>\n");
  process.exit(2);
}

const current = JSON.parse(read("package.json")).version;

/*
 * Check every declaration before deciding there is nothing to do. Guarding on
 * `package.json` alone means a tree where only that file moved — a hand edit,
 * `npm version`, a merge resolution, a half-finished bump — reports success and
 * leaves the plugin cache key stale for good.
 */
const drift = versionDrift();
if (drift.length > 0) {
  process.stderr.write(
    `The declared versions disagree. Fix these before bumping:\n${drift
      .map((d) => `  ${d}`)
      .join("\n")}\n`,
  );
  process.exit(1);
}

if (current === next) {
  process.stderr.write(`Every declaration is already at ${next}. Nothing to do.\n`);
  process.exit(0);
}

/** Every planned edit, as {rel, content}. Nothing is written until all succeed. */
const planned = [];
const problems = [];

for (const rel of MANIFESTS) {
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

for (const rel of VERSION_MODULES) {
  const before = read(rel);
  if (!VERSION_LITERAL.test(before)) {
    problems.push(`${rel}: could not find the version literal`);
    continue;
  }
  planned.push({ rel, content: before.replace(VERSION_LITERAL, `$1${next}$3`) });
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
    "Next: add the CHANGELOG.md section, then `npm run verify`.\n",
);
