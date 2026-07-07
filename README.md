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

The **build web** workflow runs weekly (Sundays 03:00 UTC) and on demand
(`workflow_dispatch`): it mirrors the upstream repo, builds the site,
uploads it as the `cap2ui5-web` artifact and deploys it to GitHub Pages
(repo settings → Pages → Source **"GitHub Actions"**; the workflow enables
this automatically on first run where the token is allowed to).

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
holds only the tooling; the site itself lives in the Pages deployment.

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
