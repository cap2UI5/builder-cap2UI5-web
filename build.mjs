// Builds the static cap2UI5 web site into dist/:
//
//   1. gen-registry.mjs  → static app-class manifest
//   2. esbuild           → bundle entry.mjs (+ backend + samples) into
//                          dist/z2ui5-web.js with Node-API stubs
//   3. copy the unchanged UI5 frontend (app/z2ui5/webapp from the mirror)
//   4. patch dist/index.html so the bundle loads BEFORE the UI5 bootstrap
//   5. generate dist/samples.html — the landing page listing every shipped
//      sample, deep-linked into the playground
//
// Input is the upstream snapshot under input/cap2UI5/ — run
// `npm run mirror` first. The result is fully static — open it from any
// web server (GitHub Pages, `npm run serve`, ...); every z2ui5 roundtrip
// is answered in-process by the bundled backend.

import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import * as esbuild from "esbuild";
import { generateRegistry } from "./gen-registry.mjs";
import { patchIndexHtml, patchManifest, shellProblems } from "./patch-index.mjs";
import { parseSampleCatalog, sampleEntries, renderSamplesPage } from "./samples-page.mjs";
import { resolveOpenUI5Version, buildInfoJson } from "./build-info.mjs";
import { ROOT_DIR, CAP_DIR, DIST_DIR } from "./paths.mjs";

const DIST = DIST_DIR;

if (!fs.existsSync(CAP_DIR)) {
  throw new Error("input/cap2UI5 is missing — run `npm run mirror` first");
}
const BUNDLE_NAME = "z2ui5-web.js";

// Start from an empty dist. Nothing here ever deletes, it only writes and
// copies over — so a file that disappeared upstream (a removed webapp module,
// a renamed bundle) would survive locally and keep the smoke test green on a
// site that no longer builds from scratch. CI always runs on a fresh
// checkout; this is what makes a local build match it.
fs.rmSync(DIST, { recursive: true, force: true });

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
      // First hit wins, matching the runtime's name-based lookup — but say so.
      // Two files with the same basename mean one of them is unreachable
      // through require("abap2UI5/<name>"), and which one that is depends on
      // directory order: exactly the kind of thing an upstream move does by
      // accident, and it would otherwise only surface as a sample behaving
      // like a different class.
      if (frameworkFiles.has(name)) {
        console.warn(
          `bundle: duplicate class basename ${name} — abap2UI5/${name} resolves to ` +
            `${path.relative(CAP_DIR, frameworkFiles.get(name))}, ignoring ${path.relative(CAP_DIR, p)}`,
        );
      } else {
        frameworkFiles.set(name, p);
      }
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
  // Off by default: the map is ~2 MB per deployment (unbounded git growth
  // in web-cap2UI5-build) and publishes the full unminified sources on
  // Pages. Opt in locally with WEB_SOURCEMAP=1 when debugging the bundle.
  sourcemap: process.env.WEB_SOURCEMAP === "1",
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
    async_hooks: stub("async_hooks.cjs"),
    "node:async_hooks": stub("async_hooks.cjs"),
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
// Only BUNDLED SAMPLES may be auto-excluded and the bundle retried: they are
// independent leaves, so dropping one can't affect the rest. A built-in
// (core/srv/z2ui5/02) or an app class (srv/app) that esbuild rejects is a
// REAL build failure and must surface — not be silently dropped from the
// shipped bundle. Gate the retry on the samples directory prefix, not on the
// whole registry (which includes the built-ins).
const SAMPLES_DIR = path.join(CAP_DIR, "core", "srv", "app", "samples") + path.sep;

// The registry is built by walking directories, and walkClassFiles answers []
// for a directory that is not there. A renamed or moved samples folder
// upstream therefore produces a perfectly valid registry of ~6 built-ins, a
// bundle that builds, a shell that boots and a smoke test that passes on
// z2ui5_cl_ui5_app_hi_world — a green deploy of a playground with no samples
// in it. Nothing else in the pipeline notices; this floor does. It sits far
// enough below the ~110 classes a healthy build produces to survive samples
// being added, removed or rejected by esbuild.
const MIN_REGISTRY_CLASSES = 50;
function generateRegistryOrFail(options) {
  const result = generateRegistry(options);
  if (result.count < MIN_REGISTRY_CLASSES) {
    throw new Error(
      `registry: only ${result.count} class(es) — expected at least ${MIN_REGISTRY_CLASSES}. ` +
        `Did the samples move? Checked ${path.relative(CAP_DIR, SAMPLES_DIR)} and the built-ins under core/srv/z2ui5.`,
    );
  }
  return result;
}

