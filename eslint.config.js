import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

/*
 * Rules applied to both type-aware blocks below. They cannot share an `extends`
 * because the server and the panel answer to different tsconfigs, and the panel
 * is the only half that has a DOM.
 */
const typeAware = {
  "@typescript-eslint/switch-exhaustiveness-check": "error",
  "@typescript-eslint/consistent-type-imports": "error",
  // `${undefined}` and `${null}` reach the reader as the words. Numbers stay
  // allowed: line counts and byte counts are formatted everywhere.
  "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
  // The SDK types a tool handler as returning a promise, so an `async` handler
  // with nothing to await is the signature rather than an oversight.
  "@typescript-eslint/require-await": "off",
  // `_context` is the convention `noUnusedParameters` already honours.
  "@typescript-eslint/no-unused-vars": [
    "error",
    { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
  ],
  "no-shadow": "off",
  "@typescript-eslint/no-shadow": "error",
  eqeqeq: ["error", "always", { null: "ignore" }],
};

export default tseslint.config(
  {
    ignores: ["dist/**", "bundle/**", "coverage/**", "ui/dist/**"],
  },

  /*
   * Server, shared and tests. `tsconfig.test.json` is the only project that
   * includes `test/`, and `projectService: true` cannot reach it: the service
   * finds a project by walking up to the nearest file named exactly
   * `tsconfig.json`, and the one at the root excludes every test file.
   */
  {
    files: ["src/**/*.ts", "shared/**/*.ts", "test/**/*.ts"],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        project: ["./tsconfig.test.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: typeAware,
  },

  /*
   * The panel. `reactHooks.configs.flat` is the flat-config namespace — in
   * eslint-plugin-react-hooks v7 the bare `configs.recommended` is the eslintrc
   * shape and ESLint rejects it.
   */
  {
    files: ["ui/src/**/*.{ts,tsx}", "test/panel/**/*.tsx"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      reactHooks.configs.flat["recommended-latest"],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        project: ["./ui/tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      ...typeAware,
      "react-hooks/exhaustive-deps": "error",
      // The phase transitions that follow an attach are the synchronisation
      // this rule pushes out of effects. Restructuring them is a change to the
      // code with the longest defect history, not a lint fix.
      "react-hooks/set-state-in-effect": "off",
    },
  },

  /*
   * A `console.log` on a stdio server writes into the JSON-RPC stream the host
   * is parsing. Every message the server emits already goes to `process.stderr`.
   */
  {
    files: ["src/**/*.ts", "shared/**/*.ts", "ui/src/**/*.{ts,tsx}"],
    rules: { "no-console": "error" },
  },

  {
    files: ["test/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },

  /*
   * `getByLabelText` infers its return type from the assertion written against
   * it, so the assertion reports as redundant and removing it drops the element
   * back to `HTMLElement`. The autofix takes `npm run typecheck` red.
   */
  {
    files: ["test/panel/**/*.tsx"],
    rules: { "@typescript-eslint/no-unnecessary-type-assertion": "off" },
  },

  /*
   * Release scripts and build configs. `checkJs` is off for `scripts/` because
   * the comment policy forbids the JSDoc type annotations it would need, so
   * there are no types here to lint against.
   */
  {
    files: ["scripts/**/*.mjs", "*.config.ts", "*.config.js", "eslint.config.js"],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.node,
      sourceType: "module",
      ecmaVersion: 2023,
    },
    rules: { eqeqeq: ["error", "always", { null: "ignore" }] },
  },
);
