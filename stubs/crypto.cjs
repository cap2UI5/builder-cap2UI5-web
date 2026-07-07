// Browser stub for node:crypto — maps the one API the framework uses onto
// the Web Crypto global (available in all browsers on secure origins and
// on localhost).
module.exports = {
  randomUUID: () => globalThis.crypto.randomUUID(),
};
