#!/usr/bin/env node
/**
 * @module
 *
 * Checks the working tree against `docs/comment-policy.md`.
 *
 * The policy keeps comments as contracts rather than narration, and a policy
 * nothing checks drifts back to narration within a release. Declarations are
 * found by walking the TypeScript AST rather than by grepping, so "every
 * top-level declaration carries a docblock" means what it says.
 */
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const SOURCES = ["src/**/*.ts", "shared/**/*.ts", "ui/src/**/*.ts", "ui/src/**/*.tsx"];
const TESTS = ["test/**/*.ts", "test/**/*.tsx"];

/**
 * Phrases that turn a contract into a story.
 *
 * Matched against comment text only, so a string literal or an identifier that
 * happens to contain one of these is left alone.
 */
const BANNED = [
  /*
   * Anchored to a subject, so the narrative "it used to throw" is caught while
   * the passive "a guard used to resolve the path" is left alone.
   */
  {
    re: /\b(it|this|that|these|those|they|there|which|we)\s+used to\b/i,
    why: "recounts previous behaviour; that belongs in git history",
  },
  { re: /\bused to be\b/i, why: "recounts previous behaviour; that belongs in git history" },
  { re: /\bno longer\b/i, why: "recounts previous behaviour; that belongs in git history" },
  { re: /\bfor now\b/i, why: "states a schedule, not a contract" },
  {
    re: /\bthis (function|method|component|module|file|hook|class)\b/i,
    why: "narrates the symbol instead of stating its contract",
  },
  { re: /(^|[^\w'])we([^\w']|$)/i, why: "write for an unknown caller, not for the authors" },
  {
    // A standard's section number is the kind of locator the policy asks for,
    // so "WCAG 2.1.2" and "RFC 9110 § 12.5" are citations rather than versions.
    re: /(?<![A-Z]{2,}\s)(?<!§\s)\bv?\d+\.\d+\.\d+\b/,
    why: "attaches a version number to behaviour; that belongs in the changelog",
  },
  { re: /^[\s*/]*[-=_]{4,}[\s*/]*$/, why: "is a section banner" },
];

/** Collected violations, reported together so one run shows the whole picture. */
const problems = [];

/**
 * Records one policy violation against a file and line.
 *
 * @param file - Repository-relative path of the offending file.
 * @param line - One-indexed line number the violation anchors to.
 * @param message - What is wrong, phrased as the rule that was broken.
 */
function report(file, line, message) {
  problems.push(`${file}:${line}  ${message}`);
}

/**
 * Resolves glob patterns to repository-relative paths with `/` separators.
 *
 * @param patterns - Glob patterns rooted at the repository.
 * @returns Sorted matching paths.
 */
function filesFor(patterns) {
  return patterns
    .flatMap((pattern) => globSync(pattern, { cwd: ROOT }))
    .map((path) => path.split("\\").join("/"))
    .sort();
}

/**
 * Extracts the docblock immediately preceding a node.
 *
 * @param node - The declaration to look above.
 * @param text - Full source text of the containing file.
 * @returns The raw comment text and its offset, or null when absent.
 */
function docblockOf(node, text) {
  const ranges = ts.getLeadingCommentRanges(text, node.getFullStart()) ?? [];
  const last = ranges[ranges.length - 1];
  if (!last) return null;
  const raw = text.slice(last.pos, last.end);
  return raw.startsWith("/**") ? { raw, pos: last.pos } : null;
}

/**
 * Splits a docblock into interior lines stripped of the comment furniture.
 *
 * @param raw - The complete docblock text.
 * @returns One entry per interior line.
 */
function contentLines(raw) {
  // A one-line `/** Text */` is the normal form for a short contract and carries
  // its summary on the same line as the delimiters.
  if (!raw.includes("\n"))
    return [
      raw
        .replace(/^\/\*\*/, "")
        .replace(/\*\/$/, "")
        .trim(),
    ];
  return raw
    .split("\n")
    .slice(1, -1)
    .map((line) =>
      line
        .replace(/^\s*\*/, "")
        .replace(/^ /, "")
        .trimEnd(),
    );
}

/**
 * Reports every structural rule a docblock breaks.
 *
 * @param file - Repository-relative path, for the message.
 * @param line - One-indexed line the docblock starts on.
 * @param raw - The complete docblock text.
 * @param wantsVerb - Whether the summary must open with a third-person verb.
 */