const excludeFiles = new Set();
let registry = generateRegistryOrFail({ excludeFiles });
for (;;) {
  try {
    await esbuild.build(buildOptions);
    break;
  } catch (e) {
    const rejected = [...new Set(
      (e.errors || [])
        .map((err) => err.location?.file && path.resolve(err.location.file))
        .filter((f) => f && f.startsWith(SAMPLES_DIR) && !excludeFiles.has(f)),
    )];
    if (!rejected.length) throw e; // not a sample-class problem — real failure
    for (const f of rejected) {
      excludeFiles.add(f);
      console.warn(`bundle: excluding ${path.relative(CAP_DIR, f)} (rejected by esbuild), retrying`);
    }
    registry = generateRegistryOrFail({ excludeFiles });
  }
}

// ---- 3. frontend ------------------------------------------------------------
const WEBAPP = path.join(CAP_DIR, "app", "z2ui5", "webapp");
fs.cpSync(WEBAPP, DIST, { recursive: true });

// ---- 4. index.html ----------------------------------------------------------
// The substitutions themselves live in patch-index.mjs (pure functions over
// strings, unit-tested there) — they are what stands between an upstream
// <head> change and a blank deploy, and each of them throws rather than
// leaving the shell half-patched.
const SITE_TITLE = "cap2UI5 — Browser Playground";
const SITE_DESCRIPTION = "Create UI5 apps purely in JavaScript";
const indexFile = path.join(DIST, "index.html");
fs.writeFileSync(
  indexFile,
  patchIndexHtml(fs.readFileSync(indexFile, "utf8"), { bundleName: BUNDLE_NAME, title: SITE_TITLE }),
);

const manifestFile = path.join(DIST, "manifest.json");
if (fs.existsSync(manifestFile)) {
  try {
    fs.writeFileSync(
      manifestFile,
      patchManifest(fs.readFileSync(manifestFile, "utf8"), { title: SITE_TITLE, description: SITE_DESCRIPTION }),
    );
  } catch (e) {
    // A malformed manifest is the frontend's problem, not the title patch's.
    console.warn(`manifest.json: title not patched (${e.message})`);
  }
}

// ---- 5. samples.html --------------------------------------------------------
// Without it the 100-odd bundled samples are reachable only by typing
// ?app_start=<class name> — you have to already know the catalogue to use it.
// Built from the registry (so only classes that actually shipped are listed)
// and from the overview app's own catalogue table (so the titles match what
// the running app shows).
{
  const shipped = registry.files
    .filter((f) => f.startsWith(SAMPLES_DIR))
    .map((f) => ({ app: path.basename(f, ".js"), repoPath: path.relative(CAP_DIR, f).split(path.sep).join("/") }));
  const overview = path.join(SAMPLES_DIR, "z2ui5_cl_smp_app_000.js");
  const catalog = fs.existsSync(overview) ? parseSampleCatalog(fs.readFileSync(overview, "utf8")) : new Map();
  const entries = sampleEntries(shipped, catalog);
  fs.writeFileSync(path.join(DIST, "samples.html"), renderSamplesPage(entries, { siteTitle: SITE_TITLE }));
  const titled = entries.filter((e) => e.title !== e.app).length;
  console.log(`web build: samples.html — ${entries.length} samples (${titled} with a catalogue title)`);
}

// GitHub Pages: serve folders starting with _ etc. as-is.
fs.writeFileSync(path.join(DIST, ".nojekyll"), "");

// A mistyped path otherwise lands on the generic GitHub Pages 404, which
// offers no way back into the app.
fs.writeFileSync(
  path.join(DIST, "404.html"),
  `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${SITE_TITLE} — not found</title>
  <meta http-equiv="refresh" content="3; url=./index.html">
  <style>
    body { font-family: system-ui, sans-serif; margin: 4rem auto; max-width: 34rem; padding: 0 1rem; }
    a { color: #0064d9; }
  </style>
</head>
<body>
  <h1>Not found</h1>
  <p>That page is not part of the cap2UI5 playground.</p>
  <p>Taking you <a href="./index.html">back to the app</a>&nbsp;… or browse
  <a href="./samples.html">all samples</a>.</p>
</body>
</html>
`,
);

