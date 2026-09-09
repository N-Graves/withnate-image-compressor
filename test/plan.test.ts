import { describe, expect, it } from "vitest";
import {
  MAX_MEGAPIXELS,
  MAX_STEP_FACTOR,
  clampLongEdge,
  clampQuality,
  downscaleSteps,
  isBigger,
  isTooLarge,
  megapixels,
  mimeFor,
  needsMatte,
  planResize,
  qualityApplies,
  resolveFormat,
  savingsPercent,
  suggestedName,
  supportsAlpha,
  verdictFor,
  type Size,
} from "../src/plan.js";

const size = (width: number, height: number): Size => ({ width, height });

describe("planResize", () => {
  it("never upscales, whatever the long edge asks for", () => {
    expect(planResize(size(800, 600), 4000)).toEqual(size(800, 600));
    expect(planResize(size(800, 600), 800)).toEqual(size(800, 600));
  });

  it("leaves the image alone when no long edge is set", () => {
    expect(planResize(size(4000, 3000), null)).toEqual(size(4000, 3000));
  });

  it("scales the LONG edge to the target, whichever side that is", () => {
    expect(planResize(size(4000, 3000), 2000)).toEqual(size(2000, 1500));
    expect(planResize(size(3000, 4000), 2000)).toEqual(size(1500, 2000));
  });

  it("holds the aspect ratio to within a pixel of rounding", () => {
    const source = size(4032, 3024);
    const out = planResize(source, 1000);
    const before = source.width / source.height;
    const after = out.width / out.height;
    expect(Math.abs(before - after)).toBeLessThan(0.005);
  });

  it("never produces a zero dimension on an extreme aspect ratio", () => {
    const out = planResize(size(10000, 3), 100);
    expect(out.width).toBe(100);
    expect(out.height).toBeGreaterThanOrEqual(1);
  });
});

describe("downscaleSteps", () => {
  it("returns nothing when the target is the source", () => {
    expect(downscaleSteps(size(800, 600), size(800, 600))).toEqual([]);
  });

  it("goes straight there when the step is within one halving", () => {
    expect(downscaleSteps(size(1000, 800), size(700, 560))).toEqual([size(700, 560)]);
  });

  it("never asks the canvas for more than a 2x reduction in one step", () => {
    const source = size(6000, 4000);
    const target = size(400, 267);
    const steps = downscaleSteps(source, target);
    let previous = source;
    for (const step of steps) {
      expect(previous.width / step.width).toBeLessThanOrEqual(MAX_STEP_FACTOR + 1e-9);
      expect(previous.height / step.height).toBeLessThanOrEqual(MAX_STEP_FACTOR + 1e-9);
      previous = step;
    }
  });

  it("lands exactly on the target, never near it", () => {
    for (const [sw, sh, tw, th] of [
      [6000, 4000, 400, 267],
      [4032, 3024, 1200, 900],
      [8000, 8000, 63, 63],
      [1920, 1080, 1919, 1079],
    ]) {
      const steps = downscaleSteps(size(sw, sh), size(tw, th));
      expect(steps.at(-1)).toEqual(size(tw, th));
    }
  });

  it("shrinks monotonically and terminates", () => {
    const steps = downscaleSteps(size(20000, 20000), size(1, 1));
    expect(steps.length).toBeLessThan(30);
    let previous = { width: 20000, height: 20000 };
    for (const step of steps) {
      expect(step.width).toBeLessThanOrEqual(previous.width);
      expect(step.height).toBeLessThanOrEqual(previous.height);
      previous = step;
    }
    expect(steps.at(-1)).toEqual(size(1, 1));
  });
});

describe("the megapixel ceiling", () => {
  it("measures megapixels the way a camera would", () => {
    expect(megapixels(size(4000, 3000))).toBe(12);
  });

  it("refuses only past the stated ceiling", () => {
    expect(isTooLarge(size(10000, 8000))).toBe(false);
    expect(isTooLarge(size(1000, 1000))).toBe(false);
    expect(isTooLarge(size(30000, 30000))).toBe(true);
  });

  it("lets a real 61MP camera file through", () => {
    expect(megapixels(size(9504, 6336))).toBeLessThan(MAX_MEGAPIXELS);
    expect(isTooLarge(size(9504, 6336))).toBe(false);
  });
});

