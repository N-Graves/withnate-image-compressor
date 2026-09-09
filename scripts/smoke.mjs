import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";

const JS = new URL("../dist/image-compressor.js", import.meta.url);
const CSS = new URL("../dist/image-compressor.css", import.meta.url);

const JS_CEILING = 60_000;
const CSS_CEILING = 12_000;

let failed = 0;
const check = (ok, label, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` - ${detail}` : ""}`);
  if (!ok) failed += 1;
};

const js = await readFile(JS, "utf8");
const css = await readFile(CSS, "utf8");

console.log("bundle shape");
check(js.startsWith("/*!"), "carries a banner naming the package and licence");
check(/\(\s*\(\s*\)\s*=>\s*\{|\(function\s*\(/.test(js), "is an IIFE, not an ES module");
check(
  !/^\s*(import|export)\s/m.test(js),
  "has no module syntax left in it",
  "the site loads plain scripts and would fail on an import",
);
check(!/\brequire\s*\(/.test(js), "has no CommonJS require");
check(js.length <= JS_CEILING, `is under ${JS_CEILING} bytes`, `${js.length}`);

console.log("the site's hard rules");

const network = ["fetch(", "XMLHttpRequest", "WebSocket", "sendBeacon", "EventSource"];
for (const api of network) {
  check(!js.includes(api), `makes no network call (${api})`);
}
const storage = ["localStorage", "sessionStorage", "indexedDB", "document.cookie"];
for (const api of storage) {
  check(!js.includes(api), `writes no storage (${api})`);
}
const body = js.slice(js.indexOf("*/") + 2);
check(!/https?:\/\//.test(body), "references no external URL outside the banner");
check(!/\bon[a-z]+\s*=\s*["']/.test(js), "emits no inline event handler attribute");

console.log("silent bail");

const sandbox = {
  console,
  // A standard global in every browser the site supports, and the core builds
  // one at module scope to decode Exif strings. Omitting it made this check
  // fail for a reason no real page would ever hit.
  TextDecoder,
  document: {
    readyState: "complete",
    querySelector: () => null,
    addEventListener: () => {},
    createElement: () => {
      throw new Error("created an element despite there being no root");
    },
  },
  matchMedia: () => ({ matches: false }),
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
let threw = null;
try {
  runInContext(js, createContext(sandbox), { timeout: 5000 });
} catch (err) {
  threw = err;
}
check(threw === null, "runs without throwing when the page has no root element", threw?.message);

console.log("stylesheet");
check(css.length <= CSS_CEILING, `is under ${CSS_CEILING} bytes`, `${css.length}`);

const selectors = css.match(/^\s*\.[a-zA-Z][\w-]*/gm) ?? [];
const foreign = [...new Set(selectors.map((s) => s.trim()))].filter((s) => !s.startsWith(".ic"));
check(foreign.length === 0, "defines only .ic- classes", foreign.join(" "));

console.log("");
if (failed > 0) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("all smoke checks passed");
