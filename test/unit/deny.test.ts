import { describe, expect, it } from "vitest";
import { DEFAULT_DENY, matchDeny } from "../../src/fs/deny.js";

describe("the built-in deny list", () => {
  it.each([
    [".env", ".env"],
    ["sub/.env", ".env"],
    [".env.local", ".env"],
    [".git/config", ".git/"],
    ["node_modules/pkg/index.js", "node_modules/"],
    [".ssh/known_hosts", ".ssh/"],
    ["deploy.pem", ".pem"],
    ["server.key", ".key"],
    ["id_rsa", "id_rsa"],
    ["id_rsa.pub", "id_rsa"],
    ["config/credentials.json", "credentials"],
    [".aws/config", ".aws/"],
    [".npmrc", ".npmrc"],
  ])("refuses %s, naming %s", (path, pattern) => {
    expect(matchDeny(DEFAULT_DENY, path)).toBe(pattern);
  });

  it.each([
    "shortcuts.keymap.ts",
    "notes.environment.md",
    "notes.pemberton.md",
    "src/environment.ts",
    "my.git/readme.md",
    "credentials-policy.md",
  ])("lets %s through", (path) => {
    expect(matchDeny(DEFAULT_DENY, path)).toBeNull();
  });
});

describe("matching", () => {
  it("ignores case, and reports the pattern as it was configured", () => {
    // Arrange & Act: secrets are spelled however the tool that wrote them chose.
    expect(matchDeny(DEFAULT_DENY, "Sub/.ENV")).toBe(".env");

    // Assert: the human is told the pattern in the operator's own spelling.
    expect(matchDeny([".PEM"], "deploy.pem")).toBe(".PEM");
  });

  it("matches a directory pattern only as a whole segment", () => {
    expect(matchDeny([".git/"], "not.git/file.txt")).toBeNull();
    expect(matchDeny([".git/"], "a/.git/file.txt")).toBe(".git/");
  });

  it("ignores an empty pattern rather than refusing every path", () => {
    expect(matchDeny([""], "a.txt")).toBeNull();
  });

  it("reports the first pattern that matches, in the configured order", () => {
    expect(matchDeny(["credentials", ".json"], "credentials.json")).toBe("credentials");
    expect(matchDeny([".json", "credentials"], "credentials.json")).toBe(".json");
  });
});