describe("format rules", () => {
  it("keeps a lossless source lossless rather than defaulting to JPEG", () => {
    expect(resolveFormat("keep", "png")).toBe("png");
    expect(resolveFormat("keep", "webp")).toBe("webp");
  });

  it("falls back to JPEG for a photo or an unknown source", () => {
    expect(resolveFormat("keep", "jpeg")).toBe("jpeg");
    expect(resolveFormat("keep", "gif")).toBe("jpeg");
    expect(resolveFormat("keep", null)).toBe("jpeg");
  });

  it("honours an explicit choice over the source", () => {
    expect(resolveFormat("webp", "png")).toBe("webp");
    expect(resolveFormat("png", "jpeg")).toBe("png");
  });

  it("knows JPEG is the one that cannot hold transparency", () => {
    expect(supportsAlpha("jpeg")).toBe(false);
    expect(supportsAlpha("png")).toBe(true);
    expect(supportsAlpha("webp")).toBe(true);
  });

  it("knows PNG ignores the quality slider entirely", () => {
    expect(qualityApplies("png")).toBe(false);
    expect(qualityApplies("jpeg")).toBe(true);
    expect(qualityApplies("webp")).toBe(true);
  });

  it("mattes only when transparency would otherwise turn black", () => {
    expect(needsMatte("jpeg", true)).toBe(true);
    expect(needsMatte("jpeg", false)).toBe(false);
    expect(needsMatte("png", true)).toBe(false);
    expect(needsMatte("webp", true)).toBe(false);
  });

  it("emits the mime types canvas actually expects", () => {
    expect(mimeFor("jpeg")).toBe("image/jpeg");
    expect(mimeFor("webp")).toBe("image/webp");
    expect(mimeFor("png")).toBe("image/png");
  });
});

describe("suggestedName", () => {
  it("replaces the extension rather than appending one", () => {
    expect(suggestedName("holiday.JPEG", "webp")).toBe("holiday-compressed.webp");
    expect(suggestedName("cat.png", "jpeg")).toBe("cat-compressed.jpg");
  });

  it("keeps dots that are part of the name", () => {
    expect(suggestedName("shoot.v2.final.png", "png")).toBe("shoot.v2.final-compressed.png");
  });

  it("copes with no extension and with a dotfile", () => {
    expect(suggestedName("scan", "jpeg")).toBe("scan-compressed.jpg");
    expect(suggestedName(".hidden", "png")).toBe(".hidden-compressed.png");
  });

  it("falls back rather than producing a nameless download", () => {
    expect(suggestedName("", "jpeg")).toBe("image-compressed.jpg");
    expect(suggestedName("   ", "jpeg")).toBe("image-compressed.jpg");
  });
});

describe("savings", () => {
  it("reports the real percentage", () => {
    expect(savingsPercent(1000, 250)).toBe(75);
    expect(savingsPercent(1000, 1000)).toBe(0);
  });

  it("goes negative when the result grew, rather than clamping to zero", () => {
    expect(savingsPercent(1000, 1500)).toBe(-50);
  });

  it("refuses to divide by a nonsense original", () => {
    expect(savingsPercent(0, 100)).toBe(0);
    expect(savingsPercent(-5, 100)).toBe(0);
    expect(savingsPercent(NaN, 100)).toBe(0);
  });

  it("detects growth exactly at the boundary", () => {
    expect(isBigger(1000, 1001)).toBe(true);
    expect(isBigger(1000, 1000)).toBe(false);
  });
});

describe("verdictFor - the honest 'it came out bigger' case", () => {
  it("says so plainly rather than reporting a negative saving", () => {
    const v = verdictFor(500_000, 650_000, "jpeg", "jpeg");
    expect(v.kind).toBe("bigger");
    expect(v.headline).toMatch(/bigger/);
  });

  it("tells you to keep the original when re-encoding its own format inflated it", () => {
    const v = verdictFor(500_000, 650_000, "jpeg", "jpeg");
    expect(v.advice).toMatch(/[Kk]eep it/);
  });

  it("suggests a real lever instead when the format changed", () => {
    const v = verdictFor(500_000, 650_000, "png", "jpeg");
    expect(v.advice).toMatch(/quality|long edge|original format/);
  });

  it("does not claim a win for a rounding-level difference", () => {
    const v = verdictFor(1_000_000, 999_000, "jpeg", "jpeg");
    expect(v.kind).toBe("same");
    expect(v.headline).not.toMatch(/smaller/);
  });

  it("reports a genuine win as a plain percentage", () => {
    const v = verdictFor(4_000_000, 1_000_000, "webp", "jpeg");
    expect(v.kind).toBe("smaller");
    expect(v.headline).toBe("75% smaller.");
    expect(v.advice).toBeNull();
  });
});

describe("clamping", () => {
  it("keeps quality inside the range the encoders respect", () => {
    expect(clampQuality(0.82)).toBe(0.82);
    expect(clampQuality(5)).toBe(1);
    expect(clampQuality(0)).toBe(0.3);
    expect(clampQuality(NaN)).toBe(0.8);
  });

  it("keeps the long edge a sane positive integer", () => {
    expect(clampLongEdge(1920.4)).toBe(1920);
    expect(clampLongEdge(0)).toBe(1);
    expect(clampLongEdge(-50)).toBe(1);
    expect(clampLongEdge(999999)).toBe(20000);
  });
});