function checkDocblock(file, line, raw, wantsVerb) {
  const lines = contentLines(raw);
  const moduleBlock = lines[0]?.trim() === "@module";
  const body = moduleBlock ? lines.slice(2) : lines;
  const summary = body[0] ?? "";

  if (summary.trim() === "") {
    report(file, line, "docblock has no summary sentence on the line after /**");
    return;
  }
  if (!summary.trimEnd().endsWith(".")) {
    report(file, line, "summary sentence must end with a period");
  }
  if (wantsVerb && !moduleBlock) {
    const first = summary.trim().split(/\s+/)[0] ?? "";
    if (!/^[A-Z][a-z]+(s|es)$/.test(first)) {
      report(
        file,
        line,
        `summary must open with a third-person indicative verb (Renders, Resolves, Returns); found "${first}"`,
      );
    }
  }

  const rest = body.slice(1);
  if (rest.length > 0 && rest[0].trim() !== "") {
    report(file, line, "a blank ' *' line must separate the summary sentence from the prose");
  }

  let seenTag = false;
  for (const entry of rest) {
    const trimmed = entry.trim();
    if (trimmed.startsWith("@")) {
      seenTag = true;
      if (trimmed.startsWith("@param")) {
        if (/@param\s+\{/.test(trimmed)) {
          report(file, line, "@param must omit the type; TypeScript already carries it");
        } else if (!/^@param\s+[\w.$[\]]+\s+-\s+\S/.test(trimmed)) {
          report(file, line, "@param must read '@param name - Description.'");
        }
      }
      if (trimmed.startsWith("@throws") && !/^@throws\s+\{[^}]+\}\s+When\s+\S/.test(trimmed)) {
        report(file, line, "@throws must read '@throws {Type} When condition.'");
      }
      continue;
    }
    const isContinuation = entry.startsWith("  ") || trimmed === "";
    if (seenTag && !isContinuation) {
      report(file, line, "prose must not follow the tag section; tags go last");
      break;
    }
  }
}

/**
 * Reports banned narrative phrasing inside every comment in a file.
 *
 * @param file - Repository-relative path, for the message.
 * @param text - Full source text.
 */
function checkNarrative(file, text) {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    text,
  );
  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    const isComment =
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia;
    if (isComment) {
      const start = scanner.getTokenStart();
      const comment = text.slice(start, scanner.getTokenEnd());
      const first = lineOf(text, start);
      comment.split("\n").forEach((entry, offset) => {
        for (const { re, why } of BANNED) {
          if (re.test(entry)) report(file, first + offset, `comment ${why}`);
        }
      });
    }
    token = scanner.scan();
  }
}

/**
 * Reports Arrange/Act/Assert markers that omit their terminating punctuation.
 *
 * @param file - Repository-relative path, for the message.
 * @param text - Full source text.
 */
function checkTestMarkers(file, text) {
  // One step may cover two phases — a `toThrow` is the act and the assertion at
  // once — so the marker names each phase it covers before its punctuation.
  const marker = /^\s*\/\/\s*((?:Arrange|Act|Assert)(?:\s*&\s*(?:Arrange|Act|Assert))*)(.?)/;

  text.split("\n").forEach((entry, index) => {
    const found = entry.match(marker);
    if (found && found[2] !== "." && found[2] !== ":") {
      report(file, index + 1, `'// ${found[1]}' marker must end with '.' or continue with ':'`);
    }
  });
}

/**
 * Converts a character offset to a one-indexed line number.
 *
 * @param text - Full source text.
 * @param offset - Character offset into that text.
 * @returns The line the offset falls on.
 */
function lineOf(text, offset) {
  return text.slice(0, offset).split("\n").length;
}

/**
 * Determines whether a statement declares something requiring a docblock.
 *
 * @param node - A top-level statement.
 * @returns The declaration kind, or null when no docblock is required.
 */
function declarationKind(node) {
  if (ts.isFunctionDeclaration(node)) return "function";
  if (ts.isInterfaceDeclaration(node)) return "type";
  if (ts.isTypeAliasDeclaration(node)) return "type";
  if (ts.isEnumDeclaration(node)) return "type";
  if (ts.isClassDeclaration(node)) return "type";
  if (ts.isVariableStatement(node)) {
    const declared = node.declarationList.declarations[0];
    const initialiser = declared?.initializer;
    if (!initialiser) return null;
    if (ts.isArrowFunction(initialiser) || ts.isFunctionExpression(initialiser)) return "function";
    // An exported constant is part of the module surface even when it holds no
    // behaviour, so a caller still has to be told what it means.
    const exported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    return exported ? "value" : null;
  }
  return null;
}

/**
 * Names a declaration for a diagnostic message.
 *
 * @param node - The undocumented declaration.
 * @returns Its identifier, or a generic label when anonymous.
 */
function nameOf(node) {
  if (ts.isVariableStatement(node)) {
    return node.declarationList.declarations[0]?.name.getText() ?? "declaration";
  }
  return node.name?.getText() ?? "declaration";
}

/**
 * Chooses the parser variant so `.tsx` files parse their JSX.
 *
 * @param file - Repository-relative path.
 * @returns The script kind TypeScript should parse the file as.
 */
function scriptKind(file) {
  return file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

for (const file of filesFor(SOURCES)) {
  const text = readFileSync(join(ROOT, file), "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));

  for (const node of source.statements) {
    const kind = declarationKind(node);
    if (!kind) continue;
    const block = docblockOf(node, text);
    if (!block) {
      report(file, lineOf(text, node.getStart(source)), `${nameOf(node)} has no docblock`);
      continue;
    }
    checkDocblock(file, lineOf(text, block.pos), block.raw, kind === "function");
  }

  checkNarrative(file, text);
}

for (const file of filesFor(TESTS)) {
  const text = readFileSync(join(ROOT, file), "utf8");
  checkNarrative(file, text);
  checkTestMarkers(file, text);
}

if (problems.length > 0) {
  console.error("Comment policy violations (docs/comment-policy.md):\n");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(`\n${problems.length} violation(s).`);
  process.exit(1);
}

console.log("Comment policy: clean.");
