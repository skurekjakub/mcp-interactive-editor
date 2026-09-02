/**
 * @module
 *
 * The world the preview pretends to run in.
 *
 * `npm run preview` serves the panel in a plain browser tab with nothing behind
 * it. The fixture here stands in for the server: the same lint and diff modules
 * run against a made-up proposal, so the layout can be worked on with no file
 * at risk. Dry run is not negotiable — a fixture that reported otherwise would
 * be teaching the wrong reflex.
 */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { EditorState, Proposal } from "../../shared/types.js";
import { countLines } from "../../shared/diff.js";
import { composeState, type StateContext } from "../../shared/state.js";
import type { Bridge } from "./bridge.js";
import { PANEL_VERSION } from "./lib/version.js";

const PREVIEW_CONTEXT: StateContext = {
  roots: ["/preview"],
  dryRun: true,
  serverVersion: PANEL_VERSION,
};

const PREVIEW_BASELINE = `# Deploy pipeline
name: deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm test

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-artifact@v4
        with:
          name: dist
          path: dist/

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/download-artifact@v4
      - run: ./scripts/deploy.sh
`;

const PREVIEW_PROPOSED = `# Deploy pipeline
name: deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run build
      - run: ./scripts/deploy.sh`;

/**
 * Builds the fixture proposal the preview runs on.
 *
 * @returns A proposal against an imaginary workflow file.
 */
function previewProposal(): Proposal {
  return {
    proposalId: "preview",
    mode: "overwrite",
    target: {
      requested: ".github/workflows/deploy.yml",
      absolute: "/preview/.github/workflows/deploy.yml",
      display: ".github/workflows/deploy.yml",
      root: "/preview",
      exists: true,
      onDisk: {
        bytes: PREVIEW_BASELINE.length,
        lines: countLines(PREVIEW_BASELINE),
        sha256: "preview",
        mode: 0o644,
      },
    },
    content: PREVIEW_PROPOSED,
    originalContent: PREVIEW_PROPOSED,
    baseline: PREVIEW_BASELINE,
    rationale: "Collapse the three jobs into one so deploys stop waiting on the artifact upload.",
    attached: false,
    destructiveAcknowledged: false,
    createdAt: 0,
  };
}

/**
 * Builds an in-memory server for the preview.
 *
 * It runs the same lint and diff modules the real one does, so the preview
 * behaves as the editor does — minus the part that touches disk.
 *
 * @returns A bridge backed by fixture state.
 */
export function previewBridge(): Bridge {
  let proposal = previewProposal();

  const state = (): EditorState => composeState(proposal, PREVIEW_CONTEXT);

  const ok = (structuredContent: unknown, text: string): CallToolResult => ({
    content: [{ type: "text", text }],
    structuredContent: structuredContent as Record<string, unknown>,
  });

  return {
    async callTool(name, args) {
      switch (name) {
        case "editor_attach":
          proposal = { ...proposal, attached: true };
          return ok(state(), "attached");

        case "editor_update":
          proposal = {
            ...proposal,
            ...(typeof args.content === "string" ? { content: args.content } : {}),
            ...(typeof args.destructiveAcknowledged === "boolean"
              ? { destructiveAcknowledged: args.destructiveAcknowledged }
              : {}),
          };
          return ok(state(), "updated");

        case "editor_commit": {
          const blockers = state().findings.filter((f) => f.severity === "blocker");
          if (blockers.length > 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `Refusing to write:\n${blockers.map((b) => `  - ${b.message}`).join("\n")}`,
                },
              ],
              isError: true,
            };
          }
          return ok(
            {
              ok: true,
              path: proposal.target.absolute,
              display: proposal.target.display,
              mode: proposal.mode,
              bytes: proposal.content.length,
              lines: countLines(proposal.content),
              sha256: "preview0000000000000000000000000000000000000000000000000000000000",
              dryRun: true,
              editedByHuman: proposal.content !== proposal.originalContent,
              content: proposal.content,
            },
            "committed (preview)",
          );
        }

        default:
          return ok(state(), "noop");
      }
    },
    async updateModelContext() {
      return {};
    },
    async sendMessage() {
      return {};
    },
  };
}

/**
 * Builds the editor state the preview opens on.
 *
 * @returns Fixture state, complete with a real diff and real findings.
 */
export function previewState(): EditorState {
  return composeState(previewProposal(), PREVIEW_CONTEXT);
}
