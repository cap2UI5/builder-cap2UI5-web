// Browser stub for node:async_hooks — z2ui5_cl_exit uses AsyncLocalStorage
// to isolate the per-request HTTP context between interleaved roundtrips on
// the CAP server. The static site serves one user in one tab, so a real
// async-context implementation is not needed: run() keeps the store active
// until the wrapped promise settles (roundtrips do not interleave here), and
// any read outside that window sees getStore() === undefined, which routes
// the framework onto its static-context fallback path.
class AsyncLocalStorage {
  constructor() {
    this._store = undefined;
  }

  getStore() {
    return this._store;
  }

  run(store, fn, ...args) {
    const prev = this._store;
    this._store = store;
    let result;
    try {
      result = fn(...args);
    } catch (e) {
      this._store = prev;
      throw e;
    }
    if (result && typeof result.finally === "function") {
      return result.finally(() => {
        this._store = prev;
      });
    }
    this._store = prev;
    return result;
  }
}

module.exports = { AsyncLocalStorage };
