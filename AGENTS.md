# AGENTS.md — builder-cap2UI5-web

Guidance for AI agents and contributors. Read before making any change.

## What this repo is

The **browser build tooling** for cap2UI5: it mirrors the deployable app
repo [cap2UI5/cap2UI5](https://github.com/cap2UI5/cap2UI5), bundles the
whole backend (framework core + samples) plus the unchanged UI5 frontend
into a static site, and pushes the result to
[web-cap2UI5-build](https://github.com/cap2UI5/web-cap2UI5-build), which
serves it on GitHub Pages (https://cap2ui5.github.io/web-cap2UI5-build/).
Every z2ui5 roundtrip is answered in-process in the browser — no server.

This repo was formerly named `web-cap2UI5`. It holds ONLY tooling: `input/`,
`generated/` and `dist/` are gitignored build state; the built site lives in
web-cap2UI5-build (one commit per deployment).

## Upstream layout (ground truth since the monorepo split, 2026-07)

The mirrored cap2UI5 repo is the app at the **repo root**, with the
framework **vendored at `core/`** (npm package `abap2UI5`):

- framework classes: `core/srv/z2ui5/` (built-ins in `02/`, + `02/01/`)
- bundled samples (flat): `core/srv/app/samples/`
- the app's own custom apps: `srv/app/` (server-only ones like
  `z2ui5_cl_app_read_odata` fail the smoke-require and are skipped — correct)
- webapp: `app/z2ui5/webapp/`
- `paths.mjs`: `CAP_DIR` = the snapshot root (`input/cap2UI5`)

## Files

| File | Role |
|---|---|
| `mirror.mjs` | clone/copy the app repo → `input/cap2UI5/` (whole root, minus `.git`/`.github`/`node_modules`); `MIRROR_SOURCE=/path` uses a local checkout |
| `gen-registry.mjs` | smoke-requires every candidate class (anchor: `core/package.json`, so `abap2UI5/...` requires resolve via its exports map) → `generated/registry.mjs` |
| `build.mjs` | esbuild bundle (resolves `abap2UI5/*` by basename over `core/srv`), webapp copy, index.html patch (bundle before UI5 bootstrap, UI5 from CDN) → `dist/` |
| `entry.mjs` | browser entry: register classes, in-memory draft store, fetch interceptor for `*/rest/root/z2ui5` |
| `stubs/` | build-time stand-ins for `@sap/cds`, `fs`, `path`, `crypto` |
| `dev-server.mjs` | local static server (`npm run serve`, port 8080) |

Build locally: `npm ci && npm run mirror && npm run build && npm run serve`.
`npm run smoke` opens `dist/` in headless Chromium (Playwright) and asserts
the shell actually renders (bundle active, UI5 booted, startup roundtrip
answered) — CI runs it before every deploy. Sourcemaps are not emitted by
default (2 MB per deploy, publishes the full sources); `WEB_SOURCEMAP=1`
opts in locally.

## Invariants

- **`keepNames: true` is load-bearing** (draft serialization keys on
  `constructor.name`).
- Samples that Node loads but esbuild rejects are auto-excluded and the
  bundle retried — that loop only ever removes sample files.
- The registry walk order mirrors the runtime discovery (built-ins →
  bundled samples → `srv/app`), first hit per class name wins.

## Trigger / deploy chain

cap2UI5:`trigger_web` (manual) writes this repo's `UPSTREAM_HEAD` via deploy
key (`ACTION_KEY_WEB` there) → push starts `build web` here (also: weekly
cron + manual) → build → push `dist/` to web-cap2UI5-build via
`BUILT_DEPLOY_KEY` → its `deploy pages` workflow deploys to GitHub Pages.
Never push to web-cap2UI5-build by hand.
