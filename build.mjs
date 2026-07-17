// Builds the static cap2UI5 web site into dist/:
//
//   1. gen-registry.mjs  → static app-class manifest
//   2. esbuild           → bundle entry.mjs (+ backend + samples) into
//                          dist/z2ui5-web.js with Node-API stubs
//   3. copy the unchanged UI5 frontend (app/z2ui5/webapp from the mirror)
//   4. patch dist/index.html so the bundle loads BEFORE the UI5 bootstrap
//
// Input is the upstream snapshot under input/cap2UI5/ — run
// `npm run mirror` first. The result is fully static — open it from any
// web server (GitHub Pages, `npm run serve`, ...); every z2ui5 roundtrip
// is answered in-process by the bundled backend.

import fs from "node:fs";
import path from "node:path";
import * as esbuild from "esbuild";
import { generateRegistry } from "./gen-registry.mjs";
import { ROOT_DIR, CAP_DIR, DIST_DIR } from "./paths.mjs";

const DIST = DIST_DIR;

if (!fs.existsSync(CAP_DIR)) {
  throw new Error("input/cap2UI5 is missing — run `npm run mirror` first");
}
const BUNDLE_NAME = "z2ui5-web.js";

// ---- 1. + 2. registry & bundle ---------------------------------------------

// The samples reference the framework by package name
// (require("abap2UI5/z2ui5_cl_util")) — resolved through the vendored core
// package's exports map (core/package.json, npm name `abap2UI5`). Every
// export maps a class name onto the file with the same basename, so
// resolving by basename over core/srv is equivalent and keeps the build
// independent of bundler support for package (self-)references.
const frameworkFiles = new Map(); // basename → absolute path
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (entry.name.endsWith(".js")) {
      const name = path.basename(entry.name, ".js");
      if (!frameworkFiles.has(name)) frameworkFiles.set(name, p);
    }
  }
})(path.join(CAP_DIR, "core", "srv"));

const abap2ui5SelfReference = {
  name: "abap2ui5-self-reference",
  setup(build) {
    build.onResolve({ filter: /^abap2UI5(\/|$)/ }, (args) => {
      const subpath = args.path === "abap2UI5" ? "z2ui5_cl_util" : args.path.slice("abap2UI5/".length);
      // exports map subpaths are flat class names; for the path-shaped
      // "./app/*" exports the basename is the class name, too
      const resolved = frameworkFiles.get(subpath) || frameworkFiles.get(subpath.split("/").pop());
      if (!resolved) {
        return { errors: [{ text: `abap2UI5 reference "${args.path}" has no matching file under core/srv` }] };
      }
      return { path: resolved };
    });
  },
};

const stub = (name) => path.join(ROOT_DIR, "stubs", name);

const buildOptions = {
  entryPoints: [path.join(ROOT_DIR, "entry.mjs")],
  outfile: path.join(DIST, BUNDLE_NAME),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  sourcemap: true,
  minify: true,
  // Draft persistence serializes apps under oApp.constructor.name and the
  // response's S_FRONT.APP carries it too — class names must survive
  // minification.
  keepNames: true,
  logLevel: "info",
  plugins: [abap2ui5SelfReference],
  // Node built-ins and @sap/cds are unreachable at runtime (custom draft
  // store + registry are installed before the first roundtrip) but must
  // resolve at build time.
  alias: {
    "@sap/cds": stub("cds.cjs"),
    fs: stub("fs.cjs"),
    "node:fs": stub("fs.cjs"),
    path: stub("path.cjs"),
    "node:path": stub("path.cjs"),
    crypto: stub("crypto.cjs"),
    "node:crypto": stub("crypto.cjs"),
  },
  // CJS framework files reference __dirname (feeds only the stubbed fs) and
  // a few process.env switches (all optional).
  define: {
    __dirname: '"/"',
    "process.env.Z2UI5_APP_DIRS": "undefined",
    "process.env.TENANT": "undefined",
    "process.env.USER": '"browser"',
    "process.env.USERNAME": "undefined",
  },
};

// Some transpiled samples pass Node's loader but fail esbuild's stricter
// scope analysis (e.g. assignment to a const class field). Same policy as
// the sync pipeline's copy step: skip the file, report it, ship the rest.
// The registry is regenerated without the rejected files and the bundle
// retried; sample classes are independent leaves, so each round can only
// remove sample files, which bounds the loop.
const excludeFiles = new Set();
const sampleFiles = new Set(generateRegistry({ excludeFiles }).files);
for (;;) {
  try {
    await esbuild.build(buildOptions);
    break;
  } catch (e) {
    const rejected = [...new Set(
      (e.errors || [])
        .map((err) => err.location?.file && path.resolve(err.location.file))
        .filter((f) => f && sampleFiles.has(f) && !excludeFiles.has(f)),
    )];
    if (!rejected.length) throw e; // not a sample-class problem — real failure
    for (const f of rejected) {
      excludeFiles.add(f);
      console.warn(`bundle: excluding ${path.relative(CAP_DIR, f)} (rejected by esbuild), retrying`);
    }
    generateRegistry({ excludeFiles });
  }
}

