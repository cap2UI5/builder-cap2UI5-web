// The in-browser backend: everything that decides how a fetch call is
// answered, separated from the act of installing it on globalThis.
//
// It lives in its own module because the alternative is untestable. As part
// of entry.mjs this logic could only ever be exercised by driving a real
// browser through the Playwright smoke test — a slow, end-to-end check that
// tells you the page loaded, not that a Request-object POST is classified
// correctly or that an error maps onto the right status. Here it is ordinary
// functions over ordinary inputs.
//
// The only framework surface used is `abap2UI5/engine`, the platform-neutral
// seam every adapter targets. Earlier this file reached into framework
// classes directly, which broke when upstream renamed them — the engine
// facade is exactly the contract that does not move.

/** The endpoint the webapp posts roundtrips to (manifest dataSource uri). */
export const ROUNDTRIP_PATH = "/rest/root/z2ui5";

/**
 * Does this fetch call target the roundtrip endpoint?
 *
 * Matches on the trailing path so the interceptor still works when the site
 * is hosted under a subpath (GitHub Pages serves it under /web-cap2UI5-build/).
 * Accepts every shape fetch accepts: string, URL, Request.
 */
export function targetsRoundtrip(input) {
  let url = "";
  if (typeof input === "string") url = input;
  else if (typeof URL !== "undefined" && input instanceof URL) url = input.href;
  else if (input && typeof input.url === "string") url = input.url;
  const pathname = url.split(/[?#]/)[0];
  return pathname.endsWith(ROUNDTRIP_PATH);
}

/**
 * The HTTP method of a fetch call. The webapp calls fetch(url, {method}), but
 * a Request object carries its own — read both, or a
 * fetch(new Request(url, {method: "POST"})) is misread as a GET and falls
 * through to the network, where nothing is listening.
 */
export function methodOf(input, options = {}) {
  const isRequest = typeof Request !== "undefined" && input instanceof Request;
  return String(options.method || (isRequest ? input.method : "") || "GET").toUpperCase();
}

/** The request body, from the options bag or from a Request. */
export async function bodyOf(input, options = {}) {
  if (options.body != null) return options.body;
  if (typeof Request !== "undefined" && input instanceof Request) {
    try {
      return await input.clone().text();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * The AbortSignal of a fetch call, from the options bag or from a Request.
 *
 * Same trap as methodOf: fetch(new Request(url, {signal})) carries the signal
 * on the Request, not in the options.
 */
export function signalOf(input, options = {}) {
  if (options.signal) return options.signal;
  if (typeof Request !== "undefined" && input instanceof Request) return input.signal || undefined;
  return undefined;
}

/**
 * What an aborted call rejects with: the signal's own reason (a DOMException
 * "AbortError" for a plain controller.abort(), the caller's value when it
 * passed one), so the rejection is indistinguishable from a real fetch's.
 */
export function abortReason(signal) {
  return signal.reason ?? new Error("The operation was aborted.");
}

/**
 * Reject when the caller aborts, the way fetch does.
 *
 * The roundtrip itself cannot be cancelled — it is an in-process call into the
 * framework, with no request to tear down — but the caller's
 * promise MUST still reject, because that is the contract everything on top is
 * written against: a component that aborts a pending roundtrip on destroy, a
 * timeout wrapper, an AbortController-based test. Without this the abort was
 * simply ignored and the stale answer arrived anyway, minutes later, into a
 * view that had moved on.
 */
export function withAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * Run one roundtrip and shape the result like the HTTP response the CAP
 * server would have produced.
 *
 * @param engine  the abap2UI5 engine facade
 * @param rawBody the raw request body (JSON string)
 */
export async function handleRoundtrip(engine, rawBody) {
  let payload = {};
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    // Fall through with an empty body: the framework answers with its own
    // error payload, which the frontend renders in its error overlay. That
    // is more useful than a bare 400 the webapp has no handling for.
  }

  try {
    // The webapp wraps the body as { value: <oBody> }; accept a raw body too.
    const json = await engine.roundtrip(payload?.value ?? payload ?? {});
    return new Response(json, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    // Same wire format the served adapters use for a failed roundtrip.
    const text = e?.get_text?.() || e?.message || String(e);
    return new Response(`abap2UI5 Error:${text}`, { status: 500 });
  }
}

/**
 * Install the interceptor on globalThis.fetch.
 *
 * Idempotent: a double-loaded bundle would otherwise capture the ALREADY
 * patched fetch as its "native" one, and every roundtrip would recurse until
 * the stack blew. Cheap to guard, impossible to debug from the symptom.
 */
export function installFetchInterceptor(engine, target = globalThis) {
  if (target.__z2ui5_web_fetch_installed) return false;

  const nativeFetch = target.fetch.bind(target);

  target.fetch = async function (input, options = {}) {
    if (!targetsRoundtrip(input)) return nativeFetch(input, options);

    const method = methodOf(input, options);
    // Aborts are the caller's business on every path we answer ourselves;
    // the ones handed to nativeFetch are honoured by fetch itself.
    const signal = signalOf(input, options);
    if (signal?.aborted) throw abortReason(signal);

    // CSRF prefetch and the tab-close beacon — the same answer srv/server.js
    // gives. There is no server-side session to release here.
    if (method === "HEAD") {
      return new Response(null, { status: 200, headers: { "x-csrf-token": "disabled" } });
    }
    // GET on this path fetches the bootstrap page, which on this build is the
    // static index.html the browser already loaded — let it through.
    if (method !== "POST") return nativeFetch(input, options);

    return withAbort(handleRoundtrip(engine, await bodyOf(input, options)), signal);
  };

  target.__z2ui5_web_fetch_installed = true;
  return true;
}
