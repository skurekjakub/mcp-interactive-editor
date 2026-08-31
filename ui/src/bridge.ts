import type { App } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult, ContentBlock } from "@modelcontextprotocol/sdk/types.js";
import type { EditorState, Proposal } from "../../shared/types.js";
import { diffLines } from "../../shared/diff.js";
import { lintProposal } from "../../shared/lint.js";

/**
 * Everything the View needs from the outside world, behind one small interface.
 *
 * There are two implementations. The real one talks to the host. The preview one
 * runs the same logic in memory so `npm run preview` gives you the whole editor in
 * a browser tab with no MCP host, no Claude Desktop, and no risk to any file.
 */
export interface Bridge {
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
  updateModelContext(params: {
    content?: ContentBlock[];
    structuredContent?: Record<string, unknown>;
  }): Promise<unknown>;
  sendMessage(text: string): Promise<unknown>;
}

/** The View is always framed by a real host. A top-level window means preview. */
export const IS_PREVIEW = typeof window !== "undefined" && window.parent === window;

export function hostBridge(app: App): Bridge {
  return {
    callTool: (name, args) =>
      app.callServerTool({ name, arguments: args }) as Promise<CallToolResult>,
    updateModelContext: (params) => app.updateModelContext(params),
    sendMessage: (text) => app.sendMessage({ role: "user", content: [{ type: "text", text }] }),
  };
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

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
        lines: PREVIEW_BASELINE.split("\n").length,
        sha256: "preview",
        mtimeMs: 0,
      },
    },
    content: PREVIEW_PROPOSED,
    originalContent: PREVIEW_PROPOSED,
    baseline: PREVIEW_BASELINE,
    rationale: "Collapse the three jobs into one so deploys stop waiting on the artifact upload.",
    attached: false,
    destructiveAcknowledged: false,
  };
}

/**
 * An in-memory server. It runs the same lint and diff modules the real one does,
 * so what you see in preview is what the editor actually does — minus the part
 * where it touches your disk.
 */
export function previewBridge(): Bridge {
  let proposal = previewProposal();

  const state = (): EditorState => {
    const after = proposal.mode === "delete" ? "" : proposal.content;
    const { hunks, stats } = diffLines(proposal.baseline, after);
    return {
      proposal,
      findings: lintProposal(proposal, stats),
      diff: hunks,
      roots: ["/preview"],
      dryRun: true,
    };
  };

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
              lines: proposal.content.split("\n").length,
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

export function previewState(): EditorState {
  const proposal = previewProposal();
  const { hunks, stats } = diffLines(proposal.baseline, proposal.content);
  return {
    proposal,
    findings: lintProposal(proposal, stats),
    diff: hunks,
    roots: ["/preview"],
    dryRun: true,
  };
}
