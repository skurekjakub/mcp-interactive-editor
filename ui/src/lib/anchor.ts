/**
 * @module
 *
 * Placement for a floating box relative to a selection.
 *
 * Above the selection by preference: the point of commenting on a passage is to
 * be looking at the passage, and a box covering the lines under discussion is
 * worse than no box. It flips below only when there is no room overhead.
 */

/** Viewport coordinates of the selection a box is placed against. */
export interface SelectionAnchor {
  top: number;
  bottom: number;
  left: number;
}

/** The size of the box being placed. */
export interface Box {
  width: number;
  height: number;
}

/** The visible area the box has to stay inside. */
export interface Viewport {
  width: number;
  height: number;
}

/** Where a box ended up, and which side of the selection it landed on. */
export interface Placement {
  top: number;
  left: number;
  width: number;
  placement: "above" | "below";
}

/** Distance kept between the box and both the selection and the viewport edge. */
export const ANCHOR_GAP = 8;

/**
 * Narrows a box so it fits the viewport with a gap on both sides.
 *
 * A fixed width wider than the panel cannot be clamped into view by moving it:
 * whatever the left edge, the right edge hangs off and the button under it
 * cannot be reached. The width has to shrink instead.
 *
 * @param preferred - The width the box would like.
 * @param viewport - The visible area.
 * @param gap - Margin to keep at each edge.
 * @returns A width that fits.
 */
export function fitWidth(preferred: number, viewport: Viewport, gap: number = ANCHOR_GAP): number {
  return Math.max(120, Math.min(preferred, viewport.width - gap * 2));
}

/**
 * Places a popover against a selection.
 *
 * @param anchor - Where the selection sits in the viewport.
 * @param box - The size of the popover, whose width is narrowed to fit.
 * @param viewport - The visible area.
 * @param gap - Margin to keep from the selection and the viewport edges.
 * @returns The position, the width to render at, and which side it took.
 */
export function placePopover(
  anchor: SelectionAnchor,
  box: Box,
  viewport: Viewport,
  gap: number = ANCHOR_GAP,
): Placement {
  const width = fitWidth(box.width, viewport, gap);
  const left = clamp(anchor.left, gap, Math.max(gap, viewport.width - width - gap));

  const above = anchor.top - box.height - gap;
  if (above >= gap) return { top: above, left, width, placement: "above" };

  // No room overhead. Below the selection still leaves the passage visible,
  // clamped so it cannot hang off the bottom either.
  const below = Math.min(anchor.bottom + gap, Math.max(gap, viewport.height - box.height - gap));
  return { top: below, left, width, placement: "below" };
}

/**
 * Constrains a value to a range.
 *
 * @param value - The number to constrain.
 * @param low - Lower bound.
 * @param high - Upper bound.
 * @returns The value, clamped.
 */
function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
