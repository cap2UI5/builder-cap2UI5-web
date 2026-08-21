// Unit tests for the in-browser backend's request handling.
//
// This is the load-bearing logic of the whole build: it decides which fetch
// calls the bundled framework answers and which go to the network. Until it
// was extracted into roundtrip.mjs the only thing exercising it was the
// Playwright smoke test — which proves the page loads, and nothing about the
// cases below. Every one of them is a way for the playground to break while
// still rendering fine on the happy path.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ROUNDTRIP_PATH,
  targetsRoundtrip,
  methodOf,
  bodyOf,
  signalOf,
  handleRoundtrip,
  installFetchInterceptor,
} from "../roundtrip.mjs";

// A stand-in for abap2UI5/engine — the seam entry.mjs passes in.
function fakeEngine({ throws = null, echo = false } = {}) {
  const calls = [];
  return {
    calls,
    async roundtrip(oBody) {
      calls.push(oBody);
      if (throws) throw throws;
      return JSON.stringify(echo ? oBody : { S_FRONT: { APP: "x" } });
    },
  };
}

test("targetsRoundtrip accepts every shape fetch accepts", () => {
  assert.equal(targetsRoundtrip(ROUNDTRIP_PATH), true);
  assert.equal(targetsRoundtrip(new URL(`http://h${ROUNDTRIP_PATH}`)), true);
  assert.equal(targetsRoundtrip(new Request(`http://h${ROUNDTRIP_PATH}`)), true);
});

test("targetsRoundtrip matches under a hosting subpath", () => {
  // GitHub Pages serves the site from /web-cap2UI5-build/ — matching the
  // full path instead of the suffix would silently disable the interceptor
  // in the one deployment that matters.
  assert.equal(targetsRoundtrip(`/web-cap2UI5-build${ROUNDTRIP_PATH}`), true);
  assert.equal(targetsRoundtrip(`https://x.github.io/a/b${ROUNDTRIP_PATH}?sap-ui=1`), true);
});

test("targetsRoundtrip ignores everything else", () => {
  for (const url of [
    "/manifest.json",
    "https://sdk.openui5.org/resources/sap-ui-core.js",
    "/i18n/i18n.properties",
    "",
  ]) {
    assert.equal(targetsRoundtrip(url), false, url);
  }
});

test("the query string does not defeat the match", () => {
  assert.equal(targetsRoundtrip(`${ROUNDTRIP_PATH}?app_start=z2ui5_cl_smp_app_000`), true);
  assert.equal(targetsRoundtrip(`${ROUNDTRIP_PATH}#frag`), true);
});

test("methodOf reads the method off a Request, not just the options bag", () => {
  // fetch(new Request(url, {method:"POST"})) used to be read as a GET and
  // fell through to the network, where nothing answers.
  assert.equal(methodOf(new Request("http://h/x", { method: "POST" })), "POST");
  assert.equal(methodOf("http://h/x", { method: "post" }), "POST");
  assert.equal(methodOf("http://h/x"), "GET");
  // an explicit option wins over the Request's own method
  assert.equal(methodOf(new Request("http://h/x", { method: "POST" }), { method: "HEAD" }), "HEAD");
});

test("bodyOf reads the body from either shape", async () => {
  assert.equal(await bodyOf("http://h/x", { body: '{"a":1}' }), '{"a":1}');
  assert.equal(await bodyOf(new Request("http://h/x", { method: "POST", body: '{"b":2}' })), '{"b":2}');
  assert.equal(await bodyOf("http://h/x"), undefined);
});

test("a roundtrip unwraps the { value } envelope the webapp sends", async () => {
  const engine = fakeEngine({ echo: true });
  const res = await handleRoundtrip(engine, JSON.stringify({ value: { S_FRONT: { ID: "7" } } }));

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/json");
  assert.deepEqual(engine.calls[0], { S_FRONT: { ID: "7" } });
});

test("a raw (unwrapped) body is accepted too", async () => {
  const engine = fakeEngine({ echo: true });
  await handleRoundtrip(engine, JSON.stringify({ S_FRONT: { ID: "7" } }));
  assert.deepEqual(engine.calls[0], { S_FRONT: { ID: "7" } });
});

test("a malformed body still reaches the framework", async () => {
  // The framework answers with its own error payload, which the frontend
  // renders in the error overlay — more useful than a bare 400 the webapp
  // has no handling for.
  const engine = fakeEngine();
  const res = await handleRoundtrip(engine, "{not json");
  assert.equal(res.status, 200);
  assert.deepEqual(engine.calls[0], {});
});

