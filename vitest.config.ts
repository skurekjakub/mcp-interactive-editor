import { defineConfig } from "vitest/config";

/**
 * Two kinds of test, one runner.
 *
 * `test/unit` covers the modules in `shared/` and `src/` directly — fast, no
 * subprocess. `test/e2e` starts the real compiled server over stdio and drives
 * it with an MCP client, which is the only way to prove the parts that matter:
 * that a proposal does not touch disk, and that a commit without a rendered
 * editor is refused.
 *
 * The e2e tests need `dist/`, so `npm test` builds first via `pretest`.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      provider: "v8",
      include: ["shared/**/*.ts", "src/**/*.ts"],
      reporter: ["text", "lcov"],
    },
  },
});
