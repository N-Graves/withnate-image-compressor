import {
  attachIntake,
  formatBytes,
  h,
  measureImage,
  mount,
  readHeaderBytes,
} from "@nasdigitaluk/withnate-tool-core";
import { decode, drawResized, encodeFrom, sampleHasAlpha, supportsFormat } from "./encode.js";
import {
  LONG_EDGE_PRESETS,
  MAX_MEGAPIXELS,
  clampQuality,
  isTooLarge,
  megapixels,
  planResize,
  qualityApplies,
  resolveFormat,
  suggestedName,
  verdictFor,
  type Size,
  type TargetFormat,
} from "./plan.js";

interface Loaded {
  file: File;
  bitmap: ImageBitmap;
  sourceFormat: string | null;
}

interface Resized {
  key: string;
  canvas: HTMLCanvasElement;
  hadAlpha: boolean;
  size: Size;
}

const el = <T extends HTMLElement>(root: HTMLElement, sel: string): T | null =>
  root.querySelector<T>(sel);

const sizeKey = (size: Size): string => `${size.width}x${size.height}`;

mount("[data-ic]", ({ root }) => {
  const drop = el<HTMLElement>(root, "[data-ic-drop]");
  if (!drop) return;

  const statusOut = el<HTMLElement>(root, "[data-ic-status]");
  const resultOut = el<HTMLElement>(root, "[data-ic-result]");
  const controls = el<HTMLElement>(root, "[data-ic-controls]");
  const previewOut = el<HTMLImageElement>(root, "[data-ic-preview]");
  const formatSel = el<HTMLSelectElement>(root, "[data-ic-format]");
  const longEdgeSel = el<HTMLSelectElement>(root, "[data-ic-longedge]");
  const qualityInput = el<HTMLInputElement>(root, "[data-ic-quality]");
  const qualityLabel = el<HTMLElement>(root, "[data-ic-quality-label]");
  const downloadBtn = el<HTMLAnchorElement>(root, "[data-ic-download]");
  const resetBtn = el<HTMLButtonElement>(root, "[data-ic-reset]");

  let loaded: Loaded | null = null;
  let resized: Resized | null = null;
  let objectUrl: string | null = null;
  let request = 0;
  let debounce = 0;

  const setStatus = (text: string, kind: "info" | "error" | "" = ""): void => {
    if (!statusOut) return;
    statusOut.textContent = text;
    statusOut.className = kind ? `ic-status is-${kind}` : "ic-status";
    statusOut.hidden = text.length === 0;
  };

  const releaseUrl = (): void => {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  };

  const showControls = (on: boolean): void => {
    if (controls) controls.hidden = !on;
    if (resetBtn) resetBtn.hidden = !on;
    if (!on && resultOut) resultOut.replaceChildren();
    if (!on && previewOut) {
      previewOut.removeAttribute("src");
      previewOut.hidden = true;
    }
    if (!on && downloadBtn) downloadBtn.hidden = true;
  };

  const currentFormat = (): TargetFormat =>
    resolveFormat(
      (formatSel?.value ?? "keep") as TargetFormat | "keep",
      loaded?.sourceFormat ?? null,
    );

  const currentLongEdge = (): number | null => {
    const raw = longEdgeSel?.value ?? "";
    return raw === "" ? null : Number(raw);
  };

  const currentQuality = (): number => clampQuality(Number(qualityInput?.value ?? 80) / 100);

  const syncQualityLabel = (): void => {
    const format = currentFormat();
    const applies = qualityApplies(format);
    if (qualityInput) qualityInput.disabled = !applies;
    if (qualityLabel) {
      qualityLabel.textContent = applies
        ? `Quality ${Math.round(currentQuality() * 100)}`
        : "PNG is lossless, so quality does not apply";
    }
  };

  const renderResult = (blob: Blob, target: Size, format: TargetFormat, matted: boolean): void => {
    if (!loaded || !resultOut) return;
    const verdict = verdictFor(loaded.file.size, blob.size, format, loaded.sourceFormat);

    resultOut.replaceChildren(
      h(
        "div",
        { class: `ic-verdict is-${verdict.kind}` },
        h("p", { class: "ic-headline" }, verdict.headline),
        h(
          "p",
          { class: "ic-sizes" },
          `${formatBytes(loaded.file.size)} → ${formatBytes(blob.size)} · ${target.width} × ${target.height} · ${format.toUpperCase()}`,
        ),
        ...(verdict.advice ? [h("p", { class: "ic-advice" }, verdict.advice)] : []),
      ),
      ...(matted
        ? [
            h(
              "p",
              { class: "ic-note" },
              "This image had transparency and JPEG cannot store it, so it was flattened onto white. Choose PNG or WebP to keep it.",
            ),
          ]
        : []),
      h(
        "p",
        { class: "ic-note" },
        "Re-encoding drops every embedded tag, so the download carries no EXIF, no camera model and no GPS. The colour profile goes with it, so wide-gamut images come back as sRGB.",
      ),
    );

    releaseUrl();
    objectUrl = URL.createObjectURL(blob);
    if (previewOut) {
      previewOut.src = objectUrl;
      previewOut.hidden = false;
    }
    if (downloadBtn) {
      downloadBtn.href = objectUrl;
      downloadBtn.download = suggestedName(loaded.file.name, format);
      downloadBtn.hidden = false;
      downloadBtn.textContent = `Download ${formatBytes(blob.size)}`;
    }
  };

  const recompute = async (): Promise<void> => {
    if (!loaded) return;
    const ticket = ++request;
    const format = currentFormat();
    const quality = currentQuality();
    const target = planResize(
      { width: loaded.bitmap.width, height: loaded.bitmap.height },
      currentLongEdge(),
    );

    syncQualityLabel();
    setStatus("Working…", "info");

    try {
      const key = sizeKey(target);
      if (!resized || resized.key !== key) {
        const canvas = drawResized(loaded.bitmap, target);
        if (ticket !== request) return;
        resized = { key, canvas, hadAlpha: sampleHasAlpha(canvas), size: target };
      }

      const { blob, matted } = await encodeFrom(
        resized.canvas,
        resized.hadAlpha,
        format,
        quality,
      );
      if (ticket !== request) return;

      setStatus("");
      renderResult(blob, target, format, matted);
    } catch (err) {
      if (ticket !== request) return;
      setStatus(err instanceof Error ? err.message : "That image could not be processed.", "error");
    }
  };

  const scheduleRecompute = (): void => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(() => void recompute(), 140);
  };

  const load = async (file: File): Promise<void> => {
    const ticket = ++request;
    setStatus("Reading…", "info");
    resized = null;

    try {
      const header = await readHeaderBytes(file);
      const measured = measureImage(header);

      if (measured && isTooLarge(measured)) {
        setStatus(
          `That image is ${Math.round(megapixels(measured))} megapixels (${measured.width} × ${measured.height}). The limit here is ${MAX_MEGAPIXELS}, because decoding it would use more memory than a browser tab can spare.`,
          "error",
        );
        showControls(false);
        loaded = null;
        return;
      }

      const bitmap = await decode(file);
      if (ticket !== request) {
        bitmap.close();
        return;
      }

      loaded?.bitmap.close();
      loaded = { file, bitmap, sourceFormat: measured?.format ?? null };
      showControls(true);
      await recompute();
    } catch {
      if (ticket !== request) return;
      setStatus("That file could not be read as an image this browser understands.", "error");
      showControls(false);
      loaded = null;
    }
  };

  attachIntake(drop, {
    onFile: (file) => void load(file),
    onReject: (reason) => setStatus(reason, "error"),
    draggingClass: "is-dragging",
  });

  formatSel?.addEventListener("change", () => {
    syncQualityLabel();
    void recompute();
  });
  longEdgeSel?.addEventListener("change", () => void recompute());
  qualityInput?.addEventListener("input", () => {
    syncQualityLabel();
    scheduleRecompute();
  });

  resetBtn?.addEventListener("click", () => {
    request += 1;
    loaded?.bitmap.close();
    loaded = null;
    resized = null;
    releaseUrl();
    showControls(false);
    setStatus("");
  });

  if (longEdgeSel && longEdgeSel.options.length === 0) {
    longEdgeSel.replaceChildren(
      ...LONG_EDGE_PRESETS.map((preset) =>
        h("option", { value: preset.value === null ? "" : String(preset.value) }, preset.label),
      ),
    );
  }

  showControls(false);
  syncQualityLabel();

  void (async () => {
    if (!(await supportsFormat("webp")) && formatSel) {
      const option = formatSel.querySelector<HTMLOptionElement>('option[value="webp"]');
      if (option) {
        option.disabled = true;
        option.textContent = "WebP (not supported by this browser)";
      }
    }
  })();
});
