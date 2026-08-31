import { describe, expect, it } from "vitest";
import { ANCHOR_GAP, placePopover } from "../../ui/src/lib/anchor.js";

const VIEWPORT = { width: 800, height: 600 };
const BOX = { width: 320, height: 120 };

describe("placePopover", () => {
  it("sits above the selection, clear of it", () => {
    const at = placePopover({ top: 300, bottom: 340, left: 100 }, BOX, VIEWPORT);

    expect(at.placement).toBe("above");
    expect(at.top).toBe(300 - BOX.height - ANCHOR_GAP);
    expect(at.top + BOX.height, "must not overlap the passage").toBeLessThanOrEqual(300);
    expect(at.left).toBe(100);
  });

  it("flips below when the selection is near the top", () => {
    const at = placePopover({ top: 10, bottom: 40, left: 100 }, BOX, VIEWPORT);

    expect(at.placement).toBe("below");
    expect(at.top, "must clear the passage").toBeGreaterThanOrEqual(40);
  });

  it("never runs off the right edge", () => {
    const at = placePopover({ top: 300, bottom: 320, left: 780 }, BOX, VIEWPORT);
    expect(at.left + BOX.width).toBeLessThanOrEqual(VIEWPORT.width);
  });

  it("keeps a gap at the left edge rather than touching it", () => {
    // A box flush against the edge reads as clipped, and the button inside it
    // lands under the panel border. Asserting only that it is not negative is
    // satisfied by exactly the placement being guarded against.
    const at = placePopover({ top: 300, bottom: 320, left: -50 }, BOX, VIEWPORT);

    expect(at.left).toBe(ANCHOR_GAP);
  });

  it("stays on screen when flipped below near the bottom", () => {
    const at = placePopover({ top: 20, bottom: 580, left: 100 }, BOX, VIEWPORT);
    expect(at.top + BOX.height).toBeLessThanOrEqual(VIEWPORT.height);
  });

  it("keeps a box wider than the viewport at the left gap rather than negative", () => {
    const at = placePopover(
      { top: 300, bottom: 320, left: 400 },
      { width: 900, height: 80 },
      VIEWPORT,
    );
    expect(at.left).toBe(ANCHOR_GAP);
  });
});
