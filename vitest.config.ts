import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Three kinds of test, one runner.
 *
 * `test/unit` covers the modules in `shared/` and `src/` directly — fast, no
 * subprocess. `test/e2e` starts the real compiled server over stdio and drives
 * it with an MCP client, which is the only way to prove the parts that matter:
 * that a proposal does not touch disk, and that a commit without a rendered
 * editor is refused.
 *
 * `test/panel` renders the React panel in jsdom. It exists because everything in
 * `ui/src/components` and `ui/src/hooks` was unreachable from the other two, and
 * three separate regressions shipped through that gap while 187 tests stayed
 * green: a highlight that could not be commented on, a loading screen that
 * swallowed its own error, and a view that removed the editor entirely.
 *
 * The e2e tests need `dist/`, so `npm test` builds first via `pretest`.
 */
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["shared/**/*.ts", "src/**/*.ts", "ui/src/**/*.ts", "ui/src/**/*.tsx"],
      reporter: ["text", "lcov"],
    },
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: ["test/**/*.test.ts"],
          testTimeout: 20_000,
          hookTimeout: 20_000,
        },
      },
      {
        plugins: [react()],
        test: {
          name: "panel",
          environment: "jsdom",
          include: ["test/panel/**/*.test.tsx"],
        },
      },
    ],
  },
});
