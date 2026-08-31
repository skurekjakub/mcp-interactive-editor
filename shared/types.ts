/**
 * Types shared between the MCP server (Node) and the panel (browser).
 * Dependency-free so both build targets can consume it.
 */

export type WriteMode = "create" | "overwrite" | "delete";

export interface TargetInfo {
  /** Path as the model wrote it, before normalisation. */
  requested: string;
  /** Absolute, normalised, symlink-resolved. Null when it could not be resolved safely. */
  absolute: string | null;
  /** Path relative to the root that contains it, for display. */
  display: string;
  /** The configured root this path falls under, if any. */
  root: string | null;
  exists: boolean;
  /** Size and hash of what is on disk right now, when it exists. */
  onDisk?: { bytes: number; lines: number; sha256: string; mtimeMs: number };
}

export type FindingSeverity = "blocker" | "warning" | "info";

export interface Finding {
  id: string;
  rule: string;
  severity: FindingSeverity;
  message: string;
  detail?: string;
  /** Character range in the proposed content, when anchored to the body. */
  range?: [number, number];
  /** A one-click rewrite of the whole content. */
  fix?: { label: string; content: string };
}

export interface Proposal {
  proposalId: string;
  mode: WriteMode;
  target: TargetInfo;
  /** What the model wants on disk. Edited freely by the human before it lands. */
  content: string;
  /** The model's original content, kept so the View can show what the human changed. */
  originalContent: string;
  /** What is on disk right now, for the diff. Empty string for a new file. */
  baseline: string;
  /** Why the model wants this write. Shown above the editor. */
  rationale?: string;
  /** Set by the app-only attach tool. `commit_write` refuses without it. */
  attached: boolean;
  /** Human ticked the box for a destructive write. */
  destructiveAcknowledged: boolean;
  committedAt?: string;
}

/** Everything the View needs for a first paint, returned as `structuredContent`. */
export interface EditorState {
  proposal: Proposal;
  findings: Finding[];
  diff: DiffHunk[];
  roots: string[];
  /** True when the server was started with --dry-run and will never touch disk. */
  dryRun: boolean;
}

/**
 * What an editor-opening tool returns instead of an `EditorState`.
 *
 * `structuredContent` has two readers: the View paints from it, and the host
 * also hands it to the model. So anything in here is paid for in context on
 * every proposal — which is why this is a claim ticket and not the file. The
 * View redeems it for the full state through `editor_attach`, a call it already
 * makes on mount.
 */
export interface ProposalHandle {
  proposalId: string;
  /** Enough to name the file while the panel attaches. */
  display: string;
  mode: WriteMode;
  /** Set when the path was refused, so the panel can say so before it attaches. */
  refused?: boolean;
}

export type DiffLineKind = "equal" | "add" | "remove";

export interface DiffLine {
  kind: DiffLineKind;
  oldLine: number | null;
  newLine: number | null;
  text: string;
}

export interface DiffHunk {
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export interface DiffStats {
  added: number;
  removed: number;
  /** Set when the files were too large to diff line by line. */
  truncated?: boolean;
}

export interface CommitReceipt {
  ok: boolean;
  path: string;
  display: string;
  mode: WriteMode;
  bytes: number;
  lines: number;
  sha256: string;
  dryRun: boolean;
  /** True when the human changed the model's proposal before committing. */
  editedByHuman: boolean;
  content: string;
}
