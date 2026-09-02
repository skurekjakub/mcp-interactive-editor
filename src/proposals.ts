/**
 * @module
 *
 * The life of a proposal: opened, edited, claimed by a panel, and closed.
 *
 * Everything here reads and writes the shared store rather than holding state
 * of its own, because the process answering the panel is routinely not the one
 * that opened the proposal.
 */
import { randomUUID } from "node:crypto";
import type { EditorState, Proposal, Resolution, TargetInfo, WriteMode } from "../shared/types.js";
import { composeState } from "../shared/state.js";
import type { FsGuard } from "./fsGuard.js";
import { sha256 } from "./hash.js";
import { namesTarget, sameTarget } from "./pathSpelling.js";
import { allProposals, deleteProposal, readProposal, writeProposal } from "./store/records.js";
import { pruneTombstones, readTombstone, writeTombstone } from "./store/tombstones.js";
import { SERVER_VERSION } from "./version.js";

/**
 * How many proposals to retain before evicting the oldest.
 *
 * A server started as a plugin lives as long as the session, and a proposal the
 * human scrolls past never resolves on its own. Each retains the file three
 * times over — content, original and baseline — so an unbounded store is both a
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

  for (const open of await openProposals()) {
    if (sameTarget(open.target, target)) await resolveProposal(open.proposalId, "superseded");
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

  await writeProposal(proposal);
  await evict();
  return proposal;
}

/**
 * Returns the proposal with the given id.
 *
 * @param proposalId - Identifier handed out when the proposal was created.
 * @returns The stored proposal.
 * @throws {Error} When no proposal with that id is held.
 */
export async function getProposal(proposalId: string): Promise<Proposal> {
  const proposal = await readProposal(proposalId);
  if (proposal) return proposal;

  const ended = await readTombstone(proposalId);
  if (ended) {
    throw new Error(`This proposal was ${ended} to make room for newer ones. Open a new one.`);
  }

  /*
   * The panel outlives the server process. A host restarts the server when the
   * extension is installed or updated, and every panel already on screen keeps
   * an id no run of the server will issue again — so this is what a human sees
   * after an update, and "unknown id" alone leaves them staring at a dead panel
   * with nothing to do about it.
   */
  throw new Error(
    `Unknown proposal ${proposalId}. This panel belongs to an earlier run of the server — ` +
      `it was probably restarted, which happens when the extension is installed or updated. ` +
      `The draft is gone with it; ask for the write again to get a fresh panel.`,
  );
}

/**
 * Applies a patch to a proposal that is still open.
 *
 * @param proposalId - Which proposal to change.
 * @param patch - Fields to overwrite. The id itself is never changed.
 * @returns The updated proposal.
 * @throws {Error} When the proposal has already resolved.
 */
export async function updateProposal(
  proposalId: string,
  patch: Partial<Proposal>,
): Promise<Proposal> {
  const current = await getProposal(proposalId);
  if (current.resolvedAt) {
    throw new Error(
      `This proposal was already ${current.resolution ?? "resolved"}. Open a new one.`,
    );
  }
  const next: Proposal = { ...current, ...patch, proposalId: current.proposalId };
  await writeProposal(next);
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
export async function resolveProposal(
  proposalId: string,
  resolution: Resolution,
): Promise<Proposal> {
  const current = await getProposal(proposalId);
  const next: Proposal = { ...current, resolvedAt: new Date().toISOString(), resolution };
  await writeProposal(next);
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
  return composeState(proposal, {
    roots: guard.roots,
    dryRun: guard.dryRun,
    serverVersion: SERVER_VERSION,
  });
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
export async function findOpenProposal(path?: string): Promise<Proposal | undefined> {
  const open = await openProposals();
  if (open.length === 0) return undefined;
  if (path === undefined) return open[open.length - 1];

  const exact = open.filter((p) => p.target.requested === path);
  if (exact.length > 0) return exact[exact.length - 1];

  const resolved = open.filter((p) => namesTarget(p.target, path));
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
 * Lists every proposal still awaiting a decision, oldest first.
 *
 * @returns The open proposals, excluding any that has aged out.
 */
export async function openProposals(): Promise<Proposal[]> {
  const cutoff = Date.now() - PROPOSAL_TTL_MS;
  return (await allProposals()).filter((p) => !p.resolvedAt && p.createdAt >= cutoff);
}

/**
 * Trims the store back to the retention limit.
 *
 * Resolved and aged-out proposals go first, so one still awaiting a decision is
 * dropped only when nothing else can be. A resolved proposal is kept while there
 * is room for it: a panel returning to a closed proposal should be told it was
 * closed, and a store that has forgotten it can only say the id is unknown,
 * which reads as a server restart and sends the reader looking in the wrong
 * place.
 *
 * @returns A promise that settles once the store is back within its limit.
 */
async function evict(): Promise<void> {
  await pruneTombstones();

  const held = await allProposals();
  if (held.length <= MAX_RETAINED) return;

  const cutoff = Date.now() - PROPOSAL_TTL_MS;
  const spent = held.filter((p) => p.resolvedAt || p.createdAt < cutoff);
  const live = held.filter((p) => !spent.includes(p));

  // Oldest first within each group, and an open proposal is closed before it is
  // forgotten, so a panel still holding the id is told the proposal was
  // superseded rather than that the server does not know it.
  const doomed = [...spent, ...live].slice(0, held.length - MAX_RETAINED);
  for (const proposal of doomed) {
    if (!proposal.resolvedAt) await writeTombstone(proposal.proposalId, "superseded");
    await deleteProposal(proposal.proposalId);
  }
}
