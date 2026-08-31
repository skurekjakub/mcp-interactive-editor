import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Two projects, one runner.
 *
 * `test/unit` covers the modules in `shared/`, `src/` and `scripts/` directly —
 * fast, no subprocess. `test/e2e` starts the real compiled server over stdio and
 * drives it with an MCP client, which is the only way to prove the parts that
 * matter: that a proposal does not touch disk, and that a commit without a
 * rendered editor is refused.
 *
 * `test/panel` renders the React panel in jsdom, because everything in
 * `ui/src/components` and `ui/src/hooks` is unreachable from the other two and
 * that gap is where shipped regressions come from.
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
          // Panel tests need jsdom and the React plugin. A hook test written as
          // `.ts` rather than `.tsx` matches the pattern above and would be run
          // here, in an environment with no DOM.
          exclude: ["test/panel/**"],
          testTimeout: 20_000,
          hookTimeout: 20_000,
        },
      },
      {
        plugins: [react()],
        test: {
          name: "panel",
          environment: "jsdom",
          include: ["test/panel/**/*.test.{ts,tsx}"],
        },
      },
    ],
  },
});
