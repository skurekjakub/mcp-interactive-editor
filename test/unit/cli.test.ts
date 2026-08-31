import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseArgs } from "../../src/cli.js";
import { DEFAULT_DENY } from "../../src/fsGuard.js";

/** A parse with the world pinned, so no case depends on where it was run. */
function parse(argv: string[], env: NodeJS.ProcessEnv = {}) {
  return parseArgs(argv, { env, cwd: resolve("/work"), home: resolve("/home/me") });
}

describe("a flag that takes a value", () => {
  it("refuses the next flag instead of consuming it as the value", () => {
    // Arrange: the operator meant to deny nothing and simulate the run.
    const argv = ["--root", resolve("/work"), "--deny", "--dry-run"];

    // Act & Assert: taking `--dry-run` as the pattern would leave a server that
    // writes to disk when it was asked not to.
    expect(() => parse(argv)).toThrow(/--deny needs a value, but --dry-run followed it/);
  });

  it("refuses a directory that is really the next flag", () => {
    expect(() => parse(["--root", "--dry-run"])).toThrow(/--root needs a value/);
  });

  it("refuses a flag with nothing after it at all", () => {
    expect(() => parse(["--root", resolve("/work"), "--deny"])).toThrow(
      /--deny needs a value, and nothing followed it/,
    );
  });

  it("accepts a dashed value through the inline form", () => {
    // Arrange & Act: the escape hatch the refusal points at.
    const cli = parse(["--root", resolve("/work"), "--deny=--odd-name"]);

    // Assert.
    expect(cli.deny).toContain("--odd-name");
  });

  it("still reports a negative duration as a duration problem", () => {
    // A leading dash on a number is not a misplaced flag, so the message should
    // name the real fault rather than suggesting the inline form.
    expect(() => parse(["--review-timeout-ms", "-5"])).toThrow(/positive number of milliseconds/);
  });
});

describe("roots", () => {
  it("resolves a bare positional argument", () => {
    const cli = parse(["some/dir"]);

    expect(cli.roots).toEqual([resolve("some/dir")]);
  });

  it("expands a leading tilde against the given home", () => {
    const cli = parse(["--root", "~/projects"]);

    expect(cli.roots).toEqual([resolve("/home/me", "projects")]);
  });

  it("adds the given working directory for --root-from-cwd", () => {
    const cli = parse(["--root-from-cwd"]);

    expect(cli.roots).toEqual([resolve("/work")]);
  });

  it("refuses an empty inline root rather than adopting the working directory", () => {
    expect(() => parse(["--root="])).toThrow(/--root needs a value/);
  });
});

describe("the deny list", () => {
  it("starts from the built-in patterns and appends to them", () => {
    const cli = parse(["--root", resolve("/work"), "--deny", "secrets"]);

    expect(cli.deny).toEqual([...DEFAULT_DENY, "secrets"]);
  });

  it("is emptied by --allow-everything-in-roots", () => {
    const cli = parse(["--root", resolve("/work"), "--allow-everything-in-roots"]);

    expect(cli.deny).toEqual([]);
  });
});

describe("dry run", () => {
  it("is off when nothing asks for it", () => {
    expect(parse(["--root", resolve("/work")]).dryRun).toBe(false);
  });

  it("is on when the flag is given", () => {
    expect(parse(["--root", resolve("/work"), "--dry-run"]).dryRun).toBe(true);
  });

  it("is on when the environment asks, for bundles that cannot add a flag", () => {
    const cli = parse(["--root", resolve("/work")], { INTERACTIVE_EDITOR_DRY_RUN: "TRUE" });

    expect(cli.dryRun).toBe(true);
  });

  it("ignores an environment value that is not an affirmative", () => {
    const cli = parse(["--root", resolve("/work")], { INTERACTIVE_EDITOR_DRY_RUN: "maybe" });

    expect(cli.dryRun).toBe(false);
  });
});

describe("the rest of the surface", () => {
  it("reads the timing flags in both spellings", () => {
    const cli = parse(["--review-timeout-ms", "1000", "--review-grace-ms=250"]);

    expect(cli).toMatchObject({ reviewTimeoutMs: 1000, reviewGraceMs: 250 });
  });

  it("refuses a timing value that is not a number", () => {
    expect(() => parse(["--review-timeout-ms=soon"])).toThrow(/positive number of milliseconds/);
  });

  it("leaves the weakening flags off unless asked", () => {
    const cli = parse(["--root", resolve("/work")]);

    expect(cli).toMatchObject({ terminalApproval: false, blockOnReview: false });
  });

  it("reports help rather than exiting, so the caller decides", () => {
    expect(parse(["--help"]).help).toBe(true);
  });

  it("refuses an unknown flag", () => {
    expect(() => parse(["--wat"])).toThrow(/Unknown flag --wat/);
  });
});
