import { useCallback, useState } from "react";
import {
  attachPassage,
  describePassages,
  quotePassages,
  type Passage,
} from "../../../shared/passages.js";
import type { Bridge } from "../bridge.js";
import { messageOf } from "../lib/results.js";

const SENT_NOTICE_MS = 4000;

export interface PassageTray {
  /** The live selection, not yet pinned. */
  pending: Passage | null;
  select: (passage: Passage | null) => void;
  passages: Passage[];
  pin: (passage: Passage) => void;
  unpin: (id: string) => void;
  clear: () => void;
  send: (note: string) => Promise<void>;
  sending: boolean;
  sent: string | null;
  /** Whether there is anything worth showing the bar for. */
  active: boolean;
}

/**
 * Regions of the panel on their way to the chat.
 *
 * Sending is `ui/message`, which starts a normal turn — so the answer arrives in
 * the conversation, next to the panel, rather than inside it. Several regions
 * can stack into one message: pointing at two things and asking how they relate
 * is a question you cannot ask one quote at a time.
 */
export function usePassages(
  bridge: Bridge | null,
  display: string | undefined,
  onFailure: (message: string | null) => void,
): PassageTray {
  const [pending, setPending] = useState<Passage | null>(null);
  const [passages, setPassages] = useState<Passage[]>([]);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  const pin = useCallback((next: Passage) => {
    setPassages((current) => attachPassage(current, next));
    setPending(null);
  }, []);

  const unpin = useCallback((id: string) => {
    setPassages((current) => current.filter((p) => p.id !== id));
  }, []);

  const clear = useCallback(() => {
    setPending(null);
    setPassages([]);
  }, []);

  const send = useCallback(
    async (note: string) => {
      if (!bridge || !display) return;
      // Whatever is still highlighted counts as selected, so a single region
      // needs no trip through the + button before it can be sent.
      const outgoing = pending ? attachPassage(passages, pending) : passages;
      if (outgoing.length === 0) return;

      setSending(true);
      onFailure(null);
      try {
        await bridge.sendMessage(quotePassages(display, outgoing, note));
        clear();
        setSent(`Sent ${describePassages(outgoing)} to Claude.`);
        window.setTimeout(() => setSent(null), SENT_NOTICE_MS);
      } catch (cause) {
        onFailure(messageOf(cause));
      } finally {
        setSending(false);
      }
    },
    [bridge, display, passages, pending, clear, onFailure],
  );

  return {
    pending,
    select: setPending,
    passages,
    pin,
    unpin,
    clear,
    send,
    sending,
    sent,
    active: pending !== null || passages.length > 0,
  };
}
