import { useCallback, useState } from "react";
import {
  annotatePassage,
  attachPassage,
  quotePassages,
  type Passage,
} from "../../../shared/passages.js";
import type { Bridge } from "../bridge.js";
import { messageOf } from "../lib/results.js";

export interface PassageTray {
  /** The live selection, not yet pinned. */
  pending: Passage | null;
  select: (passage: Passage | null) => void;
  passages: Passage[];
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
 * Regions of the panel, and what is being asked about each, on their way back to
 * the agent.
 *
 * Sending is not a chat message. It resolves the tool call that opened this
 * panel and is still waiting on it, which is what makes one button press finish
 * the job rather than leaving a draft sitting in a composer for someone to send
 * a second time. It is also a rejection: commenting on a draft declines it, so
 * nothing is written and the agent is handed the words to redraft from.
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
      // Whatever is still highlighted counts as selected, so a single region
      // needs no trip through the + button before it can be sent.
      const outgoing = pending ? attachPassage(passages, pending) : passages;
      if (outgoing.length === 0) return;

      setSending(true);
      onFailure(null);
      try {
        const result = await bridge.callTool("editor_request_changes", {
          proposalId,
          message: quotePassages(display, outgoing, note),
        });

        if (result.isError) {
          onFailure(textOf(result));
          return;
        }

        clear();
        setRejected(true);
      } catch (cause) {
        onFailure(messageOf(cause));
      } finally {
        setSending(false);
      }
    },
    [bridge, proposalId, display, passages, pending, clear, onFailure],
  );

  return {
    pending,
    select: setPending,
    passages,
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

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
}
