import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp, useHostStyleVariables } from "@modelcontextprotocol/ext-apps/react";
import type { EditorState, ProposalHandle } from "../../../shared/types.js";
import { isPreview, hostBridge, type Bridge } from "../bridge.js";
import { messageOf } from "../lib/results.js";
import { PANEL_VERSION } from "../lib/version.js";
import { previewBridge } from "../preview.js";

/** How the host is showing the panel right now. */
export type DisplayMode = "inline" | "fullscreen" | "pip";

/** The openers send a handle, the panel's own calls send full state. Accept either. */
type OpeningPayload = Partial<ProposalHandle> & Partial<EditorState>;

/** What the host has said about this panel, and how to reach it. */
export interface HostSession {
  bridge: Bridge | null;
  /** True once tools can be called: the handshake landed, or there is no host to shake with. */
  ready: boolean;
  /** The host connection failed; nothing else will work. */
  hostError: Error | null;
  /** The path the opening tool was called with, from the arguments the host hands over. */
  openedPath: string | undefined;
  /** What the opening tool sent: enough to name the file while waiting. */
  handle: ProposalHandle | null;
  /** Set once, by the host, when the call this panel belongs to is cancelled. */
  cancelled: boolean;
  displayMode: DisplayMode;
  /** Whether asking for fullscreen is worth offering at all. */
  canFullscreen: boolean;
  /** Ask the host to grow or shrink. It decides; the result is what it did. */
  toggleFullscreen: () => void;
}

/**
 * Connects to the host and reports what it says about this panel.
 *
 * Everything the host pushes — the arguments the panel was opened with, the
 * opening tool's result, a cancellation, a change of display mode — lands
 * here, so the session hook only has to decide what to do about it.
 *
 * @param onState - Called with a full editor state whenever a tool result carries one.
 * @param onFailure - Where to report a request the host refused.
 * @returns The connection and everything the host has said so far.
 */
export function useHost(
  onState: (state: EditorState) => void,
  onFailure: (message: string) => void,
): HostSession {
  const [openedPath, setOpenedPath] = useState<string | undefined>(undefined);
  const [handle, setHandle] = useState<ProposalHandle | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [displayMode, setDisplayMode] = useState<DisplayMode>("inline");
  const [availableModes, setAvailableModes] = useState<string[]>([]);

  const { app, isConnected, error } = useApp({
    appInfo: { name: "interactive-editor", version: PANEL_VERSION },
    // Declaring these is what makes fullscreen offerable at all: a host will not
    // grow a panel that never said it could handle being grown.
    capabilities: { availableDisplayModes: ["inline", "fullscreen"] },
    onAppCreated: (instance) => {
      const readContext = () => {
        const ctx = instance.getHostContext();
        if (ctx?.displayMode) setDisplayMode(ctx.displayMode);
        setAvailableModes(ctx?.availableDisplayModes ?? []);
      };

      /*
       * addEventListener rather than the `on*` setters, which the SDK marks
       * deprecated. The setters are also a single slot: any other assignment
       * silently replaces the handler already installed.
       */
      instance.addEventListener("hostcontextchanged", readContext);

      // Arguments arrive before any result does, and under --block-on-review the
      // result does not arrive until the human has decided. The path is how this
      // panel finds the proposal it exists for.
      instance.addEventListener("toolinput", (params) => {
        const path = (params.arguments as { path?: unknown } | undefined)?.path;
        if (typeof path === "string") setOpenedPath(path);
      });

      instance.addEventListener("toolresult", (params) => {
        const payload = params.structuredContent as unknown as OpeningPayload | undefined;
        if (!payload) return;
        if (payload.proposal) onState(payload as EditorState);
        else if (payload.proposalId) setHandle(payload as ProposalHandle);
      });

      // A stopped agent leaves the panel offering an editor for a call nobody is
      // waiting on, and a commit through it would land with no conversation to
      // report back to.
      instance.addEventListener("toolcancelled", () => setCancelled(true));
    },
  });

  useHostStyleVariables(app);

  // The context is only populated once the handshake lands, so read it again
  // when the connection settles rather than only when it changes.
  useEffect(() => {
    if (!app || !isConnected) return;
    const ctx = app.getHostContext();
    if (ctx?.displayMode) setDisplayMode(ctx.displayMode);
    setAvailableModes(ctx?.availableDisplayModes ?? []);
  }, [app, isConnected]);

  const toggleFullscreen = useCallback(() => {
    if (!app) return;
    const next = displayMode === "fullscreen" ? "inline" : "fullscreen";
    void app
      .requestDisplayMode({ mode: next })
      // The host decides. Believe its answer, not the request.
      .then((result) => setDisplayMode(result.mode))
      .catch((cause: unknown) => onFailure(messageOf(cause)));
  }, [app, displayMode, onFailure]);

  const bridge: Bridge | null = useMemo(() => {
    if (isPreview()) return previewBridge();
    return app ? hostBridge(app) : null;
  }, [app]);

  return {
    bridge,
    ready: isPreview() || isConnected,
    hostError: error,
    openedPath,
    handle,
    cancelled,
    displayMode,
    canFullscreen: availableModes.includes("fullscreen"),
    toggleFullscreen,
  };
}
