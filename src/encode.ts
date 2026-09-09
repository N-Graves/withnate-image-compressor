import { downscaleSteps, mimeFor, needsMatte, type Size, type TargetFormat } from "./plan.js";

export const MATTE = "#ffffff";
const ALPHA_SAMPLE_STRIDE = 97;

export const decode = async (file: File): Promise<ImageBitmap> =>
  createImageBitmap(file, { imageOrientation: "from-image" });

const makeCanvas = (size: Size): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  return canvas;
};

const context2d = (canvas: HTMLCanvasElement): CanvasRenderingContext2D => {
  const ctx = canvas.getContext("2d", { willReadFrequently: false });
  if (!ctx) throw new Error("This browser would not give us a 2D canvas to draw on.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return ctx;
};

export const sampleHasAlpha = (canvas: HTMLCanvasElement): boolean => {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 3; i < data.length; i += 4 * ALPHA_SAMPLE_STRIDE) {
    if ((data[i] as number) < 255) return true;
  }
  for (let i = data.length - 1; i >= 3 && i > data.length - 4 * 512; i -= 4) {
    if ((data[i] as number) < 255) return true;
  }
  return false;
};

export const drawResized = (source: ImageBitmap, target: Size): HTMLCanvasElement => {
  const steps = downscaleSteps({ width: source.width, height: source.height }, target);

  let canvas = makeCanvas(steps[0] ?? target);
  context2d(canvas).drawImage(source, 0, 0, canvas.width, canvas.height);

  for (const step of steps.slice(1)) {
    const next = makeCanvas(step);
    context2d(next).drawImage(canvas, 0, 0, next.width, next.height);
    canvas = next;
  }
  return canvas;
};

export const flattenOnto = (canvas: HTMLCanvasElement, colour: string): HTMLCanvasElement => {
  const matted = makeCanvas({ width: canvas.width, height: canvas.height });
  const ctx = context2d(matted);
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, matted.width, matted.height);
  ctx.drawImage(canvas, 0, 0);
  return matted;
};

export const toBlob = (
  canvas: HTMLCanvasElement,
  format: TargetFormat,
  quality: number,
): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error(`This browser could not encode a ${format.toUpperCase()}.`));
      },
      mimeFor(format),
      quality,
    );
  });

export const encodeFrom = async (
  resized: HTMLCanvasElement,
  hadAlpha: boolean,
  format: TargetFormat,
  quality: number,
): Promise<{ blob: Blob; matted: boolean }> => {
  const matted = needsMatte(format, hadAlpha);
  const canvas = matted ? flattenOnto(resized, MATTE) : resized;
  return { blob: await toBlob(canvas, format, quality), matted };
};

export const supportsFormat = async (format: TargetFormat): Promise<boolean> => {
  const probe = document.createElement("canvas");
  probe.width = 1;
  probe.height = 1;
  try {
    const blob = await toBlob(probe, format, 0.8);
    return blob.type === mimeFor(format);
  } catch {
    return false;
  }
};
