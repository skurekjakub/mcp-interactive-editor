import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import type { CommitReceipt, EditorState } from "../shared/types.js";
import { formatUnifiedDiff } from "../shared/diff.js";
import { hasBlockers } from "../shared/lint.js";
import { FsGuard, sha256 } from "./fsGuard.js";
import {
  buildEditorState,
  createProposal,
  diffStatsFor,
  getProposal,
  refreshTarget,
  updateProposal,
} from "./proposals.js";

const VIEW_URI = "ui://interactive-editor/panel.html";

/**
 * Two sets of tools, and the split is the entire security model.
 *
 * `visibility: ["model"]` tools can be called by the agent. None of them touch
 * disk — the most they do is open a review panel and read files inside the roots.
 *
 * `visibility: ["app"]` tools are the ones that write, and the host is required
 * by the MCP Apps spec to keep them out of the agent's tool list entirely and to
 * reject any call the agent makes for them. So the model cannot commit a write
 * even if it decides it wants to: the only caller that exists is the View, and
 * the View only calls on a click.
 */
export interface ToolOptions {
  /**
   * Who may call `editor_commit`. Defaults to app-only, which is the whole point.
   * `--terminal-approval` widens it for hosts that cannot render the editor, and
   * trades the editable review for the client's own approve/deny prompt.
   */
  commitVisibility: Array<"model" | "app">;
}

export function registerTools(
  server: McpServer,
  guard: FsGuard,
  options: ToolOptions = { commitVisibility: ["app"] },
): void {
  registerEditorView(server);
  registerProposalTools(server, guard);
  registerAppOnlyTools(server, guard, options);
  registerReadTools(server, guard);
}

// ---------------------------------------------------------------------------
// The View
// ---------------------------------------------------------------------------

function registerEditorView(server: McpServer): void {
  registerAppResource(
    server,
    "Interactive Editor",
    VIEW_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      _meta: {
        ui: {
          // The bundle is inlined, so the View needs nothing from the network.
          // Every list stays empty on purpose: an editor that can phone home is
          // a worse thing than the writes it is guarding.
          csp: { connectDomains: [], resourceDomains: [], frameDomains: [] },
          prefersBorder: true,
        },
      },
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: RESOURCE_MIME_TYPE, text: await loadViewHtml() }],
    }),
  );
}

let cachedHtml: string | undefined;

async function loadViewHtml(): Promise<string> {
  if (cachedHtml) return cachedHtml;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "../ui/index.html"), // dist/src -> dist/ui
    resolve(here, "../../dist/ui/index.html"), // running from src/ via tsx
  ];
  for (const candidate of candidates) {
    try {
      cachedHtml = await readFile(candidate, "utf8");
      return cachedHtml;
    } catch {
      continue;
    }
  }
  throw new Error("The panel is not built. Run `npm run build` first.");
}

// ---------------------------------------------------------------------------
// Model-callable: open a review panel. These never write.
// ---------------------------------------------------------------------------

