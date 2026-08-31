#!/usr/bin/env node
/**
 * @module
 *
 * Every place the version is declared, and whether they agree.
 *
 * The version is not decoration. Claude Code materialises an installed plugin
 * into `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/` and rebuilds
 * that directory only when the declared version changes, so a stale
 * `.claude-plugin/plugin.json` means every existing install keeps running the
 * tree it first installed no matter what `main` says. The symptom is
 * indistinguishable from "the restart did not work".
 *
 * Shared by the bump script and by the test that fails the build on drift.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root, resolved from this file. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Reads a repository file as text.
 *
 * @param rel - Path relative to the repository root.
 * @returns The file contents.
 */
export function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

/**
 * The JSON manifests carrying a version. `.claude-plugin/plugin.json` is the
 * cache key, so a declaration missing from this list goes stale silently.
 */
export const MANIFESTS = ["package.json", "package-lock.json", ".claude-plugin/plugin.json"];

/** The two halves' own version modules. */
export const VERSION_MODULES = ["src/version.ts", "ui/src/lib/version.ts"];

/** The literal a version module declares, with the number as its middle group. */
export const VERSION_LITERAL = /(_VERSION = ")(\d+\.\d+\.\d+)(")/;

/**
 * Collects every declared version.
 *
 * @returns One entry per declaration, as `{where, version}`.
 */
export function declaredVersions() {
  const found = [];

  for (const rel of MANIFESTS) {
    found.push({ where: rel, version: JSON.parse(read(rel)).version });
  }

  const lock = JSON.parse(read("package-lock.json"));
  if (lock.packages?.[""]) {
    found.push({ where: 'package-lock.json packages[""]', version: lock.packages[""].version });
  }

  for (const plugin of JSON.parse(read(".claude-plugin/marketplace.json")).plugins) {
    found.push({ where: `marketplace plugin ${plugin.name}`, version: plugin.version });
  }

  for (const rel of VERSION_MODULES) {
    found.push({ where: rel, version: read(rel).match(VERSION_LITERAL)?.[2] });
  }

  return found;
}

/**
 * Reports which declarations disagree with the rest.
 *
 * @returns A list of human-readable disagreements, empty when all agree.
 */
export function versionDrift() {
  const declared = declaredVersions();
  const expected = declared[0]?.version;
  return declared
    .filter((entry) => entry.version !== expected)
    .map(
      (entry) => `${entry.where}: ${entry.version ?? "not found"} (package.json says ${expected})`,
    );
}