test("a thrown ABAP exception becomes the 500 wire format", async () => {
  const abapError = { get_text: () => "SOMETHING_WENT_WRONG" };
  const res = await handleRoundtrip(fakeEngine({ throws: abapError }), "{}");
  assert.equal(res.status, 500);
  assert.equal(await res.text(), "abap2UI5 Error:SOMETHING_WENT_WRONG");
});

test("a plain JS error becomes the same wire format", async () => {
  const res = await handleRoundtrip(fakeEngine({ throws: new Error("boom") }), "{}");
  assert.equal(res.status, 500);
  assert.equal(await res.text(), "abap2UI5 Error:boom");
});

// ---- the installed interceptor -------------------------------------------

function fakeTarget() {
  const passedThrough = [];
  return {
    passedThrough,
    fetch: async (input, options) => {
      passedThrough.push({ input, options });
      return new Response("from network", { status: 200 });
    },
  };
}

test("HEAD is answered locally with the CSRF ack", async () => {
  const target = fakeTarget();
  installFetchInterceptor(fakeEngine(), target);

  const res = await target.fetch(ROUNDTRIP_PATH, { method: "HEAD" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-csrf-token"), "disabled");
  assert.equal(target.passedThrough.length, 0);
});

test("POST is answered locally, everything else goes to the network", async () => {
  const engine = fakeEngine();
  const target = fakeTarget();
  installFetchInterceptor(engine, target);

  await target.fetch(ROUNDTRIP_PATH, { method: "POST", body: "{}" });
  assert.equal(engine.calls.length, 1);
  assert.equal(target.passedThrough.length, 0);

  // GET on the endpoint fetches the bootstrap page — already loaded statically.
  await target.fetch(ROUNDTRIP_PATH, { method: "GET" });
  await target.fetch("/manifest.json");
  assert.equal(engine.calls.length, 1);
  assert.equal(target.passedThrough.length, 2);
});

test("signalOf reads the signal off a Request, not just the options bag", () => {
  const ac = new AbortController();
  assert.equal(signalOf("http://h/x", { signal: ac.signal }), ac.signal);
  assert.equal(signalOf("http://h/x"), undefined);

  // A Request does not hand back the signal it was given but a derived one,
  // so the identity cannot be compared — the abort travelling through it can.
  const fromRequest = signalOf(new Request("http://h/x", { signal: ac.signal }));
  assert.equal(fromRequest.aborted, false);
  ac.abort();
  assert.equal(fromRequest.aborted, true);
});

test("an already aborted call is rejected, not answered", async () => {
  const engine = fakeEngine();
  const target = fakeTarget();
  installFetchInterceptor(engine, target);

  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() => target.fetch(ROUNDTRIP_PATH, { method: "POST", body: "{}", signal: ac.signal }));
  // and the framework was never entered
  assert.equal(engine.calls.length, 0);
});

test("aborting a pending roundtrip rejects the caller's promise", async () => {
  // The in-process call cannot be cancelled, but the caller MUST see the
  // abort: a component that aborts on destroy, a timeout wrapper or a test
  // with an AbortController would otherwise wait forever and then be handed
  // an answer for a view that has moved on.
  let release;
  const engine = {
    calls: [],
    roundtrip: () => new Promise((resolve) => (release = () => resolve(JSON.stringify({ S_FRONT: {} })))),
  };
  const target = fakeTarget();
  installFetchInterceptor(engine, target);

  const ac = new AbortController();
  const pending = target.fetch(ROUNDTRIP_PATH, { method: "POST", body: "{}", signal: ac.signal });
  ac.abort();
  await assert.rejects(() => pending, (e) => e.name === "AbortError");
  release(); // the late answer must not turn into an unhandled rejection
});

test("a roundtrip without a signal is unaffected", async () => {
  const engine = fakeEngine();
  const target = fakeTarget();
  installFetchInterceptor(engine, target);

  const res = await target.fetch(ROUNDTRIP_PATH, { method: "POST", body: "{}" });
  assert.equal(res.status, 200);
  assert.equal(engine.calls.length, 1);
});

test("installing twice does not wrap the patched fetch", async () => {
  // Without the guard a double-loaded bundle captures the ALREADY patched
  // fetch as its "native" one and every roundtrip recurses forever — a
  // hang with no useful stack.
  const engine = fakeEngine();
  const target = fakeTarget();

  assert.equal(installFetchInterceptor(engine, target), true);
  const afterFirst = target.fetch;
  assert.equal(installFetchInterceptor(engine, target), false);
  assert.equal(target.fetch, afterFirst);

  const res = await target.fetch(ROUNDTRIP_PATH, { method: "POST", body: "{}" });
  assert.equal(res.status, 200);
  assert.equal(engine.calls.length, 1);
});