// ---- 3. frontend ------------------------------------------------------------
const WEBAPP = path.join(CAP_DIR, "app", "z2ui5", "webapp");
fs.cpSync(WEBAPP, DIST, { recursive: true });

// ---- 4. index.html ----------------------------------------------------------
// Load the bundle before the UI5 bootstrap so the fetch interceptor, the
// class registry and the draft store are in place before the component
// fires its first roundtrip.
const indexFile = path.join(DIST, "index.html");
const marker = "<script";
let html = fs.readFileSync(indexFile, "utf8");

// The upstream webapp boots UI5 from the server-absolute path
// "/resources/sap-ui-core.js" — on the CAP server /resources is proxied to
// UI5, but the static site has no such server. Served from a project
// subpath on GitHub Pages that URL resolves to <origin>/resources/... and
// 404s, so UI5 never loads and the page stays blank. Repoint the bootstrap
// at the public UI5 CDN so the shell loads standalone from any static host.
//
// OpenUI5 only — the proprietary SAPUI5 distribution (ui5.sap.com) must NOT
// be used. Use the OpenUI5 CDN entry point the framework itself defaults to
// (z2ui5_cl_app_index_html) — sdk.openui5.org's cachebuster serves the
// current stable OpenUI5, which is exactly what the upstream abap2UI5 web
// samples run on. (Pinning to a specific patch is unreliable: old versions
// like 1.113.0 are pruned from the CDN, and a 404 there leaves a blank page.)
const BOOTSTRAP_LOCAL_SRC = 'src="/resources/sap-ui-core.js"';
const UI5_CDN_SRC = 'src="https://sdk.openui5.org/resources/sap-ui-cachebuster/sap-ui-core.js"';
if (html.includes(BOOTSTRAP_LOCAL_SRC)) {
  html = html.replace(BOOTSTRAP_LOCAL_SRC, UI5_CDN_SRC);
} else if (!html.includes(UI5_CDN_SRC)) {
  throw new Error(
    `index.html: UI5 bootstrap ${BOOTSTRAP_LOCAL_SRC} not found — cannot repoint it at the CDN`,
  );
}

const idx = html.indexOf(marker);
if (idx < 0) throw new Error("index.html: no <script> tag found to anchor the bundle injection");
const injected =
  html.slice(0, idx) +
  `<script src="./${BUNDLE_NAME}"></script>\n    ` +
  html.slice(idx);
fs.writeFileSync(indexFile, injected);

// GitHub Pages: serve folders starting with _ etc. as-is.
fs.writeFileSync(path.join(DIST, ".nojekyll"), "");

// ---- 5. sanity-gate the shell ----------------------------------------------
// A broken bootstrap ships silently as a blank page (UI5 never loads), so
// assert the invariants the static shell needs before we call the build good:
//   - the in-browser backend bundle is injected and present on disk
//   - UI5 boots from an OpenUI5 CDN over https — never the proprietary SAPUI5
//     one (ui5.sap.com / *.hana.ondemand.com/sapui5), never a relative path
//     (no server serves /resources on GitHub Pages)
{
  const finalHtml = fs.readFileSync(indexFile, "utf8");
  const problems = [];
  if (!finalHtml.includes(`src="./${BUNDLE_NAME}"`)) problems.push(`bundle <script src="./${BUNDLE_NAME}"> missing`);
  if (!fs.existsSync(path.join(DIST, BUNDLE_NAME))) problems.push(`${BUNDLE_NAME} not emitted`);
  const boot = finalHtml.match(/id="sap-ui-bootstrap"[^>]*\ssrc="([^"]+)"/) || finalHtml.match(/<script[^>]*\ssrc="([^"]*sap-ui-core\.js)"/);
  const bootSrc = boot?.[1] || "";
  if (!bootSrc) problems.push("UI5 bootstrap <script src> not found");
  else if (!/^https:\/\//.test(bootSrc)) problems.push(`UI5 bootstrap is not an absolute https URL: ${bootSrc}`);
  else if (/ui5\.sap\.com|sapui5/i.test(bootSrc)) problems.push(`UI5 bootstrap uses the proprietary SAPUI5 distribution (OpenUI5 only): ${bootSrc}`);
  else if (!/openui5/i.test(bootSrc)) problems.push(`UI5 bootstrap is not a recognized OpenUI5 CDN: ${bootSrc}`);
  if (problems.length) {
    throw new Error(`web build: shell sanity check failed —\n  - ${problems.join("\n  - ")}`);
  }
  console.log(`web build: shell OK — UI5 from ${bootSrc}`);
}

console.log(`web build complete → ${path.relative(process.cwd(), DIST)}`);
