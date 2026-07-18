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
//   2. plug the in-memory draft store into z2ui5_cl_core_srv_draft
//      (replaces the CDS entity z2ui5_t_01)
//   3. install the fetch interceptor
//
// This module is bundled by build.mjs and loaded by dist/index.html BEFORE
// the UI5 bootstrap, so the interceptor is guaranteed to be in place when
// the component fires its initial roundtrip.

// Resolved by build.mjs' abap2ui5-self-reference plugin (package-name
// imports, matched by class basename over core/srv) — no coupling to the
// upstream directory layout.
import z2ui5_cl_util from "abap2UI5/z2ui5_cl_util";
import z2ui5_cl_core_srv_draft from "abap2UI5/z2ui5_cl_core_srv_draft";
import z2ui5_cl_http_handler from "abap2UI5/z2ui5_cl_http_handler";
import registry from "./generated/registry.mjs";
import { createDraftStore } from "./draft-store.mjs";

// 1. App classes — the generated manifest of the bundled samples (core/srv/app/samples)
//    plus the framework built-ins (startup app, hello world, popups).
for (const [name, Cls] of Object.entries(registry)) {
  z2ui5_cl_util.register_app_class(name, Cls);
}

// 2. Draft persistence — in-memory, session == browser tab.
z2ui5_cl_core_srv_draft.set_store(createDraftStore());

// 3. Fetch interceptor. The endpoint is the manifest's dataSource uri
//    ("/rest/root/z2ui5"); match on the trailing path so the interceptor
//    also works when the site is hosted under a subpath (GitHub Pages).
const ROUNDTRIP_PATH = "/rest/root/z2ui5";
const nativeFetch = globalThis.fetch.bind(globalThis);

function targetsRoundtrip(input) {
  let url = "";
  if (typeof input === "string") url = input;
  else if (input instanceof URL) url = input.href;
  else if (input && typeof input.url === "string") url = input.url;
  const pathname = url.split(/[?#]/)[0];
  return pathname.endsWith(ROUNDTRIP_PATH);
}

globalThis.fetch = async function (input, options = {}) {
  if (!targetsRoundtrip(input)) {
    return nativeFetch(input, options);
  }

  const method = (options.method || "GET").toUpperCase();

  // CSRF prefetch / sap-terminate ack — same answer srv/server.js gives.
  if (method === "HEAD") {
    return new Response(null, {
      status: 200,
      headers: { "x-csrf-token": "disabled" },
    });
  }
  if (method !== "POST") {
    return nativeFetch(input, options);
  }

  // The frontend sends { value: <oBody> }; the handler unwraps
  // req.data.value itself — pass the parsed body through as req.data.
  let payload = {};
  try {
    payload = options.body ? JSON.parse(options.body) : {};
  } catch {
    // fall through with an empty body — the handler answers with its own
    // error payload, which the frontend renders in the error overlay
  }

  try {
    const result = await z2ui5_cl_http_handler({ data: payload });
    // The handler's error path returns { body, status_code, status_reason }
    // instead of the parsed wire payload — map it onto the HTTP status the
    // CAP runtime would have produced.
    if (result && typeof result === "object" && "status_code" in result) {
      return new Response(String(result.body ?? ""), {
        status: result.status_code || 500,
      });
    }
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(`abap2UI5 Error:${e?.message || e}`, { status: 500 });
  }
};

console.log(
  `cap2UI5 web: in-browser backend active — ${Object.keys(registry).length} app classes registered, roundtrips to *${ROUNDTRIP_PATH} are served client-side`,
);