function registerProposalTools(server: McpServer, guard: FsGuard): void {
  registerAppTool(
    server,
    "propose_write",
    {
      title: "Propose a file write",
      description:
        "Open an editable review panel for writing a file. Shows the human a diff against what is " +
        "on disk, lets them edit your proposed content directly, and waits for them to press the " +
        "button. This tool NEVER writes anything itself — it only opens the editor. Use it for every " +
        "file write instead of writing directly. Returns the diff so you can see what you proposed.",
      inputSchema: {
        path: z
          .string()
          .describe("File to write. Absolute, or relative to the first configured root."),
        content: z.string().describe("The full new contents of the file."),
        rationale: z
          .string()
          .optional()
          .describe("One or two sentences on why this write. Shown to the human above the editor."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: { ui: { resourceUri: VIEW_URI, visibility: ["model", "app"] } },
    },
    async ({ path, content, rationale }) => {
      const target = await guard.describe(path);
      const proposal = await createProposal(guard, {
        path,
        content,
        mode: target.exists ? "overwrite" : "create",
        rationale,
      });
      return editorResult(guard, proposal.proposalId);
    },
  );

  registerAppTool(
    server,
    "open_file",
    {
      title: "Open a file for the human to edit",
      description:
        "Open a file in the review panel so the human can read it and change it by hand. Loads the " +
        "current contents into the editor; nothing is written until they press the button. Use this " +
        "when they want to look at or edit a file themselves rather than have you rewrite it — and " +
        "note that the file body goes to the panel, not into your context, so use read_file if you " +
        "need to see it too.",
      inputSchema: {
        path: z
          .string()
          .describe("File to open. Absolute, or relative to the first configured root."),
        note: z
          .string()
          .optional()
          .describe("Optional line shown above the editor, e.g. what they asked for."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: { ui: { resourceUri: VIEW_URI, visibility: ["model", "app"] } },
    },
    async ({ path, note }) => {
      const target = await guard.describe(path);
      const current = target.absolute && target.exists ? await guard.read(target.absolute) : "";
      const proposal = await createProposal(guard, {
        path,
        content: current,
        mode: target.exists ? "overwrite" : "create",
        rationale: note ?? "Opened for editing. Nothing changes until it is saved.",
      });
      // Deliberately not editorResult: opening a file to read it yourself should
      // not also dump it into the model's context.
      return summaryResult(guard, proposal.proposalId);
    },
  );

  registerAppTool(
    server,
    "propose_delete",
    {
      title: "Propose a file deletion",
      description:
        "Open a review panel for deleting a file. Shows the human everything that would be lost and " +
        "waits for an explicit confirmation. Never deletes anything itself.",
      inputSchema: {
        path: z.string().describe("File to delete."),
        rationale: z.string().optional().describe("Why this file should go."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: { ui: { resourceUri: VIEW_URI, visibility: ["model", "app"] } },
    },
    async ({ path, rationale }) => {
      const proposal = await createProposal(guard, {
        path,
        content: "",
        mode: "delete",
        rationale,
      });
      return editorResult(guard, proposal.proposalId);
    },
  );
}

// ---------------------------------------------------------------------------
// App-only: the editor itself. The host refuses these from the model.
// ---------------------------------------------------------------------------

function registerAppOnlyTools(server: McpServer, guard: FsGuard, options: ToolOptions): void {
  registerAppTool(
    server,
    "editor_attach",
    {
      title: "Attach the panel to a proposal",
      description: "Called by the panel when it mounts. Not for agent use.",
      inputSchema: { proposalId: z.string() },
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ proposalId }) => {
      // Re-stat on attach: the file may have moved on between the model
      // proposing and the human actually looking at the editor.
      await refreshTarget(guard, getProposal(proposalId));
      updateProposal(proposalId, { attached: true });
      return editorResult(guard, proposalId);
    },
  );

  registerAppTool(
    server,
    "editor_update",
    {
      title: "Update a pending proposal",
      description: "Called by the panel as the human edits. Not for agent use.",
      inputSchema: {
        proposalId: z.string(),
        content: z.string().optional(),
        path: z.string().optional(),
        destructiveAcknowledged: z.boolean().optional(),
      },
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ proposalId, content, path, destructiveAcknowledged }) => {
      const current = getProposal(proposalId);
      let next = updateProposal(proposalId, {
        ...(content !== undefined ? { content } : {}),
        ...(destructiveAcknowledged !== undefined ? { destructiveAcknowledged } : {}),
      });

      // Retargeting re-runs the whole guard, including the deny list, and pulls
      // a fresh baseline so the diff matches the new file rather than the old.
      if (path !== undefined && path !== current.target.requested) {
        const target = await guard.describe(path);
        const baseline = target.absolute && target.exists ? await guard.read(target.absolute) : "";
        next = updateProposal(proposalId, {
          target,
          baseline,
          mode: next.mode === "delete" ? "delete" : target.exists ? "overwrite" : "create",
        });
      }

      return editorResult(guard, proposalId);
    },
  );

  registerAppTool(
    server,
    "editor_commit",
    {
      title: "Commit the reviewed write",
      description:
        "The editor. Writes the human-approved content to disk. Called only by the panel, only " +
        "on an explicit click. Not for agent use — the host blocks agent calls to this tool.",
      inputSchema: { proposalId: z.string() },
      _meta: { ui: { visibility: options.commitVisibility } },
    },
    async ({ proposalId }) => {
      const receipt = await commit(guard, proposalId);
      return {
        content: [{ type: "text", text: describeReceipt(receipt) }],
        structuredContent: receipt as unknown as Record<string, unknown>,
      } satisfies CallToolResult;
    },
  );

  registerAppTool(
    server,
    "editor_discard",
    {
      title: "Discard a proposal",
      description: "Called by the panel when the human closes without writing. Not for agent use.",
      inputSchema: { proposalId: z.string(), reason: z.string().optional() },
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ proposalId, reason }) => {
      const proposal = getProposal(proposalId);
      updateProposal(proposalId, { committedAt: new Date().toISOString() });
      return {
        content: [
          {
            type: "text",
            text:
              `Discarded. Nothing was written to ${proposal.target.display}.` +
              (reason ? ` Reason: ${reason}` : ""),
          },
        ],
      } satisfies CallToolResult;
    },
  );
}

// ---------------------------------------------------------------------------
// Read-only helpers, safe for both callers.
// ---------------------------------------------------------------------------

function registerReadTools(server: McpServer, guard: FsGuard): void {
  registerAppTool(
    server,
    "read_file",
    {
      title: "Read a file inside the roots",
      description:
        "Read a file the editor is allowed to write, so a proposal can be based on what is actually " +
        "there. Refuses anything outside the configured roots.",
      inputSchema: { path: z.string() },
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async ({ path }) => {
      const target = await guard.describe(path);
      if (!target.absolute) {
        return errorResult(`${path} is outside the roots this server will touch.`);
      }
      if (!target.exists) {
        return { content: [{ type: "text", text: `${target.display} does not exist.` }] };
      }
      const body = await guard.read(target.absolute);
      return { content: [{ type: "text", text: body }] };
    },
  );

  registerAppTool(
    server,
    "list_roots",
    {
      title: "List writable roots",
      description: "The directories this editor will write inside. Everything else is refused.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async () => ({
      content: [
        {
          type: "text",
          text:
            `Writable roots:\n${guard.roots.map((r) => `  ${r}`).join("\n")}` +
            (guard.dryRun ? "\n\nDRY RUN: commits are simulated, nothing reaches disk." : ""),
        },
      ],
      structuredContent: { roots: guard.roots, dryRun: guard.dryRun },
    }),
  );
}

// ---------------------------------------------------------------------------
// The commit path. Everything the View asserted is checked again here.
// ---------------------------------------------------------------------------

async function commit(guard: FsGuard, proposalId: string): Promise<CommitReceipt> {
  const before = getProposal(proposalId);

  if (before.committedAt) throw new Error("This proposal has already been resolved.");
  if (!before.attached) {
    // Reachable only if a host ignores `visibility`. Refuse anyway: a write that
    // no View ever rendered is a write no human ever saw.
    throw new Error("This proposal was never opened in the editor. Refusing to write.");
  }

  const baselineAtOpen = before.baseline;
  const proposal = await refreshTarget(guard, before);

  if (!proposal.target.absolute) {
    throw new Error(`${proposal.target.requested} is not a writable path.`);
  }

  if (sha256(proposal.baseline) !== sha256(baselineAtOpen)) {
    throw new Error(
      `${proposal.target.display} changed on disk while the editor was open. ` +
        "The diff that was approved is no longer the diff that would be applied. Reopen the proposal.",
    );
  }

  const findings = buildEditorState(guard, proposal).findings;
  if (hasBlockers(findings)) {
    const blockers = findings.filter((f) => f.severity === "blocker").map((f) => f.message);
    throw new Error(`Refusing to write:\n${blockers.map((b) => `  - ${b}`).join("\n")}`);
  }

  const result =
    proposal.mode === "delete"
      ? (await guard.remove(proposal.target.absolute), { bytes: 0, sha256: sha256("") })
      : await guard.commit(proposal.target.absolute, proposal.content);

  updateProposal(proposalId, { committedAt: new Date().toISOString() });

  return {
    ok: true,
    path: proposal.target.absolute,
    display: proposal.target.display,
    mode: proposal.mode,
    bytes: result.bytes,
    lines: proposal.content === "" ? 0 : proposal.content.split("\n").length,
    sha256: result.sha256,
    dryRun: guard.dryRun,
    editedByHuman: proposal.content !== proposal.originalContent,
    content: proposal.content,
  };
}

// ---------------------------------------------------------------------------
// Result shaping
// ---------------------------------------------------------------------------

/**
 * The tool result carries two audiences. `structuredContent` is the View's
 * paint data. `content` is what the model reads — a summary and the diff, never
 * the whole file, because the model already knows what it proposed.
 */
function editorResult(guard: FsGuard, proposalId: string): CallToolResult {
  const state = buildEditorState(guard, getProposal(proposalId));
  return {
    content: [{ type: "text", text: describeState(state) }],
    structuredContent: state as unknown as Record<string, unknown>,
  };
}

/**
 * For opening a file the human wants to read. The panel gets everything; the
 * model gets told a review panel is open and how big the file is, and nothing else.
 */
function summaryResult(guard: FsGuard, proposalId: string): CallToolResult {
  const state = buildEditorState(guard, getProposal(proposalId));
  const { target } = state.proposal;

  const text = target.absolute
    ? `Opened ${target.display} in the edit editor (${target.onDisk?.lines ?? 0} lines). ` +
      `The contents are in the panel, not in this result — call read_file if you need to see them. ` +
      `Wait for the human; they may edit and save, or close it without saving.`
    : `Refused: "${target.requested}" is outside the roots this editor will write to.`;

  return {
    content: [{ type: "text", text }],
    structuredContent: state as unknown as Record<string, unknown>,
  };
}

function describeState(state: EditorState): string {
  const { proposal, findings } = state;
  const stats = diffStatsFor(proposal);
  const lines: string[] = [];

  if (!proposal.target.absolute) {
    return (
      `Refused: "${proposal.target.requested}" is outside the roots this editor will write to.\n` +
      `Writable roots:\n${state.roots.map((r) => `  ${r}`).join("\n")}`
    );
  }

  lines.push(
    `Editor open — nothing has been written.`,
    ``,
    `  ${proposal.mode.toUpperCase()}  ${proposal.target.display}`,
    `  +${stats.added} / -${stats.removed} lines${state.dryRun ? "  (dry run)" : ""}`,
    ``,
  );

  if (findings.length > 0) {
    lines.push("Findings:");
    for (const f of findings) {
      lines.push(`  [${f.severity}] ${f.message}`);
    }
    lines.push("");
  }

  lines.push(
    formatUnifiedDiff(state.diff, proposal.target.display),
    ``,
    `The human reviews and edits this in the editor, then presses the button. ` +
      `You cannot write the file yourself — wait for them, and do not re-propose the same write.`,
  );

  return lines.join("\n");
}

function describeReceipt(receipt: CommitReceipt): string {
  const verb = receipt.mode === "delete" ? "Deleted" : "Wrote";
  const edited = receipt.editedByHuman
    ? " The human edited your proposal before approving it — the content above is what actually landed."
    : "";
  return (
    `${verb} ${receipt.display} (${receipt.lines} lines, ${receipt.bytes} bytes).` +
    (receipt.dryRun ? " DRY RUN — nothing reached disk." : "") +
    edited
  );
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}
