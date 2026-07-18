// Post-build smoke test against dist/ — catches the failure mode this site
// has actually shipped with more than once: a silent blank page (broken UI5
// bootstrap, CDN 404, bundle not injected). Serves dist/ locally, opens it
// in headless Chromium and asserts the real startup path:
//
//   1. the in-browser backend bundle is loaded (window.fetch is intercepted)
//   2. UI5 boots from the CDN
//   3. the startup roundtrip is answered in-process and UI5 renders content
//
// Usage: npm run build && npm run smoke
//   CHROMIUM_PATH=/path/to/chromium overrides the browser binary (e.g. a
//   preinstalled one when Playwright's own download is unavailable).

import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { DIST_DIR } from "./paths.mjs";

if (!fs.existsSync(path.join(DIST_DIR, "index.html"))) {
  throw new Error("dist/index.html missing — run `npm run build` first");
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".properties": "text/plain", ".png": "image/png", ".svg": "image/svg+xml" };
const server = createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split(/[?#]/)[0]);
  let file = path.normalize(path.join(DIST_DIR, urlPath));
  if (!file.startsWith(DIST_DIR)) return res.writeHead(403).end();
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  args: ["--no-sandbox"],
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
const page = await browser.newPage();
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(String(e)));

let failure = null;
try {
  const resp = await page.goto(`${origin}/index.html`, { waitUntil: "domcontentloaded", timeout: 30000 });
  if (!resp.ok()) throw new Error(`index.html answered ${resp.status()}`);

  // (1) bundle active: entry.mjs replaced window.fetch before UI5 boots
  const intercepted = await page.evaluate(() => !/\[native code\]/.test(String(window.fetch)));
  if (!intercepted) throw new Error("fetch interceptor not installed — bundle missing or broken");

  // (2)+(3) UI5 booted and rendered the startup app (in-process roundtrip
  // answered) — a blank page fails this selector, which is the point.
  await page.waitForSelector('[class*="sapM"], [class*="sapUi"]', { timeout: 120000 });

  // (4) wire contract, in-page (the interceptor answers fetch in-process, so
  // this never touches the network — patterned on upstream's
  // node/tests/e2e/roundtrip.spec.js):
  //     app_start → APP + draft id, then draft chaining via S_FRONT.ID
  const wire = await page.evaluate(async () => {
    const post = (sFront) =>
      fetch("/rest/root/z2ui5", {
        method: "POST",
        body: JSON.stringify({
          value: { S_FRONT: { ORIGIN: location.origin, PATHNAME: "/", SEARCH: "", HASH: "", ...sFront } },
        }),
      }).then((r) => r.json());
    const first = await post({ SEARCH: "?app_start=z2ui5_cl_app_hello_world" });
    const second = await post({ ID: first.S_FRONT.ID });
    const head = await fetch("/rest/root/z2ui5", { method: "HEAD" });
    return {
      firstApp: first.S_FRONT.APP,
      firstId: first.S_FRONT.ID,
      secondApp: second.S_FRONT.APP,
      secondId: second.S_FRONT.ID,
      csrf: head.headers.get("x-csrf-token"),
    };
  });
  const uuid = /^[0-9a-f-]{36}$/;
  if (wire.firstApp !== "z2ui5_cl_app_hello_world") throw new Error(`app_start answered APP=${wire.firstApp}`);
  if (!uuid.test(wire.firstId)) throw new Error(`app_start draft id malformed: ${wire.firstId}`);
  if (wire.secondApp !== "z2ui5_cl_app_hello_world") throw new Error(`draft chaining lost the app: ${wire.secondApp}`);
  if (!uuid.test(wire.secondId) || wire.secondId === wire.firstId)
    throw new Error(`draft chaining did not answer a fresh draft id (${wire.secondId})`);
  if (wire.csrf !== "disabled") throw new Error(`HEAD did not answer x-csrf-token: disabled (got ${wire.csrf})`);

  // (5) app start through the real shell: URL-driven app_start renders and
  // leaves no dangling '#' (upstream HashChanger regression)
  await page.goto(`${origin}/index.html?app_start=z2ui5_cl_app_hello_world`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[class*="sapM"], [class*="sapUi"]', { timeout: 120000 });
  await page.waitForTimeout(250);
  if (page.url().includes("#")) throw new Error(`dangling '#' after app start: ${page.url()}`);

  console.log("smoke OK — bundle active, UI5 booted, startup app rendered, roundtrip/draft-chain/CSRF/app_start verified");
} catch (e) {
  failure = e;
} finally {
  await browser.close();
  server.close();
}
if (failure) {
  if (consoleErrors.length) console.error("browser console errors:\n  " + consoleErrors.join("\n  "));
  throw failure;
}
