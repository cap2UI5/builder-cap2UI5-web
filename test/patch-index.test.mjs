// Unit tests for the index.html / manifest.json patching.
//
// These three substitutions are the whole distance between the upstream
// webapp and a shell that renders on a static host, and all three are regexes
// over HTML this repo does not own. Until they lived in patch-index.mjs the
// only thing exercising them was the Playwright smoke test — which needs a
// browser, a CDN and a built bundle, and which reports "blank page" for every
// one of the failures below without saying which substitution missed.
//
// The last group is the important one: a patch that no longer matches must
// FAIL, not pass the input through. A silent no-op here deploys a blank site
// that every later check still calls green.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BOOTSTRAP_LOCAL_SRC,
  UI5_CDN_SRC,
  repointUi5Bootstrap,
  injectBundleScript,
  patchTitle,
  patchManifest,
  patchIndexHtml,
  shellProblems,
} from "../patch-index.mjs";

const BUNDLE = "z2ui5-web.js";

// The upstream webapp's index.html (app/z2ui5/webapp/index.html), trimmed to
// what the patches touch.
const UPSTREAM_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>abap2UI5</title>
    <script
        id="sap-ui-bootstrap"
        ${BOOTSTRAP_LOCAL_SRC}
        data-sap-ui-theme="sap_horizon"
        data-sap-ui-async="true"
    ></script>
</head>
<body class="sapUiBody sapUiSizeCompact" id="content">
    <div data-sap-ui-component data-name="z2ui5"></div>
</body>
</html>
`;

test("the bundle is injected before the UI5 bootstrap", () => {
  const html = injectBundleScript(UPSTREAM_HTML, BUNDLE);
  const bundle = html.indexOf(`<script src="./${BUNDLE}"></script>`);
  const bootstrap = html.indexOf('id="sap-ui-bootstrap"');
  assert.ok(bundle >= 0, "bundle script not injected");
  assert.ok(bundle < bootstrap, "bundle must load before the bootstrap");
  // …and before ANY script: the interceptor, the registry and the draft store
  // have to be installed before the component's first roundtrip.
  assert.equal(bundle, html.indexOf("<script"));
});

test("the bootstrap is repointed at an absolute https OpenUI5 URL", () => {
  const html = repointUi5Bootstrap(UPSTREAM_HTML);
  assert.ok(!html.includes(BOOTSTRAP_LOCAL_SRC), "server-absolute /resources path still there");
  assert.ok(html.includes(UI5_CDN_SRC));

  const src = html.match(/id="sap-ui-bootstrap"[\s\S]*?src="([^"]+)"/)[1];
  assert.match(src, /^https:\/\//);
  assert.match(src, /openui5/i);
  // OpenUI5 only — never the proprietary SAPUI5 distribution.
  assert.doesNotMatch(src, /ui5\.sap\.com|sapui5/i);
});

test("repointing is idempotent on an already patched shell", () => {
  const once = repointUi5Bootstrap(UPSTREAM_HTML);
  assert.equal(repointUi5Bootstrap(once), once);
});

test("the title and the manifest carry this site's name, not abap2UI5's", () => {
  assert.match(patchTitle(UPSTREAM_HTML, "cap2UI5 — Browser Playground"), /<title>cap2UI5 — Browser Playground<\/title>/);

  const manifest = patchManifest(
    JSON.stringify({ "sap.app": { id: "z2ui5", title: "abap2UI5", description: "Create UI5 apps purely in ABAP" } }),
    { title: "cap2UI5 — Browser Playground", description: "Create UI5 apps purely in JavaScript" },
  );
  const parsed = JSON.parse(manifest);
  assert.equal(parsed["sap.app"].title, "cap2UI5 — Browser Playground");
  assert.equal(parsed["sap.app"].description, "Create UI5 apps purely in JavaScript");
  assert.equal(parsed["sap.app"].id, "z2ui5", "unrelated keys must survive");
  assert.ok(manifest.endsWith("\n"));
});

test("the full patch leaves a shell the sanity gate accepts", () => {
  const html = patchIndexHtml(UPSTREAM_HTML, { bundleName: BUNDLE, title: "cap2UI5 — Browser Playground" });
  assert.deepEqual(shellProblems(html, BUNDLE).problems, []);
  assert.equal(shellProblems(html, BUNDLE).bootSrc, "https://sdk.openui5.org/resources/sap-ui-cachebuster/sap-ui-core.js");
});

// ---- a changed input must fail, not pass through ---------------------------

test("a bootstrap that is no longer the known one throws", () => {
  const moved = UPSTREAM_HTML.replace(BOOTSTRAP_LOCAL_SRC, 'src="./resources/sap-ui-core.js"');
  assert.throws(() => repointUi5Bootstrap(moved), /UI5 bootstrap .* not found/);
});

test("a document without a <script> throws instead of shipping an inert shell", () => {
  assert.throws(() => injectBundleScript("<html><body>hi</body></html>", BUNDLE), /no <script> tag/);
});

test("a document without a <title> throws instead of keeping abap2UI5's name", () => {
  assert.throws(() => patchTitle("<html><head></head></html>", "x"), /no <title> element/);
});

test("a malformed manifest throws (the caller decides whether that is fatal)", () => {
  assert.throws(() => patchManifest("{not json", { title: "x", description: "y" }));
});

test("the sanity gate names every way the shell can be dead", () => {
  const p = (html) => shellProblems(html, BUNDLE).problems.join(" | ");

  // bundle missing entirely
  assert.match(p(repointUi5Bootstrap(UPSTREAM_HTML)), /bundle <script .*> missing/);
  // bundle after the bootstrap: the first roundtrip would hit the network
  const late = repointUi5Bootstrap(UPSTREAM_HTML).replace("</head>", `<script src="./${BUNDLE}"></script></head>`);
  assert.match(p(late), /comes after the UI5 bootstrap/);
  // still the server-absolute path — 404 on any static host, blank page
  assert.match(p(injectBundleScript(UPSTREAM_HTML, BUNDLE)), /not an absolute https URL/);
  // the proprietary distribution
  const sapui5 = injectBundleScript(UPSTREAM_HTML, BUNDLE).replace(
    BOOTSTRAP_LOCAL_SRC,
    'src="https://ui5.sap.com/resources/sap-ui-core.js"',
  );
  assert.match(p(sapui5), /proprietary SAPUI5/);
  // some other https CDN
  const other = injectBundleScript(UPSTREAM_HTML, BUNDLE).replace(
    BOOTSTRAP_LOCAL_SRC,
    'src="https://example.com/resources/sap-ui-core.js"',
  );
  assert.match(p(other), /not a recognized OpenUI5 CDN/);
  // no bootstrap at all
  assert.match(p('<html><head><script src="./z2ui5-web.js"></script></head></html>'), /bootstrap <script src> not found/);
});
