# web-cap2UI5

[![build web](https://github.com/cap2UI5/web-cap2UI5/actions/workflows/build.yml/badge.svg)](https://github.com/cap2UI5/web-cap2UI5/actions/workflows/build.yml)

Runs the complete [cap2UI5](https://github.com/cap2UI5/cap2UI5) stack
**inside the browser**: the unchanged UI5 frontend plus the whole backend
(framework core + samples) bundled into a single JS file. Every roundtrip
is answered in-process — no CAP server, no Node.js, just static files on
GitHub Pages.

This is the cap2UI5 twin of
[abap2UI5-web](https://github.com/abap2UI5/abap2UI5-web) (the build behind
[web-abap2ui5-samples](https://github.com/abap2UI5/web-abap2ui5-samples)),
which bundles the abaplint-transpiled ABAP sources with `@abaplint/runtime`
and a WASM SQLite. cap2UI5's backend is already plain JavaScript, so this
build gets away with much less: no ABAP runtime, no WASM database — the
bundle is ~1.2 MB instead of ~12 MB.

Start a specific app exactly like on the CAP server:
`index.html?app_start=z2ui5_cl_demo_app_001`.

## How it works

```
Browser
├── index.html            unchanged UI5 shell (UI5 from CDN)
│   └── z2ui5-web.js      ← loaded BEFORE the UI5 bootstrap
├── Component.js, core/…  unchanged webapp (1:1 from cap2UI5/app/z2ui5)
│
│   the webapp still calls fetch("/rest/root/z2ui5", {method: "POST", …})
│   like it always does — but z2ui5-web.js has patched globalThis.fetch:
│
└── z2ui5-web.js (bundle)
    ├── fetch interceptor  POST/HEAD to */rest/root/z2ui5 → in-process call,
    │                      everything else → native fetch
    ├── z2ui5_cl_http_handler + core (srv/z2ui5, CAP-free)
    ├── all sample apps + built-ins (static registry, generated at build time)
    └── in-memory draft store (Map — the tab IS the session)
```

Three substitutions make the backend browser-able, using two additive hooks
that live in the cap2UI5 framework:

| Node/CAP | Browser | Hook |
|---|---|---|
| app classes resolved by walking `srv/` directories + `require()` | static registry generated at build time | `z2ui5_cl_util.register_app_class()` |
| drafts in the CDS entity `z2ui5_t_01` | in-memory `Map` | `z2ui5_cl_core_srv_draft.set_store()` |
| `@sap/cds`, `fs`, `path`, `crypto` | build-time stubs (`stubs/`) — unreachable at runtime once the hooks above are installed | esbuild `alias` |

## Build

The **build web** workflow runs on every push to `main`, weekly (Sundays
03:00 UTC, safety net) and on demand (`workflow_dispatch`): it mirrors the
upstream repo, builds the site, uploads it as the `cap2ui5-web` artifact
and publishes it to the dedicated build repo
[`cap2UI5/web-cap2UI5-built`](https://github.com/cap2UI5/web-cap2UI5-built).

The site is pushed to the `main` branch of `web-cap2UI5-built` — one commit
per deployment, carrying the upstream sha, the tooling sha and a link to the
workflow run. That push triggers the `deploy pages` workflow in
`web-cap2UI5-built`, which deploys the pushed site to GitHub Pages via
GitHub Actions (Settings → Pages → **Source** → **GitHub Actions**), so
pushing there *is* the deploy. That repo's history is the audit trail of what was actually
deployed: `git log` lists every deployment, `git diff <old>..<new>` shows
exactly which files changed between two of them. Identical rebuilds (e.g.
the weekly cron without upstream changes) add no commit. `web-cap2UI5-built`
is written only by this workflow — don't push to it by hand; this repo
(`web-cap2UI5`) holds only the tooling.

The cross-repo push uses an SSH **deploy key**: generate a keypair, register
the public half on `web-cap2UI5-built` (Settings → Deploy keys, **Allow
write access**) and store the private half here as the secret
`BUILT_DEPLOY_KEY` (Settings → Secrets and variables → Actions). This
mirrors the `ACTION_KEY_WEB` deploy key that cap2UI5 already uses to push
here.

Upstream changes arrive event-driven: after every update, the
`7_trigger_web` step of the sync pipeline in
[cap2UI5](https://github.com/cap2UI5/cap2UI5) writes the upstream sha to
`UPSTREAM_HEAD` and pushes it here via a deploy key registered on this
repository with write access (private half: secret `ACTION_KEY_WEB` in
cap2UI5) — that push starts this workflow. So the site follows every
cap2UI5 change instead of waiting for the weekly cron.

Locally:

```bash
npm install
npm run mirror    # snapshot cap2UI5/cap2UI5 → input/cap2UI5/
                  # (MIRROR_SOURCE=/path/to/checkout uses a local copy)
npm run build     # → dist/ (fully static site)
npm run serve     # local test server on http://localhost:8080
```

## Files

| | |
|---|---|
| `mirror.mjs` | shallow-clone (or copy) the upstream cap2UI5 repo → `input/cap2UI5/` |
| `entry.mjs` | browser entry: register classes, plug draft store, patch fetch |
| `gen-registry.mjs` | scans samples + built-ins → `generated/registry.mjs` (smoke-requires every candidate, skips broken ones — same policy as the upstream sync pipeline) |
| `build.mjs` | esbuild bundle + webapp copy + index.html patch → `dist/` |
| `draft-store.mjs` | in-memory Map store (FIFO-bounded) |
| `stubs/` | build-time stand-ins for `@sap/cds`, `fs`, `path`, `crypto` |
| `dev-server.mjs` | dependency-free static server for local testing |

`input/`, `generated/` and `dist/` are build state (gitignored) — the repo
holds only the tooling; the built site itself lives in
[`cap2UI5/web-cap2UI5-built`](https://github.com/cap2UI5/web-cap2UI5-built)
(its `main` branch, one commit per deployment) and is served from there via
GitHub Pages.

Two build details worth knowing:

- **`keepNames: true` is load-bearing.** Draft serialization keys on
  `oApp.constructor.name`; without it, minification renames classes and
  drafts cannot be restored.
- Samples that Node loads but esbuild's stricter scope analysis rejects
  (e.g. assignment to a `const`) are excluded from the registry
  automatically and reported in the build log.

## Limitations

- **Demo/playground artifact.** cap2UI5's security benefit — the view is
  built in the backend — obviously disappears when the backend ships to the
  client. Use it for live samples, docs, zero-install demos; not as a
  production topology.
- **Drafts live in the tab.** Reload = fresh session (matching the
  session-scoped draft design). Back-navigation depth is bounded by the
  store's FIFO limit.
- **Server-only features are off.** The Northwind external-service sample
  needs a CORS-reachable endpoint; anything relying on CAP services,
  destinations or real persistence won't work.
- **UI5 comes from the CDN** (same as the CAP-served app) — the page needs
  internet access even though the backend doesn't.
