// Browser stub for node:async_hooks - the framework only needs
// AsyncLocalStorage, and only to isolate the user-exit HTTP context per
// request (z2ui5_cl_ui5_user_exit). A page is single-threaded and answers
// one roundtrip at a time, so a single current-store slot is an exact
// stand-in: run( ) sets it for the duration of the callback - kept alive
// until a returned promise settles, which covers the awaits inside one
// roundtrip - and restores the previous one after, the only nesting the
// framework produces. A read outside that window sees getStore( ) ===
// undefined, which routes the framework onto its static-context fallback.
// Shared byte-identical between builder-abap2UI5-js/adapters/web/shims/
// (the source) and builder-cap2UI5-web/stubs/ - see fs for why.
"use strict";

class AsyncLocalStorage {
  getStore() {
    return this._store;
  }

  run(store, fn, ...args) {
    const previous = this._store;
    this._store = store;
    let result;
    try {
      result = fn(...args);
    } catch (err) {
      this._store = previous;
      throw err;
    }
    if (result && typeof result.finally === "function") {
      return result.finally(() => {
        this._store = previous;
      });
    }
    this._store = previous;
    return result;
  }

  enterWith(store) {
    this._store = store;
  }

  exit(fn, ...args) {
    return this.run(undefined, fn, ...args);
  }
}

module.exports = { AsyncLocalStorage };