// The deploy target (web-cap2UI5-build) is a pure artifact repo: everything
// in it is overwritten on every deploy. Without these two files it is a
// pile of generated code with no statement of what it is, who writes it or
// where to send a fix — every other repo in the ecosystem documents that.
fs.writeFileSync(
  path.join(DIST, "README.md"),
  `# web-cap2UI5-build

**This repository is a build artifact. Do not edit it — every deploy wipes
and rewrites it.**

The static, backend-less build of [cap2UI5](https://github.com/cap2UI5/cap2UI5),
served at <https://cap2ui5.github.io/web-cap2UI5-build/>. The whole framework
runs in the browser: roundtrips that would go to the CAP server are answered
in-process, drafts live in memory, and the tab is the session.

| | |
|---|---|
| Built by | [builder-cap2UI5-web](https://github.com/cap2UI5/builder-cap2UI5-web) |
| Built from | [cap2UI5/cap2UI5](https://github.com/cap2UI5/cap2UI5) — see \`BUILD_INFO.json\` for the exact commit |
| Report a problem | with the playground: [builder-cap2UI5-web](https://github.com/cap2UI5/builder-cap2UI5-web/issues) · with the framework: [cap2UI5](https://github.com/cap2UI5/cap2UI5/issues) |

Each commit here is one deployment; its message names the upstream commit it
was built from, so \`git log\` is the deployment history.
`,
);
const licenseSrc = path.join(ROOT_DIR, "LICENSE");
if (fs.existsSync(licenseSrc)) fs.copyFileSync(licenseSrc, path.join(DIST, "LICENSE"));

// BUILD_INFO.json — deployment marker served next to the site. CI's
// post-deploy verification polls it on the live URL to detect when the
// Pages deploy for a given upstream revision has actually gone live, and the
// publish step compares it byte-for-byte to decide whether to deploy at all —
// so everything in it must be a property of the inputs, never of the moment
// the build ran (see build-info.mjs). registry_count and the auto-excluded
// samples are recorded because they are what silently decides how much of the
// deployed site can actually be run.
const upstreamCommit = fs.readFileSync(path.join(CAP_DIR, "UPSTREAM_COMMIT"), "utf8").trim();
fs.writeFileSync(
  path.join(DIST, "BUILD_INFO.json"),
  buildInfoJson({
    upstreamCommit,
    registryCount: registry.count,
    excludedSamples: [...excludeFiles].map((f) => path.relative(CAP_DIR, f).split(path.sep).join("/")),
    // Unpinned bootstrap: this records which OpenUI5 a deploy actually got,
    // so "the live site broke and nothing here changed" is answerable. It is
    // the one value that can change without an input changing — which is a
    // legitimate change signal, and never an error string when the CDN is
    // simply unreachable.
    openui5Version: await resolveOpenUI5Version(),
  }),
);

// ---- 6. sanity-gate the shell ----------------------------------------------
// A broken bootstrap ships silently as a blank page (UI5 never loads), so
// assert the invariants the static shell needs before we call the build good.
// The HTML side of the gate is shellProblems() in patch-index.mjs (tested
// there); the file on disk can only be checked here.
{
  const { bootSrc, problems } = shellProblems(fs.readFileSync(indexFile, "utf8"), BUNDLE_NAME);
  if (!fs.existsSync(path.join(DIST, BUNDLE_NAME))) problems.push(`${BUNDLE_NAME} not emitted`);
  if (problems.length) {
    throw new Error(`web build: shell sanity check failed —\n  - ${problems.join("\n  - ")}`);
  }
  console.log(`web build: shell OK — UI5 from ${bootSrc}`);
}

// Report the sizes that matter, so the numbers quoted in the README can be
// checked against an actual build instead of drifting unnoticed. gzip is the
// honest figure: it is what GitHub Pages serves and what a visitor waits for.
{
  const bundleBytes = fs.statSync(path.join(DIST, BUNDLE_NAME)).size;
  const gzipBytes = zlib.gzipSync(fs.readFileSync(path.join(DIST, BUNDLE_NAME))).length;
  let siteBytes = 0;
  (function total(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) total(p);
      else siteBytes += fs.statSync(p).size;
    }
  })(DIST);
  const kb = (n) => `${Math.round(n / 1024)} KB`;
  console.log(`web build: ${BUNDLE_NAME} ${kb(bundleBytes)} (${kb(gzipBytes)} gzipped), site ${kb(siteBytes)}`);
}

console.log(`web build complete → ${path.relative(process.cwd(), DIST)}`);
