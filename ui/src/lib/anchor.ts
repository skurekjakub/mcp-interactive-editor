/**
 * Where to put a floating box relative to a selection.
 *
 * Above it by preference: the whole point of commenting on a passage is to be
 * looking at the passage, and a box that covers the lines you are talking about
 * is worse than no box. It flips below only when there is genuinely no room, and
 * it never leaves the viewport — a popover you have to scroll to find is the
 * same as one that did not open.
 */

export interface SelectionAnchor {
  /** Viewport coordinates of the selection's bounding box. */
  top: number;
  bottom: number;
  left: number;
}

export interface Box {
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface Placement {
  top: number;
  left: number;
  placement: "above" | "below";
}

export const ANCHOR_GAP = 8;

export function placePopover(
  anchor: SelectionAnchor,
  box: Box,
  viewport: Viewport,
  gap: number = ANCHOR_GAP,
): Placement {
  const left = clamp(anchor.left, gap, Math.max(gap, viewport.width - box.width - gap));

  const above = anchor.top - box.height - gap;
  if (above >= gap) return { top: above, left, placement: "above" };

  // No room overhead. Below the selection still leaves the passage visible;
  // clamped so it cannot hang off the bottom either.
  const below = Math.min(anchor.bottom + gap, Math.max(gap, viewport.height - box.height - gap));
  return { top: below, left, placement: "below" };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
