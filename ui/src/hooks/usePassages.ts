import { useCallback, useMemo, useState } from "react";
import {
  annotatePassage,
  attachPassage,
  quotePassages,
  unanswered,
  type Passage,
} from "../../../shared/passages.js";
import type { Bridge } from "../bridge.js";
import { call } from "../lib/call.js";
import { messageOf } from "../lib/results.js";

/** The tray of highlighted regions and their journey back to the agent. */
export interface PassageTray {
  /** The live selection, not yet pinned. */
  pending: Passage | null;
  select: (passage: Passage | null) => void;
  passages: Passage[];
  /**
   * Everything that would be sent right now, pinned or not.
   *
   * A live selection counts as selected so a single region needs no trip through
   * the add button. That convenience only holds if the rest of the tray agrees:
   * counting and blocking on the pinned set alone lets an uncommented stray
   * selection ride along, contradicting the rule the tray enforces on screen.
   */
  outgoing: Passage[];
  pin: (passage: Passage) => void;
  annotate: (id: string, note: string) => void;
  unpin: (id: string) => void;
  clear: () => void;
  send: (note: string) => Promise<void>;
  sending: boolean;
  /** Set once the comments have gone back and the draft has been declined. */
  rejected: boolean;
  /** Whether there is anything worth showing the tray for. */
  active: boolean;
}

/**
 * Collects highlighted regions and sends them back as a rejection.
 *
 * Sending is not a chat message. It resolves the tool call that opened the panel
 * and is still waiting on it, which is what makes one button press finish the
 * job rather than leaving a draft sitting in a composer to be sent a second
 * time. It is also a rejection: commenting on a draft declines it, so nothing is
 * written and the agent is handed the words to redraft from.
 *
 * @param bridge - How to reach the host, or null before it connects.
 * @param proposalId - The proposal being commented on.
 * @param display - The file name, for the quoted message.
 * @param onFailure - Where to report a refusal.
 * @returns The tray state and the operations on it.
 */
export function usePassages(
  bridge: Bridge | null,
  proposalId: string | undefined,
  display: string | undefined,
  onFailure: (message: string | null) => void,
): PassageTray {
  const [pending, setPending] = useState<Passage | null>(null);
  const [passages, setPassages] = useState<Passage[]>([]);
  const [sending, setSending] = useState(false);
  const [rejected, setRejected] = useState(false);

  const outgoing = useMemo(
    () => (pending ? attachPassage(passages, pending) : passages),
    [passages, pending],
  );

  const pin = useCallback((next: Passage) => {
    setPassages((current) => attachPassage(current, next));
    setPending(null);
  }, []);

  const unpin = useCallback((id: string) => {
    setPassages((current) => current.filter((p) => p.id !== id));
  }, []);

  /** The comment for one highlight. Each carries its own; sending waits for all. */
  const annotate = useCallback((id: string, note: string) => {
    setPassages((current) => annotatePassage(current, id, note));
  }, []);

  const clear = useCallback(() => {
    setPending(null);
    setPassages([]);
  }, []);

  const send = useCallback(
    async (note: string) => {
      if (!bridge || !display || !proposalId) return;
      if (outgoing.length === 0 || unanswered(outgoing).length > 0) return;

      setSending(true);
      onFailure(null);
      try {
        const sent = await call(bridge, "editor_request_changes", {
          proposalId,
          message: quotePassages(display, outgoing, note),
        });
        if (sent.refusal) {
          onFailure(sent.refusal);
          return;
        }

        /*
         * If an opening call was waiting, it has just returned with these
         * comments and the agent already has them. If nothing was waiting they
         * still have to travel, so they go as a message instead. Either way the
         * words arrive; only the route differs.
         */
        const delivered = (sent.result.structuredContent as { delivered?: boolean } | undefined)
          ?.delivered;
        if (delivered !== true) {
          await bridge.sendMessage(quotePassages(display, outgoing, note));
        }

        clear();
        setRejected(true);
      } catch (cause) {
        onFailure(messageOf(cause));
      } finally {
        setSending(false);
      }
    },
    [bridge, proposalId, display, outgoing, clear, onFailure],
  );

  return {
    pending,
    select: setPending,
    passages,
    outgoing,
    pin,
    annotate,
    unpin,
    clear,
    send,
    sending,
    rejected,
    active: pending !== null || passages.length > 0,
  };
}
