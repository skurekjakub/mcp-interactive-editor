/**
 * @module
 *
 * Types shared between the MCP server (Node) and the panel (browser).
 *
 * Dependency-free so both build targets can consume it.
 */

/** What a proposal intends to do to the file it names. */
export type WriteMode = "create" | "overwrite" | "delete";

/**
 * Why a requested path cannot be written.
 *
 * Every rejection carries one of these so the refusal can name the check that
 * failed. Collapsing them loses the difference between a path outside the roots
 * and one inside a root that the deny list caught, and the second reported as
 * the first is undebuggable: it tells a human their own file is outside their
 * own project, directly above the root that contains it.
 */
export type PathRejection =
  "outside-roots" | "denied" | "unresolvable" | "not-a-file" | "too-large";

/** A resolved write target, or the reason it cannot be one. */
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
  /** Which check refused the path. Set whenever `absolute` is null. */
  rejection?: PathRejection;
  /** The denied pattern that matched, when `rejection` is `denied`. */
  deniedBy?: string;
  /** Size, hash and permissions of what is on disk right now, when it exists. */
  onDisk?: {
    bytes: number;
    lines: number;
    sha256: string;
    /** POSIX mode, carried so a commit can restore it rather than reset it. */
    mode: number;
  };
}

/** How much a finding should interrupt the human. */
type FindingSeverity = "blocker" | "warning" | "info";

/** One thing worth saying about a proposal before it lands. */
export interface Finding {
  id: string;
  rule: string;
  severity: FindingSeverity;
  message: string;
  detail?: string;
  /** A one-click rewrite of the whole content. */
  fix?: { label: string; content: string };
}

/** How a proposal stopped being open. */
export type Resolution = "committed" | "discarded" | "changes-requested" | "superseded";

/** A pending write, from the moment it is proposed until it resolves. */
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
  /** Set by the app-only attach tool. `editor_commit` refuses without it. */
  attached: boolean;
  /** Human ticked the box for a destructive write. */
  destructiveAcknowledged: boolean;
  /** When the proposal stopped being open, in ISO 8601. */
  resolvedAt?: string;
  /** How it stopped being open. A discarded proposal must not report as committed. */
  resolution?: Resolution;
  /** When the proposal was created, for eviction. */
  createdAt: number;
}

/** Everything the View needs for a first paint, returned as `structuredContent`. */
export type EditorState = {
  proposal: Proposal;
  findings: Finding[];
  diff: DiffHunk[];
  /** How much the proposal changes, measured on the same pass that built `diff`. */
  stats: DiffStats;
  roots: string[];
  /** True when the server was started with --dry-run and will never touch disk. */
  dryRun: boolean;
  /**
   * The server's version, so the panel can notice it is a different build.
   *
   * The `.mcpb` extension and the Claude Code plugin are separate installs with
   * separate update cycles. When they drift, the symptom is behaviour matching
   * neither release, and nothing on screen says so.
   */
  serverVersion: string;
};

/**
 * What an editor-opening tool returns instead of an `EditorState`.
 *
 * `structuredContent` has two readers: the View paints from it, and the host
 * also hands it to the model. Anything in here is therefore paid for in context
 * on every proposal, which is why it is a claim ticket rather than the file. The
 * View redeems it for the full state through `editor_attach`, a call it already
 * makes on mount.
 */
export type ProposalHandle = {
  proposalId: string;
  /** Enough to name the file while the panel attaches. */
  display: string;
  mode: WriteMode;
  /** Set when the path was refused, so the model can tell a refusal from an opened panel. */
  refused?: boolean;
  /** Which check refused the path, when it was refused. */
  rejection?: PathRejection;
};

/**
 * How a review ended.
 *
 * The editor is a gate rather than a viewer, so under `--block-on-review` the
 * tool call that opened it does not return until one of these happens. Comments
 * and a commit are deliberately exclusive: saying something about a draft is the
 * same as declining it, and the agent is told to redraft rather than being told
 * the write went through with remarks attached.
 */
export type ReviewOutcome =
  | { kind: "committed"; receipt: CommitReceipt }
  | { kind: "changes-requested"; message: string }
  | { kind: "discarded"; reason?: string }
  /** The panel never answered — no host to render it, or nobody came back. */
  | { kind: "unanswered"; why: string };

/** Which side of a diff a line belongs to. */
export type DiffLineKind = "equal" | "add" | "remove";

/** One line of a rendered diff, numbered against both files. */
export interface DiffLine {
  kind: DiffLineKind;
  oldLine: number | null;
  newLine: number | null;
  text: string;
}

/** A run of changed lines with enough context to read it. */
export interface DiffHunk {
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

/** How much a proposal changes, in lines. */
export interface DiffStats {
  added: number;
  removed: number;
  /** Set when the files were too large to diff line by line. */
  truncated?: boolean;
  /**
   * Set when the trailing newline differs between the two sides.
   *
   * Lines are compared without their terminators, so this change never appears
   * in the hunks, whether it arrives alone or alongside other edits. Both readers
   * are told about it as a finding instead, since an empty diff in front of a
   * real write reads as nothing happening.
   */
  newlineAtEofChanged?: boolean;
}

/**
 * Proof of what landed, returned by the commit tool.
 *
 * `content` is present for the panel, which uses it to tell the model what a
 * human actually saved when that differs from what was proposed. It is stripped
 * before the receipt travels back through a blocking opener, because the file
 * body has no business entering the model's context a second time.
 */
export type CommitReceipt = {
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
  content?: string;
};
