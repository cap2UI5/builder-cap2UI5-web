// Browser entry point of the cap2UI5 web build.
//
// Mirrors the concept of abap2UI5-web (the build behind
// web-abap2ui5-samples): the unchanged UI5 frontend keeps doing its normal
// `fetch(url, { method: "POST", body })` roundtrip, but fetch calls that
// target the z2ui5 endpoint are intercepted and answered by the bundled
// backend in-process — no server involved. Everything else (UI5 CDN,
// manifest.json, i18n, css) passes through to the native fetch.
//
// Three things have to happen before the first roundtrip:
//   1. register all app classes (the browser has no filesystem, so the
//      framework's directory walk finds nothing — the registry generated
//      by gen-registry.mjs replaces it)
//   2. plug the in-memory draft store in (replaces the CDS entity z2ui5_t_01)
//   3. install the fetch interceptor
//
// This module is bundled by build.mjs and loaded by dist/index.html BEFORE
// the UI5 bootstrap, so the interceptor is guaranteed to be in place when
// the component fires its initial roundtrip.
//
// Everything below goes through `abap2UI5/engine` — the platform-neutral
// seam the CAP, express and node adapters also target. This build used to
// import framework classes directly and broke when upstream renamed them;
// the engine facade is the part that is contractually stable. The decision
// logic itself lives in roundtrip.mjs so it can be unit-tested without a
// browser.

// Resolved by build.mjs' abap2ui5-self-reference plugin (package-name
// imports, matched by class basename over core/srv) — no coupling to the
// upstream directory layout.
import engine from "abap2UI5/engine";
import registry from "./generated/registry.mjs";
import { createDraftStore } from "./draft-store.mjs";
import { installFetchInterceptor, ROUNDTRIP_PATH } from "./roundtrip.mjs";

// 1. App classes — the generated manifest of the bundled samples (core/srv/app/samples)
//    plus the framework built-ins (startup app, hello world, popups).
for (const [name, Cls] of Object.entries(registry)) {
  engine.register_app_class(name, Cls);
}

// 2. Draft persistence — in-memory, session == browser tab.
engine.set_store(createDraftStore());

// 3. Fetch interceptor.
installFetchInterceptor(engine);

console.log(
  `cap2UI5 web: in-browser backend active — ${Object.keys(registry).length} app classes registered, roundtrips to *${ROUNDTRIP_PATH} are served client-side`,
);
