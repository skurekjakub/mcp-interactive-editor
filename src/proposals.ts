import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { EditorState, Proposal, Resolution, TargetInfo, WriteMode } from "../shared/types.js";
import { diffLines } from "../shared/diff.js";
import { lintProposal } from "../shared/lint.js";
import { FsGuard, sha256 } from "./fsGuard.js";
import { SERVER_VERSION } from "./version.js";

/**
 * Open proposals, keyed by id.
 *
 * They live for the lifetime of the server process and not beyond it: a
 * proposal outliving the conversation that produced it is one nobody remembers
 * approving.
 */
const proposals = new Map<string, Proposal>();

/**
 * How many proposals to retain before evicting the oldest.
 *
 * A server started as a plugin lives as long as the session, and a proposal the
 * human scrolls past never resolves on its own. Each retains the file three
 * times over — content, original and baseline — so an unbounded map is both a
 * leak and a correctness problem: the single-open fallback in
 * {@link findOpenProposal} can only fire while exactly one proposal is open.
 */
const MAX_RETAINED = 32;

/** How long an unresolved proposal stays claimable, in milliseconds. */
const PROPOSAL_TTL_MS = 60 * 60 * 1000;

/** What a caller must supply to open a proposal. */
export interface ProposalInput {
  path: string;
  content: string;
  mode: WriteMode;
  rationale?: string;
  /**
   * The already-resolved target, when the caller has one.
   *
   * Resolving a target reads the whole file to hash it, so a caller that has
   * already described the path passes the result through rather than paying for
   * the read again.
   */
  target?: TargetInfo;
  /** The file as it is on disk, paired with `target`. */
  baseline?: string;
}

/**
 * Opens a proposal and returns it.
 *
 * Any earlier open proposal for the same path is marked superseded, because two
 * live drafts of one file cannot both be the one the panel means.
 *
 * @param guard - Filesystem guard used to resolve the path when none was given.
 * @param input - The path, content and mode, plus a pre-resolved target if held.
 * @returns The stored proposal, with its generated id.
 */
export async function createProposal(guard: FsGuard, input: ProposalInput): Promise<Proposal> {
  const target = input.target ?? (await guard.describe(input.path));
  const baseline =
    input.target && input.baseline !== undefined
      ? input.baseline
      : target.absolute && target.exists
        ? await guard.read(target.absolute)
        : "";

  for (const open of openProposals()) {
    if (samePath(open.target.requested, input.path)) resolveProposal(open.proposalId, "superseded");
  }

  const proposal: Proposal = {
    proposalId: randomUUID(),
    mode: input.mode,
    target,
    content: input.mode === "delete" ? "" : input.content,
    originalContent: input.mode === "delete" ? "" : input.content,
    baseline,
    rationale: input.rationale,
    attached: false,
    destructiveAcknowledged: false,
    createdAt: Date.now(),
  };

  proposals.set(proposal.proposalId, proposal);
  evict();
  return proposal;
}

/**
 * Returns the proposal with the given id.
 *
 * @param proposalId - Identifier handed out when the proposal was created.
 * @returns The stored proposal.
 * @throws {Error} When no proposal with that id is held.
 */
export function getProposal(proposalId: string): Proposal {
  const proposal = proposals.get(proposalId);
  if (!proposal) {
    throw new Error(
      `Unknown proposal ${proposalId}. It probably belongs to a previous run of the server.`,
    );
  }
  return proposal;
}

/**
 * Applies a patch to a proposal that is still open.
 *
 * @param proposalId - Which proposal to change.
 * @param patch - Fields to overwrite. The id itself is never changed.
 * @returns The updated proposal.
 * @throws {Error} When the proposal has already resolved.
 */
export function updateProposal(proposalId: string, patch: Partial<Proposal>): Proposal {
  const current = getProposal(proposalId);
  if (current.resolvedAt) {
    throw new Error(
      `This proposal was already ${current.resolution ?? "resolved"}. Open a new one.`,
    );
  }
  const next: Proposal = { ...current, ...patch, proposalId: current.proposalId };
  proposals.set(proposalId, next);
  return next;
}

/**
 * Closes a proposal, recording how it ended.
 *
 * A discarded proposal and a committed one are both closed, and reporting the
 * first as the second tells a human their file was written when nothing was.
 *
 * @param proposalId - Which proposal to close.
 * @param resolution - How it ended.
 * @returns The closed proposal.
 */
export function resolveProposal(proposalId: string, resolution: Resolution): Proposal {
  const current = getProposal(proposalId);
  const next: Proposal = { ...current, resolvedAt: new Date().toISOString(), resolution };
  proposals.set(proposalId, next);
  return next;
}

