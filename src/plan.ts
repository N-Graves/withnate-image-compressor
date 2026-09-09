export type TargetFormat = "jpeg" | "webp" | "png";

export interface Size {
  width: number;
  height: number;
}

export const MAX_MEGAPIXELS = 80;
export const MAX_STEP_FACTOR = 2;

export const megapixels = (size: Size): number => (size.width * size.height) / 1e6;

export const isTooLarge = (size: Size): boolean => megapixels(size) > MAX_MEGAPIXELS;

export const clampLongEdge = (value: number): number =>
  Math.max(1, Math.min(20000, Math.round(value)));

export const planResize = (source: Size, longEdge: number | null): Size => {
  const sourceLong = Math.max(source.width, source.height);
  if (longEdge === null || longEdge >= sourceLong) {
    return { width: source.width, height: source.height };
  }
  const target = clampLongEdge(longEdge);
  const scale = target / sourceLong;
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
};

export const downscaleSteps = (source: Size, target: Size): Size[] => {
  const steps: Size[] = [];
  let current = source;

  while (
    current.width > target.width * MAX_STEP_FACTOR ||
    current.height > target.height * MAX_STEP_FACTOR
  ) {
    current = {
      width: Math.max(target.width, Math.round(current.width / MAX_STEP_FACTOR)),
      height: Math.max(target.height, Math.round(current.height / MAX_STEP_FACTOR)),
    };
    steps.push(current);
  }

  if (current.width !== target.width || current.height !== target.height) {
    steps.push({ width: target.width, height: target.height });
  }
  return steps;
};

const MIME: Record<TargetFormat, string> = {
  jpeg: "image/jpeg",
  webp: "image/webp",
  png: "image/png",
};

const EXTENSION: Record<TargetFormat, string> = {
  jpeg: "jpg",
  webp: "webp",
  png: "png",
};

export const mimeFor = (format: TargetFormat): string => MIME[format];

export const supportsAlpha = (format: TargetFormat): boolean => format !== "jpeg";

export const qualityApplies = (format: TargetFormat): boolean => format !== "png";

export const needsMatte = (format: TargetFormat, sourceHasAlpha: boolean): boolean =>
  sourceHasAlpha && !supportsAlpha(format);

export const resolveFormat = (
  requested: TargetFormat | "keep",
  sourceFormat: string | null,
): TargetFormat => {
  if (requested !== "keep") return requested;
  if (sourceFormat === "png") return "png";
  if (sourceFormat === "webp") return "webp";
  return "jpeg";
};

export const suggestedName = (original: string, format: TargetFormat): string => {
  const trimmed = original.trim() || "image";
  const dot = trimmed.lastIndexOf(".");
  const stem = dot > 0 ? trimmed.slice(0, dot) : trimmed;
  return `${stem}-compressed.${EXTENSION[format]}`;
};

export const savingsPercent = (originalBytes: number, resultBytes: number): number => {
  if (!Number.isFinite(originalBytes) || originalBytes <= 0) return 0;
  if (!Number.isFinite(resultBytes) || resultBytes < 0) return 0;
  return ((originalBytes - resultBytes) / originalBytes) * 100;
};

export const isBigger = (originalBytes: number, resultBytes: number): boolean =>
  resultBytes > originalBytes;

export interface Verdict {
  kind: "smaller" | "bigger" | "same";
  percent: number;
  headline: string;
  advice: string | null;
}

export const verdictFor = (
  originalBytes: number,
  resultBytes: number,
  format: TargetFormat,
  sourceFormat: string | null,
): Verdict => {
  const percent = savingsPercent(originalBytes, resultBytes);

  if (isBigger(originalBytes, resultBytes)) {
    const rounded = Math.abs(percent) < 0.5 ? "slightly" : `${Math.round(Math.abs(percent))}% `;
    const sameFormat = sourceFormat === format || (sourceFormat === "jpeg" && format === "jpeg");
    return {
      kind: "bigger",
      percent,
      headline: `This came out ${rounded}bigger than the original.`,
      advice: sameFormat
        ? "The original is already well compressed. Keep it - re-encoding an efficient file adds bytes rather than removing them."
        : "Try a lower quality, a smaller long edge, or keep the original format.",
    };
  }

  if (percent < 0.5) {
    return {
      kind: "same",
      percent,
      headline: "This came out about the same size as the original.",
      advice: "There is little left to remove. Keep the original unless you need the new format.",
    };
  }

  return {
    kind: "smaller",
    percent,
    headline: `${Math.round(percent)}% smaller.`,
    advice: null,
  };
};

export const clampQuality = (value: number): number => {
  if (!Number.isFinite(value)) return 0.8;
  return Math.min(1, Math.max(0.3, Math.round(value * 100) / 100));
};

export const LONG_EDGE_PRESETS: ReadonlyArray<{ label: string; value: number | null }> = [
  { label: "Original size", value: null },
  { label: "2560 px", value: 2560 },
  { label: "1920 px", value: 1920 },
  { label: "1200 px", value: 1200 },
  { label: "800 px", value: 800 },
];
