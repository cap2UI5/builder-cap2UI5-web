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
// (require("abap2UI5/z2ui5_cl_util")) — a self-reference resolved through
// cap2UI5/package.json's exports map. Every export maps a class name onto
// the file with the same basename, so resolving by basename over srv/z2ui5
// is equivalent and keeps the build independent of bundler support for
// package self-references.
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
})(path.join(CAP_DIR, "srv", "z2ui5"));

const abap2ui5SelfReference = {
  name: "abap2ui5-self-reference",
  setup(build) {
    build.onResolve({ filter: /^abap2UI5(\/|$)/ }, (args) => {
      const subpath = args.path === "abap2UI5" ? "z2ui5_cl_util" : args.path.slice("abap2UI5/".length);
      const resolved = frameworkFiles.get(subpath);
      if (!resolved) {
        return { errors: [{ text: `abap2UI5 self-reference "${args.path}" has no matching file under srv/z2ui5` }] };
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
const html = fs.readFileSync(indexFile, "utf8");
const idx = html.indexOf(marker);
if (idx < 0) throw new Error("index.html: no <script> tag found to anchor the bundle injection");
const injected =
  html.slice(0, idx) +
  `<script src="./${BUNDLE_NAME}"></script>\n    ` +
  html.slice(idx);
fs.writeFileSync(indexFile, injected);

// GitHub Pages: serve folders starting with _ etc. as-is.
fs.writeFileSync(path.join(DIST, ".nojekyll"), "");

console.log(`web build complete → ${path.relative(process.cwd(), DIST)}`);
