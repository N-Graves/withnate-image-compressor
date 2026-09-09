# withnate-image-compressor

Drag a photo in, it shrinks, you download the result. It runs entirely in the browser — no upload,
no network requests, no storage of any kind. "Your image never leaves your device" is a provable
claim here rather than a marketing one, and `scripts/smoke.mjs` is what proves it.

Built for [withnate.co.uk](https://withnate.co.uk) as a drop-in artefact: one IIFE, one stylesheet,
and a demo page you can drive locally.

## The one that makes it different: it admits when it made things worse

A JPEG out of a phone has already been compressed once. Re-encoding it a second time cannot recover
what the first pass discarded, and frequently costs bytes rather than saving them. Most compressors
report the new size and let you work out for yourself that it went up.

This one says so in the headline — *"This came out 54% bigger than the original."* — and the advice
underneath depends on **why**. Re-encoding a JPEG as a JPEG and getting a bigger file means the
original is already efficient, so the honest answer is to keep it; the same result while changing
format means the settings are wrong and a lower quality or a smaller long edge will fix it. Those
are different problems and they get different sentences.

Measured on a real 10,888-byte JPEG saved at quality 35: it comes back 54% bigger and is told so.

## Resizing happens in steps

Asking a browser to draw a 6000px photo straight down to 400px in one `drawImage` throws away most
of the source without sampling it, and the result crawls with aliasing. `downscaleSteps` halves
repeatedly instead — never more than 2× per step — with the last step landing **exactly** on the
target rather than near it. Four cases pin that, including the awkward 8000 → 63.

The walk is proven monotonic and terminating: 20000 → 1 completes in under 30 steps, and no step
ever produces a zero dimension even at extreme aspect ratios.

## Three canvas facts the code is shaped around

None of these are defensive coding; each one is a real defect if you skip it.

- **`createImageBitmap(file, { imageOrientation: "from-image" })`.** Without it a phone photo
  carrying an EXIF orientation tag arrives sideways, and the resize then bakes that in permanently.
- **Canvas composites transparency onto black.** A transparent PNG re-encoded as JPEG comes out with
  a black background, which looks like corruption. `needsMatte` fires only for JPEG-with-alpha, and
  the result is drawn onto white first. The tool says it did this rather than leaving you to notice.
- **PNG ignores `toBlob`'s quality argument entirely.** So `qualityApplies` disables the slider and
  the label reads *"PNG is lossless, so quality does not apply"* rather than offering a control that
  silently does nothing.

## The megapixel ceiling is read before decoding, not after

An 80-megapixel image is roughly 320MB of RGBA once decoded, which is enough to take a phone browser
down. A guard that runs after the decode is not a guard, so the header is read first
(`readHeaderBytes` → `measureImage` → `isTooLarge`) and an oversized file is refused **with its own
megapixel count named**, before a single pixel is allocated.

A real 61-megapixel camera file passes, which is the point of the ceiling being 80 rather than lower.

## What it strips, said out loud

Because the image is re-encoded from raw pixels, the download carries **no EXIF, no camera model and
no GPS coordinates**. That is a side effect rather than a feature, but it is the side effect most
worth knowing about before posting a photo taken at home, so the tool states it on every result. The
colour profile goes the same way — a wide-gamut image comes back as sRGB.

## Races, and why there is a ticket

Dragging the quality slider fires an encode per input event, and `toBlob` is asynchronous, so
without a guard a slow encode can land after a fast one and show a stale size beside a fresh
setting. Every recompute takes a monotonic ticket and bails after each await if a newer one exists.
The slider is additionally debounced at 140ms; the format and size selects are not, because a
discrete choice should feel immediate.

The resized canvas is cached by its own dimensions, so changing format or quality re-encodes without
redoing the downscale walk.

## Integration

The bundle mounts on any element carrying `data-ic` and bails silently if there is none, so it is
safe to load site-wide. It reads and writes these attributes:

| Attribute | Element | Role |
|---|---|---|
| `data-ic` | any | Mount point |
| `data-ic-drop` | any | Drop zone; also hosts the file input |
| `data-ic-status` | any | Reading / working / refusals |
| `data-ic-controls` | any | The three controls, hidden until a file loads |
| `data-ic-format` | `select` | `keep`, `jpeg`, `webp`, `png` |
| `data-ic-longedge` | `select` | Populated from `LONG_EDGE_PRESETS` if empty |
| `data-ic-quality` | `input[type=range]` | Disabled for PNG |
| `data-ic-quality-label` | any | Shows the value, or why it does not apply |
| `data-ic-result` | any | Verdict, sizes, advice, the matte and metadata notes |
| `data-ic-preview` | `img` | The result |
| `data-ic-download` | `a` | Gets `href` and a suggested `download` name |
| `data-ic-reset` | `button` | Clears the loaded image |

Every one except the drop zone is optional — a missing element is skipped, not an error. All content
is real markup in the page, so it is visible before the script runs and to anyone with JavaScript
off.

WebP support is probed with a 1×1 canvas at startup; a browser without it gets that option disabled
and relabelled rather than a silent failure at encode time.

**"Compress another" deliberately keeps your format and size settings.** Running a batch of images
through the same settings is the common case, and resetting the controls would mean re-choosing them
every time. Only the image is cleared.

## Structured data

`demo/index.html` carries a `WebApplication` JSON-LD block. The site's `check.mjs` fails a page with
a second inline `<script>` but explicitly exempts `type="application/ld+json"`, and `seo.mjs` fails
the build on a block that will not parse — so this is the one inline script the page is allowed and
it is validated at build time. It claims no rating and no review count; there is nothing to rate yet
and a fabricated one is a manual action.

## Security posture

The site's rules are enforced by `scripts/smoke.mjs` against the built bundle, not by intention:

- **No network.** No `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon` or `EventSource`, and no
  external URL anywhere outside the banner comment. This is what makes the privacy claim checkable.
- **No storage.** No `localStorage`, `sessionStorage`, `indexedDB` or `document.cookie`. The site's
  privacy policy says nothing is stored, and this keeps that true without a policy edit.
- **No module syntax, no `require`**, so it loads as a plain `<script src>` like everything else.
- **No inline event handler attributes**, which `check.mjs` fails the build on.
- **Silent bail** proven by running the real bundle in a bare `vm` sandbox with no root element.
- **Only `.ic-` classes** in the stylesheet, so it cannot reach outside its own component.
- Nothing untrusted reaches the DOM as markup. The filename is used only for the `download`
  attribute, and every number is formatted from parsed values.

⚠️ The sandbox stubs `TextDecoder`, because the core builds one at module scope to decode Exif
strings. That is a gap in the harness rather than the bundle — `TextDecoder` has been a global in
every browser the site supports since 2017, so no real page could hit it.

Bundle: **30,989 bytes** of JavaScript and **3,293 bytes** of CSS, both well inside the smoke test's
ceilings.

## Testing

**35 tests**, all passing, all against `src/plan.ts` — every decision the tool makes is a pure
function over numbers, so the whole of it is testable with no canvas and no DOM. `src/encode.ts` is
the thin adapter that owns the canvas, and it holds no logic worth pinning that the plan does not
already own.

What they cover, in the order the tool runs:

- **Resizing.** Never upscales; the long edge applies to whichever side is actually longer; aspect
  is held within 0.005; no dimension collapses to zero on a 10000×3 source.
- **The step walk.** Never exceeds 2× per step, always lands exactly on target, monotonic, and
  terminates.
- **Format resolution.** `keep` against a PNG source resolves to PNG; quality applies to JPEG and
  WebP and not PNG; a matte is required only for JPEG-with-alpha.
- **Naming.** `shoot.v2.final.png` keeps its interior dots and becomes `shoot.v2.final-compressed.jpg`;
  `.hidden` and an empty name are both handled rather than producing a file called `-compressed.jpg`.
- **The verdict.** Savings go **negative** rather than clamping at zero, because the negative number
  is the finding. All four branches — smaller, about the same, bigger in the same format, bigger
  across formats — are pinned separately, since they give different advice.

## Built on

[`@nasdigitaluk/withnate-tool-core`](https://github.com/N-Graves/withnate-tool-core) `^0.5.0` for the
drop-zone intake, header measurement, `formatBytes` and the DOM helper. The core is bundled into the
artefact rather than loaded beside it, so the site has one file to place and no load order to manage.

`formatBytes` landed in core 0.5.0 for this tool specifically, rather than being copied in here —
`withnate-raster-to-svg` still carries its own and should adopt the shared one in its own PR.

## Licence

MIT. See [LICENSE](LICENSE).