/**
 * Reads the target from disk again without storing what it finds.
 *
 * Purity is the whole contract. Persisting the fresh baseline would overwrite
 * the one the human approved against, so the staleness comparison that follows
 * would be new-against-new and pass — turning the refusal into a one-shot that
 * a second click walks straight through, clobbering whatever the other writer
 * put there.
 *
 * @param guard - Filesystem guard used to resolve and read the path.
 * @param proposal - The proposal whose target should be re-read.
 * @returns The current target and file contents, unsaved.
 */
export async function restatTarget(
  guard: FsGuard,
  proposal: Proposal,
): Promise<{ target: TargetInfo; baseline: string }> {
  const target = await guard.describe(proposal.target.requested);
  const baseline = target.absolute && target.exists ? await guard.read(target.absolute) : "";
  return { target, baseline };
}

/**
 * Reports whether the file changed since the human approved the diff.
 *
 * @param baselineNow - The file as it is on disk at commit time.
 * @param baselineAtOpen - The file as it was when the proposal opened.
 * @returns True when the approved diff is not the diff that would be applied.
 */
export function isStale(baselineNow: string, baselineAtOpen: string): boolean {
  return sha256(baselineNow) !== sha256(baselineAtOpen);
}

/**
 * Assembles everything the View needs for a paint.
 *
 * @param guard - Filesystem guard, for the roots and dry-run flag.
 * @param proposal - The proposal being shown.
 * @returns The complete editor state.
 */
export function buildEditorState(guard: FsGuard, proposal: Proposal): EditorState {
  const after = proposal.mode === "delete" ? "" : proposal.content;
  const { hunks, stats } = diffLines(proposal.baseline, after);

  return {
    proposal,
    findings: lintProposal(proposal, stats),
    diff: hunks,
    roots: guard.roots,
    dryRun: guard.dryRun,
    serverVersion: SERVER_VERSION,
  };
}

/**
 * Counts what a proposal adds and removes.
 *
 * @param proposal - The proposal to measure.
 * @returns Added and removed line counts.
 */
export function diffStatsFor(proposal: Proposal) {
  const after = proposal.mode === "delete" ? "" : proposal.content;
  return diffLines(proposal.baseline, after).stats;
}

/**
 * Finds the newest proposal still open, optionally for one path.
 *
 * The panel mounts on the tool call, before that call returns, so it holds the
 * arguments but not the id. Claiming by path is how it finds the proposal it was
 * opened for. Newest wins because a second proposal on a path supersedes the
 * first.
 *
 * @param path - Path the panel was opened with, in whatever spelling arrived.
 * @returns The proposal to show, or undefined when the answer is not knowable.
 */
export function findOpenProposal(path?: string): Proposal | undefined {
  const open = openProposals();
  if (open.length === 0) return undefined;
  if (path === undefined) return open[open.length - 1];

  const exact = open.filter((p) => p.target.requested === path);
  if (exact.length > 0) return exact[exact.length - 1];

  // A host is free to normalise a path on the way through — slashes, case,
  // relative to absolute — so an exact string match is not the only match.
  const resolved = open.filter((p) => samePath(p.target.requested, path));
  if (resolved.length > 0) return resolved[resolved.length - 1];

  /*
   * With exactly one proposal open it must be that one, whatever the host did to
   * the path. Without this a panel retries a string it can never match and dies
   * on a loading screen.
   *
   * With several open, guess nothing: the panel may be asking before its own
   * proposal exists, and handing it somebody else's puts a human in front of the
   * wrong file. The retry finds the right one once it is created.
   */
  return open.length === 1 ? open[0] : undefined;
}

/**
 * Reports whether two paths name the same file.
 *
 * @param a - One path, in any spelling.
 * @param b - The other path, in any spelling.
 * @returns True when both resolve to the same location.
 */
function samePath(a: string, b: string): boolean {
  const normalise = (p: string) => resolve(p).split("\\").join("/").toLowerCase();
  try {
    return normalise(a) === normalise(b);
  } catch {
    return false;
  }
}

/**
 * Lists every proposal still awaiting a decision, oldest first.
 *
 * @returns The open proposals, excluding any that has aged out.
 */
export function openProposals(): Proposal[] {
  const cutoff = Date.now() - PROPOSAL_TTL_MS;
  return [...proposals.values()].filter((p) => !p.resolvedAt && p.createdAt >= cutoff);
}

/**
 * Drops resolved and aged-out proposals down to the retention limit.
 *
 * Insertion order is creation order, so the oldest entries are evicted first.
 */
function evict() {
  const cutoff = Date.now() - PROPOSAL_TTL_MS;
  for (const [id, proposal] of proposals) {
    if (proposal.resolvedAt || proposal.createdAt < cutoff) proposals.delete(id);
    if (proposals.size <= MAX_RETAINED) break;
  }
  while (proposals.size > MAX_RETAINED) {
    const oldest = proposals.keys().next().value;
    if (oldest === undefined) break;
    proposals.delete(oldest);
  }
}

/**
 * Empties the store.
 *
 * @remarks Exists for tests, which must not inherit state across cases.
 */
export function clearProposals(): void {
  proposals.clear();
}
