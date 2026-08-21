// Turning the upstream webapp's index.html into the deployable static shell:
// bundle before the UI5 bootstrap, bootstrap on an absolute OpenUI5 CDN URL,
// this playground's name instead of abap2UI5's.
//
// It lives in its own module for the same reason roundtrip.mjs does. These
// three substitutions are regexes over HTML this repo does not own — the file
// is copied verbatim from the mirrored app repo — and they are the entire
// distance between a working site and a blank page. A rewritten <head>
// upstream turns a substitution into a silent no-op, the build stays green,
// and the failure only shows in a browser. So: pure functions over strings,
// each one throwing when its anchor is gone rather than returning the input
// unchanged, exercised by test/patch-index.test.mjs without a browser.

/**
 * The bootstrap src the upstream webapp ships.
 *
 * On the CAP server /resources is proxied to UI5; a static host has no such
 * server. Served from a project subpath on GitHub Pages that URL resolves to
 * <origin>/resources/... and 404s — UI5 never loads and the page stays blank.
 */
export const BOOTSTRAP_LOCAL_SRC = 'src="/resources/sap-ui-core.js"';

/**
 * The bootstrap src the shipped shell must use.
 *
 * OpenUI5 only — the proprietary SAPUI5 distribution (ui5.sap.com) must NOT
 * be used. This is the CDN entry point the framework itself defaults to
 * (z2ui5_cl_ui5f_index_html); sdk.openui5.org's cachebuster serves the current
 * stable OpenUI5, which is what the upstream abap2UI5 web samples run on.
 * (Pinning a patch level is unreliable: old versions like 1.113.0 are pruned
 * from the CDN, and a 404 there leaves a blank page. Which version a given
 * deploy actually got is recorded in BUILD_INFO.json instead.)
 */
export const UI5_CDN_SRC = 'src="https://sdk.openui5.org/resources/sap-ui-cachebuster/sap-ui-core.js"';

/** Repoint the UI5 bootstrap at the OpenUI5 CDN. Idempotent. */
export function repointUi5Bootstrap(html) {
  if (html.includes(BOOTSTRAP_LOCAL_SRC)) return html.replace(BOOTSTRAP_LOCAL_SRC, UI5_CDN_SRC);
  if (html.includes(UI5_CDN_SRC)) return html; // already repointed
  throw new Error(`index.html: UI5 bootstrap ${BOOTSTRAP_LOCAL_SRC} not found — cannot repoint it at the CDN`);
}

/**
 * Load the bundle before the UI5 bootstrap.
 *
 * Injected in front of the FIRST <script> in the document, not next to the
 * bootstrap: the fetch interceptor, the class registry and the draft store
 * have to be in place before the component fires its first roundtrip, and
 * "before everything" is the only placement that stays true when upstream
 * adds a script of its own above the bootstrap.
 */
export function injectBundleScript(html, bundleName) {
  const idx = html.indexOf("<script");
  if (idx < 0) throw new Error("index.html: no <script> tag found to anchor the bundle injection");
  return `${html.slice(0, idx)}<script src="./${bundleName}"></script>\n    ${html.slice(idx)}`;
}

/**
 * The upstream webapp is abap2UI5's and says so in its <title> — on this
 * playground that is the wrong name in the browser tab, in bookmarks and in
 * link previews.
 */
export function patchTitle(html, title) {
  if (!/<title>[^<]*<\/title>/.test(html)) {
    throw new Error("index.html: no <title> element found — cannot set the site title");
  }
  return html.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
}

/**
 * Same for manifest.json — and its description ("Create UI5 apps purely in
 * ABAP") is abap2UI5's tagline, the opposite of what this site demonstrates:
 * here the apps are written in JavaScript and answered in-process in the
 * browser.
 *
 * Takes and returns text so the caller does not have to know how the file is
 * serialized. Throws on malformed JSON; a manifest whose sap.app carries
 * neither key is the frontend's business, not this patch's.
 */
export function patchManifest(text, { title, description }) {
  const manifest = JSON.parse(text);
  if (manifest["sap.app"]?.title) manifest["sap.app"].title = title;
  if (manifest["sap.app"]?.description) manifest["sap.app"].description = description;
  return JSON.stringify(manifest, null, 2) + "\n";
}

/** The full index.html patch, in the order the shell needs it. */
export function patchIndexHtml(html, { bundleName, title }) {
  return patchTitle(injectBundleScript(repointUi5Bootstrap(html), bundleName), title);
}

/**
 * Re-read the patched shell and assert the invariants it needs, so a broken
 * bootstrap cannot ship silently as a blank page:
 *   - the in-browser backend bundle is injected
 *   - UI5 boots from an OpenUI5 CDN over https — never the proprietary SAPUI5
 *     one (ui5.sap.com / *.hana.ondemand.com/sapui5), never a relative path
 *     (no server serves /resources on GitHub Pages)
 *   - the bundle script comes first, or the component's first roundtrip goes
 *     to the network, where nothing is listening
 *
 * Returns the problems found (empty = sane) plus the bootstrap URL, which the
 * build log reports.
 */
export function shellProblems(html, bundleName) {
  const problems = [];
  const bundleIdx = html.indexOf(`src="./${bundleName}"`);
  if (bundleIdx < 0) problems.push(`bundle <script src="./${bundleName}"> missing`);
  const boot =
    html.match(/id="sap-ui-bootstrap"[^>]*\ssrc="([^"]+)"/) ||
    html.match(/<script[^>]*\ssrc="([^"]*sap-ui-core\.js)"/);
  const bootSrc = boot?.[1] || "";
  if (!bootSrc) problems.push("UI5 bootstrap <script src> not found");
  else if (!/^https:\/\//.test(bootSrc)) problems.push(`UI5 bootstrap is not an absolute https URL: ${bootSrc}`);
  else if (/ui5\.sap\.com|sapui5/i.test(bootSrc)) problems.push(`UI5 bootstrap uses the proprietary SAPUI5 distribution (OpenUI5 only): ${bootSrc}`);
  else if (!/openui5/i.test(bootSrc)) problems.push(`UI5 bootstrap is not a recognized OpenUI5 CDN: ${bootSrc}`);
  if (bundleIdx >= 0 && bootSrc && bundleIdx > html.indexOf(bootSrc)) {
    problems.push("bundle <script> comes after the UI5 bootstrap — the first roundtrip would go to the network");
  }
  return { bootSrc, problems };
}
