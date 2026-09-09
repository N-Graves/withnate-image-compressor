/*! withnate-image-compressor v0.1.0 - MIT
 * https://github.com/N-Graves/withnate-image-compressor#readme
 * Runs entirely in the browser. No network requests, no storage.
 */
"use strict";
(() => {
  // node_modules/@nasdigitaluk/withnate-tool-core/dist/bytes.js
  var u8 = (b, i) => {
    const v = b[i];
    if (v === void 0)
      throw new RangeError(`byte ${i} is past the end of the buffer`);
    return v;
  };
  var be16 = (b, i) => u8(b, i) << 8 | u8(b, i + 1);
  var le16 = (b, i) => u8(b, i) | u8(b, i + 1) << 8;
  var le24 = (b, i) => u8(b, i) | u8(b, i + 1) << 8 | u8(b, i + 2) << 16;
  var be32 = (b, i) => (u8(b, i) << 24 | u8(b, i + 1) << 16 | u8(b, i + 2) << 8 | u8(b, i + 3)) >>> 0;
  var le32 = (b, i) => (u8(b, i) | u8(b, i + 1) << 8 | u8(b, i + 2) << 16 | u8(b, i + 3) << 24) >>> 0;
  var matchBytes = (b, sig, offset = 0) => {
    if (b.length < offset + sig.length)
      return false;
    for (let i = 0; i < sig.length; i += 1) {
      if (b[offset + i] !== sig[i])
        return false;
    }
    return true;
  };
  var matchAscii = (b, offset, s) => {
    if (b.length < offset + s.length)
      return false;
    for (let i = 0; i < s.length; i += 1) {
      if (b[offset + i] !== s.charCodeAt(i))
        return false;
    }
    return true;
  };

  // node_modules/@nasdigitaluk/withnate-tool-core/dist/sniff.js
  var PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  var JPEG_SIG = [255, 216, 255];
  var GIF87_SIG = [71, 73, 70, 56, 55, 97];
  var GIF89_SIG = [71, 73, 70, 56, 57, 97];
  var RIFF_SIG = [82, 73, 70, 70];
  var WEBP_SIG = [87, 69, 66, 80];
  var HEADER_BYTES = 64 * 1024;
  var sniffFormat = (bytes) => {
    if (matchBytes(bytes, PNG_SIG))
      return "png";
    if (matchBytes(bytes, JPEG_SIG))
      return "jpeg";
    if (matchBytes(bytes, GIF87_SIG) || matchBytes(bytes, GIF89_SIG))
      return "gif";
    if (matchBytes(bytes, RIFF_SIG) && matchBytes(bytes, WEBP_SIG, 8))
      return "webp";
    return null;
  };

  // node_modules/@nasdigitaluk/withnate-tool-core/dist/units.js
  var MM_PER_INCH = 25.4;
  var CM_PER_INCH = MM_PER_INCH / 10;
  var MM_PER_METRE = 1e3;
  var roundTo = (value, dp) => {
    const f = 10 ** dp;
    return Math.round(value * f) / f;
  };
  var formatBytes = (n) => {
    if (!Number.isFinite(n) || n < 0)
      return "\u2014";
    if (n < 1e3)
      return `${Math.round(n)} B`;
    const kb = Math.round(n / 1e3);
    if (kb < 1e3)
      return `${kb} KB`;
    return `${roundTo(n / 1e6, 1)} MB`;
  };

  // node_modules/@nasdigitaluk/withnate-tool-core/dist/exif.js
  var TYPE_SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];
  var MAX_ENTRIES = 4096;
  var MAX_COMPONENTS = 1024;
  var MAX_BLOCK_BYTES = 4 * 1024 * 1024;
  var key = (ifd, tag) => `${ifd}:${tag}`;
  var findTiffBlock = (bytes) => {
    const format = sniffFormat(bytes);
    if (format === "jpeg") {
      let p = 2;
      while (p + 4 <= bytes.length) {
        if (u8(bytes, p) !== 255) {
          p += 1;
          continue;
        }
        const marker = u8(bytes, p + 1);
        if (marker === 216 || marker >= 208 && marker <= 217 || marker === 1) {
          p += 2;
          continue;
        }
        const len = u8(bytes, p + 2) << 8 | u8(bytes, p + 3);
        if (len < 2)
          return null;
        if (marker === 225 && matchAscii(bytes, p + 4, "Exif\0\0")) {
          return bytes.subarray(p + 10, p + 2 + len);
        }
        if (marker === 218)
          return null;
        p = p + 2 + len;
      }
      return null;
    }
    if (format === "png") {
      let p = 8;
      while (p + 8 <= bytes.length) {
        const len = be32(bytes, p);
        if (matchAscii(bytes, p + 4, "eXIf"))
          return bytes.subarray(p + 8, p + 8 + len);
        if (matchAscii(bytes, p + 4, "IDAT") || matchAscii(bytes, p + 4, "IEND"))
          return null;
        p += 12 + len;
      }
      return null;
    }
    if (format === "webp") {
      let p = 12;
      while (p + 8 <= bytes.length) {
        const len = le32(bytes, p + 4);
        if (matchAscii(bytes, p, "EXIF")) {
          const start = matchAscii(bytes, p + 8, "Exif\0\0") ? p + 14 : p + 8;
          return bytes.subarray(start, p + 8 + len);
        }
        p += 8 + len + len % 2;
      }
      return null;
    }
    return null;
  };
  var reader = (b, little) => ({
    u16: (i) => little ? u8(b, i) | u8(b, i + 1) << 8 : u8(b, i) << 8 | u8(b, i + 1),
    u32: (i) => little ? le32(b, i) : be32(b, i),
    i32: (i) => (little ? le32(b, i) : be32(b, i)) | 0,
    byte: (i) => u8(b, i)
  });
  var TEXT = new TextDecoder("utf-8", { fatal: false });
  var decodeAscii = (block, offset, count) => {
    let end = offset;
    const limit = offset + count;
    while (end < limit && block[end] !== 0)
      end += 1;
    return TEXT.decode(block.subarray(offset, end)).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  };
  var readValue = (r, block, type, count, offset) => {
    if (type === 2)
      return decodeAscii(block, offset, count);
    const size = TYPE_SIZE[type];
    const one = (i) => {
      const at = offset + i * size;
      switch (type) {
        case 1:
        case 7:
          return r.byte(at);
        case 3:
          return r.u16(at);
        case 4:
          return r.u32(at);
        case 9:
          return r.i32(at);
        case 5:
          return { numerator: r.u32(at), denominator: r.u32(at + 4) };
        case 10:
          return { numerator: r.i32(at), denominator: r.i32(at + 4) };
        default:
          return 0;
      }
    };
    if (count === 1)
      return one(0);
    const out = [];
    for (let i = 0; i < count; i += 1)
      out.push(one(i));
    return out;
  };
  var IFD_EXIF_POINTER = 34665;
  var IFD_GPS_POINTER = 34853;
  var readIfd = (r, block, start, ifd, entries, seen, depth) => {
    if (depth > 4 || seen.has(start) || start + 2 > block.length)
      return 0;
    seen.add(start);
    const count = r.u16(start);
    let p = start + 2;
    for (let i = 0; i < count; i += 1, p += 12) {
      if (p + 12 > block.length || entries.length >= MAX_ENTRIES)
        break;
      const tag = r.u16(p);
      const type = r.u16(p + 2);
      const n = r.u32(p + 4);
      const size = TYPE_SIZE[type] ?? 0;
      if (size === 0 || n === 0)
        continue;
      const bytesNeeded = size * n;
      const valueAt = bytesNeeded <= 4 ? p + 8 : r.u32(p + 8);
      if (valueAt + bytesNeeded > block.length)
        continue;
      if (tag === IFD_EXIF_POINTER || tag === IFD_GPS_POINTER) {
        const target = bytesNeeded <= 4 ? r.u32(p + 8) : valueAt;
        readIfd(r, block, target, tag === IFD_EXIF_POINTER ? "exif" : "gps", entries, seen, depth + 1);
        continue;
      }
      if (type !== 2 && n > MAX_COMPONENTS)
        continue;
      try {
        entries.push({ tag, ifd, type, count: n, value: readValue(r, block, type, n, valueAt) });
      } catch {
        continue;
      }
    }
    return p + 4 <= block.length ? r.u32(p) : 0;
  };
  var parseExif = (bytes) => {
    try {
      const block = findTiffBlock(bytes);
      if (!block || block.length < 8 || block.length > MAX_BLOCK_BYTES)
        return null;
      const order = block[0] === 73 && block[1] === 73 ? "little" : block[0] === 77 && block[1] === 77 ? "big" : null;
      if (!order)
        return null;
      const r = reader(block, order === "little");
      if (r.u16(2) !== 42)
        return null;
      const entries = [];
      const seen = /* @__PURE__ */ new Set();
      const next = readIfd(r, block, r.u32(4), "image", entries, seen, 0);
      if (next > 0)
        readIfd(r, block, next, "thumbnail", entries, seen, 1);
      const byKey = /* @__PURE__ */ new Map();
      for (const e of entries)
        byKey.set(key(e.ifd, e.tag), e);
      return { byteOrder: order, entries, byKey };
    } catch {
      return null;
    }
  };
  var ratioValue = (v) => {
    if (typeof v === "number")
      return v;
    if (typeof v === "object" && v !== null && "numerator" in v) {
      return v.denominator === 0 ? null : v.numerator / v.denominator;
    }
    return null;
  };
  var exifNumber = (data, ifd, tag) => {
    const e = data.byKey.get(key(ifd, tag));
    return e ? ratioValue(e.value) : null;
  };
  var TAG_X_RESOLUTION = 282;
  var TAG_Y_RESOLUTION = 283;
  var TAG_RESOLUTION_UNIT = 296;
  var exifResolution = (data) => {
    const x = exifNumber(data, "image", TAG_X_RESOLUTION);
    const y = exifNumber(data, "image", TAG_Y_RESOLUTION);
    if (x === null || y === null || x <= 0 || y <= 0)
      return null;
    const unit = exifNumber(data, "image", TAG_RESOLUTION_UNIT) ?? 2;
    if (unit === 2)
      return { x, y };
    if (unit === 3)
      return { x: x * CM_PER_INCH, y: y * CM_PER_INCH };
    return null;
  };

  // node_modules/@nasdigitaluk/withnate-tool-core/dist/dimensions.js
  var measurePng = (b) => {
    const width = be32(b, 16);
    const height = be32(b, 20);
    let density = null;
    let p = 8;
    while (p + 8 <= b.length) {
      const len = be32(b, p);
      const type = p + 4;
      if (matchAscii(b, type, "IDAT") || matchAscii(b, type, "IEND"))
        break;
      if (matchAscii(b, type, "pHYs") && len === 9 && p + 8 + 9 <= b.length) {
        const d = p + 8;
        const perMetreX = be32(b, d);
        const perMetreY = be32(b, d + 4);
        if (u8(b, d + 8) === 1 && perMetreX > 0 && perMetreY > 0) {
          density = {
            x: perMetreX * MM_PER_INCH / MM_PER_METRE,
            y: perMetreY * MM_PER_INCH / MM_PER_METRE,
            source: "png-phys"
          };
        }
        break;
      }
      p += 12 + len;
    }
    return { format: "png", width, height, density };
  };
  var isSof = (m) => m >= 192 && m <= 195 || m >= 197 && m <= 199 || m >= 201 && m <= 203 || m >= 205 && m <= 207;
  var measureJpeg = (b) => {
    let density = null;
    let p = 2;
    while (p + 4 <= b.length) {
      if (u8(b, p) !== 255) {
        p += 1;
        continue;
      }
      const marker = u8(b, p + 1);
      if (marker === 255) {
        p += 1;
        continue;
      }
      if (marker === 216 || marker >= 208 && marker <= 217 || marker === 1) {
        p += 2;
        continue;
      }
      const len = be16(b, p + 2);
      if (len < 2)
        break;
      const payload = p + 4;
      if (isSof(marker)) {
        return { format: "jpeg", height: be16(b, payload + 1), width: be16(b, payload + 3), density };
      }
      if (marker === 224 && matchAscii(b, payload, "JFIF\0")) {
        const units = u8(b, payload + 7);
        const x = be16(b, payload + 8);
        const y = be16(b, payload + 10);
        if (x > 0 && y > 0) {
          if (units === 1)
            density = { x, y, source: "jfif" };
          else if (units === 2) {
            density = { x: x * CM_PER_INCH, y: y * CM_PER_INCH, source: "jfif" };
          }
        }
      }
      if (marker === 218)
        break;
      p = payload + len - 2;
    }
    throw new RangeError("no start-of-frame segment found");
  };
  var measureGif = (b) => ({
    format: "gif",
    width: le16(b, 6),
    height: le16(b, 8),
    density: null
  });
  var measureWebp = (b) => {
    const fourcc = String.fromCharCode(u8(b, 12), u8(b, 13), u8(b, 14), u8(b, 15));
    const data = 20;
    if (fourcc === "VP8X") {
      return {
        format: "webp",
        width: le24(b, data + 4) + 1,
        height: le24(b, data + 7) + 1,
        density: null
      };
    }
    if (fourcc === "VP8 ") {
      return {
        format: "webp",
        width: le16(b, data + 6) & 16383,
        height: le16(b, data + 8) & 16383,
        density: null
      };
    }
    if (fourcc === "VP8L") {
      if (u8(b, data) !== 47)
        throw new RangeError("VP8L signature byte missing");
      const bits = u8(b, data + 1) | u8(b, data + 2) << 8 | u8(b, data + 3) << 16 | u8(b, data + 4) << 24;
      return {
        format: "webp",
        width: (bits & 16383) + 1,
        height: (bits >>> 14 & 16383) + 1,
        density: null
      };
    }
    throw new RangeError(`unrecognised WebP chunk "${fourcc}"`);
  };
  var MEASURERS = {
    png: measurePng,
    jpeg: measureJpeg,
    gif: measureGif,
    webp: measureWebp
  };
  var measureImage = (bytes) => {
    const format = sniffFormat(bytes);
    if (format === null)
      return null;
    try {
      const m = MEASURERS[format](bytes);
      if (!Number.isFinite(m.width) || !Number.isFinite(m.height) || m.width < 1 || m.height < 1) {
        return null;
      }
      if (m.density === null) {
        const exif = parseExif(bytes);
        const res = exif ? exifResolution(exif) : null;
        if (res)
          m.density = { x: res.x, y: res.y, source: "exif" };
      }
      return m;
    } catch {
      return null;
    }
  };

  // node_modules/@nasdigitaluk/withnate-tool-core/dist/intake.js
  var DEFAULT_DRAGGING_CLASS = "is-dragging";
  var attachIntake = (root, opts) => {
    const draggingClass = opts.draggingClass ?? DEFAULT_DRAGGING_CLASS;
    const input = root.querySelector('input[type="file"]');
    const accept = (file) => {
      if (!file)
        return;
      if (opts.maxBytes && file.size > opts.maxBytes) {
        opts.onReject?.(`That file is ${formatBytes(file.size)}. The limit here is ${formatBytes(opts.maxBytes)}.`);
        return;
      }
      if (file.size === 0) {
        opts.onReject?.("That file is empty.");
        return;
      }
      opts.onFile(file);
    };
    const onDragEnter = (e) => {
      e.preventDefault();
      root.classList.add(draggingClass);
    };
    const onDragOver = (e) => {
      e.preventDefault();
      if (e.dataTransfer)
        e.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (e) => {
      if (e.relatedTarget instanceof Node && root.contains(e.relatedTarget))
        return;
      root.classList.remove(draggingClass);
    };
    const onDrop = (e) => {
      e.preventDefault();
      root.classList.remove(draggingClass);
      accept(e.dataTransfer?.files?.[0]);
    };
    const onChange = () => {
      accept(input?.files?.[0]);
      if (input)
        input.value = "";
    };
    const onPaste = (e) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.kind === "file");
      const file = item?.getAsFile();
      if (file) {
        e.preventDefault();
        accept(file);
      }
    };
    root.addEventListener("dragenter", onDragEnter);
    root.addEventListener("dragover", onDragOver);
    root.addEventListener("dragleave", onDragLeave);
    root.addEventListener("drop", onDrop);
    input?.addEventListener("change", onChange);
    document.addEventListener("paste", onPaste);
    return () => {
      root.removeEventListener("dragenter", onDragEnter);
      root.removeEventListener("dragover", onDragOver);
      root.removeEventListener("dragleave", onDragLeave);
      root.removeEventListener("drop", onDrop);
      input?.removeEventListener("change", onChange);
      document.removeEventListener("paste", onPaste);
      root.classList.remove(draggingClass);
    };
  };
  var readHeaderBytes = async (file, n = HEADER_BYTES) => {
    const buf = await file.slice(0, n).arrayBuffer();
    return new Uint8Array(buf);
  };

  // node_modules/@nasdigitaluk/withnate-tool-core/dist/mount.js
  var getWn = () => globalThis.WN ?? null;
  var mount = (selector, init) => {
    const run = () => {
      const root = document.querySelector(selector);
      if (!root)
        return;
      const wn = getWn();
      const reduced = wn?.reduced ?? (typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)").matches : true);
      init({ root, wn, reduced });
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", run, { once: true });
    } else {
      run();
    }
  };

  // node_modules/@nasdigitaluk/withnate-tool-core/dist/dom.js
  var h = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v === null || v === void 0)
        continue;
      if (k === "class")
        node.className = String(v);
      else if (v === true)
        node.setAttribute(k, "");
      else
        node.setAttribute(k, String(v));
    }
    for (const c of children) {
      if (c === null || c === void 0)
        continue;
      node.append(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
  };

  // src/plan.ts
  var MAX_MEGAPIXELS = 80;
  var MAX_STEP_FACTOR = 2;
  var megapixels = (size) => size.width * size.height / 1e6;
  var isTooLarge = (size) => megapixels(size) > MAX_MEGAPIXELS;
  var clampLongEdge = (value) => Math.max(1, Math.min(2e4, Math.round(value)));
  var planResize = (source, longEdge) => {
    const sourceLong = Math.max(source.width, source.height);
    if (longEdge === null || longEdge >= sourceLong) {
      return { width: source.width, height: source.height };
    }
    const target = clampLongEdge(longEdge);
    const scale = target / sourceLong;
    return {
      width: Math.max(1, Math.round(source.width * scale)),
      height: Math.max(1, Math.round(source.height * scale))
    };
  };
  var downscaleSteps = (source, target) => {
    const steps = [];
    let current = source;
    while (current.width > target.width * MAX_STEP_FACTOR || current.height > target.height * MAX_STEP_FACTOR) {
      current = {
        width: Math.max(target.width, Math.round(current.width / MAX_STEP_FACTOR)),
        height: Math.max(target.height, Math.round(current.height / MAX_STEP_FACTOR))
      };
      steps.push(current);
    }
    if (current.width !== target.width || current.height !== target.height) {
      steps.push({ width: target.width, height: target.height });
    }
    return steps;
  };
  var MIME = {
    jpeg: "image/jpeg",
    webp: "image/webp",
    png: "image/png"
  };
  var EXTENSION = {
    jpeg: "jpg",
    webp: "webp",
    png: "png"
  };
  var mimeFor = (format) => MIME[format];
  var supportsAlpha = (format) => format !== "jpeg";
  var qualityApplies = (format) => format !== "png";
  var needsMatte = (format, sourceHasAlpha) => sourceHasAlpha && !supportsAlpha(format);
  var resolveFormat = (requested, sourceFormat) => {
    if (requested !== "keep") return requested;
    if (sourceFormat === "png") return "png";
    if (sourceFormat === "webp") return "webp";
    return "jpeg";
  };
  var suggestedName = (original, format) => {
    const trimmed = original.trim() || "image";
    const dot = trimmed.lastIndexOf(".");
    const stem = dot > 0 ? trimmed.slice(0, dot) : trimmed;
    return `${stem}-compressed.${EXTENSION[format]}`;
  };
  var savingsPercent = (originalBytes, resultBytes) => {
    if (!Number.isFinite(originalBytes) || originalBytes <= 0) return 0;
    if (!Number.isFinite(resultBytes) || resultBytes < 0) return 0;
    return (originalBytes - resultBytes) / originalBytes * 100;
  };
  var isBigger = (originalBytes, resultBytes) => resultBytes > originalBytes;
  var verdictFor = (originalBytes, resultBytes, format, sourceFormat) => {
    const percent = savingsPercent(originalBytes, resultBytes);
    if (isBigger(originalBytes, resultBytes)) {
      const rounded = Math.abs(percent) < 0.5 ? "slightly" : `${Math.round(Math.abs(percent))}% `;
      const sameFormat = sourceFormat === format || sourceFormat === "jpeg" && format === "jpeg";
      return {
        kind: "bigger",
        percent,
        headline: `This came out ${rounded}bigger than the original.`,
        advice: sameFormat ? "The original is already well compressed. Keep it - re-encoding an efficient file adds bytes rather than removing them." : "Try a lower quality, a smaller long edge, or keep the original format."
      };
    }
    if (percent < 0.5) {
      return {
        kind: "same",
        percent,
        headline: "This came out about the same size as the original.",
        advice: "There is little left to remove. Keep the original unless you need the new format."
      };
    }
    return {
      kind: "smaller",
      percent,
      headline: `${Math.round(percent)}% smaller.`,
      advice: null
    };
  };
  var clampQuality = (value) => {
    if (!Number.isFinite(value)) return 0.8;
    return Math.min(1, Math.max(0.3, Math.round(value * 100) / 100));
  };
  var LONG_EDGE_PRESETS = [
    { label: "Original size", value: null },
    { label: "2560 px", value: 2560 },
    { label: "1920 px", value: 1920 },
    { label: "1200 px", value: 1200 },
    { label: "800 px", value: 800 }
  ];

  // src/encode.ts
  var MATTE = "#ffffff";
  var ALPHA_SAMPLE_STRIDE = 97;
  var decode = async (file) => createImageBitmap(file, { imageOrientation: "from-image" });
  var makeCanvas = (size) => {
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    return canvas;
  };
  var context2d = (canvas) => {
    const ctx = canvas.getContext("2d", { willReadFrequently: false });
    if (!ctx) throw new Error("This browser would not give us a 2D canvas to draw on.");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    return ctx;
  };
  var sampleHasAlpha = (canvas) => {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 3; i < data.length; i += 4 * ALPHA_SAMPLE_STRIDE) {
      if (data[i] < 255) return true;
    }
    for (let i = data.length - 1; i >= 3 && i > data.length - 4 * 512; i -= 4) {
      if (data[i] < 255) return true;
    }
    return false;
  };
  var drawResized = (source, target) => {
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
  var flattenOnto = (canvas, colour) => {
    const matted = makeCanvas({ width: canvas.width, height: canvas.height });
    const ctx = context2d(matted);
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, matted.width, matted.height);
    ctx.drawImage(canvas, 0, 0);
    return matted;
  };
  var toBlob = (canvas, format, quality) => new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error(`This browser could not encode a ${format.toUpperCase()}.`));
      },
      mimeFor(format),
      quality
    );
  });
  var encodeFrom = async (resized, hadAlpha, format, quality) => {
    const matted = needsMatte(format, hadAlpha);
    const canvas = matted ? flattenOnto(resized, MATTE) : resized;
    return { blob: await toBlob(canvas, format, quality), matted };
  };
  var supportsFormat = async (format) => {
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

  // src/index.ts
  var el = (root, sel) => root.querySelector(sel);
  var sizeKey = (size) => `${size.width}x${size.height}`;
  mount("[data-ic]", ({ root }) => {
    const drop = el(root, "[data-ic-drop]");
    if (!drop) return;
    const statusOut = el(root, "[data-ic-status]");
    const resultOut = el(root, "[data-ic-result]");
    const controls = el(root, "[data-ic-controls]");
    const previewOut = el(root, "[data-ic-preview]");
    const formatSel = el(root, "[data-ic-format]");
    const longEdgeSel = el(root, "[data-ic-longedge]");
    const qualityInput = el(root, "[data-ic-quality]");
    const qualityLabel = el(root, "[data-ic-quality-label]");
    const downloadBtn = el(root, "[data-ic-download]");
    const resetBtn = el(root, "[data-ic-reset]");
    let loaded = null;
    let resized = null;
    let objectUrl = null;
    let request = 0;
    let debounce = 0;
    const setStatus = (text, kind = "") => {
      if (!statusOut) return;
      statusOut.textContent = text;
      statusOut.className = kind ? `ic-status is-${kind}` : "ic-status";
      statusOut.hidden = text.length === 0;
    };
    const releaseUrl = () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
    };
    const showControls = (on) => {
      if (controls) controls.hidden = !on;
      if (resetBtn) resetBtn.hidden = !on;
      if (!on && resultOut) resultOut.replaceChildren();
      if (!on && previewOut) {
        previewOut.removeAttribute("src");
        previewOut.hidden = true;
      }
      if (!on && downloadBtn) downloadBtn.hidden = true;
    };
    const currentFormat = () => resolveFormat(
      formatSel?.value ?? "keep",
      loaded?.sourceFormat ?? null
    );
    const currentLongEdge = () => {
      const raw = longEdgeSel?.value ?? "";
      return raw === "" ? null : Number(raw);
    };
    const currentQuality = () => clampQuality(Number(qualityInput?.value ?? 80) / 100);
    const syncQualityLabel = () => {
      const format = currentFormat();
      const applies = qualityApplies(format);
      if (qualityInput) qualityInput.disabled = !applies;
      if (qualityLabel) {
        qualityLabel.textContent = applies ? `Quality ${Math.round(currentQuality() * 100)}` : "PNG is lossless, so quality does not apply";
      }
    };
    const renderResult = (blob, target, format, matted) => {
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
            `${formatBytes(loaded.file.size)} \u2192 ${formatBytes(blob.size)} \xB7 ${target.width} \xD7 ${target.height} \xB7 ${format.toUpperCase()}`
          ),
          ...verdict.advice ? [h("p", { class: "ic-advice" }, verdict.advice)] : []
        ),
        ...matted ? [
          h(
            "p",
            { class: "ic-note" },
            "This image had transparency and JPEG cannot store it, so it was flattened onto white. Choose PNG or WebP to keep it."
          )
        ] : [],
        h(
          "p",
          { class: "ic-note" },
          "Re-encoding drops every embedded tag, so the download carries no EXIF, no camera model and no GPS. The colour profile goes with it, so wide-gamut images come back as sRGB."
        )
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
    const recompute = async () => {
      if (!loaded) return;
      const ticket = ++request;
      const format = currentFormat();
      const quality = currentQuality();
      const target = planResize(
        { width: loaded.bitmap.width, height: loaded.bitmap.height },
        currentLongEdge()
      );
      syncQualityLabel();
      setStatus("Working\u2026", "info");
      try {
        const key2 = sizeKey(target);
        if (!resized || resized.key !== key2) {
          const canvas = drawResized(loaded.bitmap, target);
          if (ticket !== request) return;
          resized = { key: key2, canvas, hadAlpha: sampleHasAlpha(canvas), size: target };
        }
        const { blob, matted } = await encodeFrom(
          resized.canvas,
          resized.hadAlpha,
          format,
          quality
        );
        if (ticket !== request) return;
        setStatus("");
        renderResult(blob, target, format, matted);
      } catch (err) {
        if (ticket !== request) return;
        setStatus(err instanceof Error ? err.message : "That image could not be processed.", "error");
      }
    };
    const scheduleRecompute = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => void recompute(), 140);
    };
    const load = async (file) => {
      const ticket = ++request;
      setStatus("Reading\u2026", "info");
      resized = null;
      try {
        const header = await readHeaderBytes(file);
        const measured = measureImage(header);
        if (measured && isTooLarge(measured)) {
          setStatus(
            `That image is ${Math.round(megapixels(measured))} megapixels (${measured.width} \xD7 ${measured.height}). The limit here is ${MAX_MEGAPIXELS}, because decoding it would use more memory than a browser tab can spare.`,
            "error"
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
      draggingClass: "is-dragging"
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
        ...LONG_EDGE_PRESETS.map(
          (preset) => h("option", { value: preset.value === null ? "" : String(preset.value) }, preset.label)
        )
      );
    }
    showControls(false);
    syncQualityLabel();
    void (async () => {
      if (!await supportsFormat("webp") && formatSel) {
        const option = formatSel.querySelector('option[value="webp"]');
        if (option) {
          option.disabled = true;
          option.textContent = "WebP (not supported by this browser)";
        }
      }
    })();
  });
})();
