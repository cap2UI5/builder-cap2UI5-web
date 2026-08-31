// Browser stub for node:crypto - maps the one API the framework uses onto
// the Web Crypto global (available in all browsers on secure origins and on
// localhost). Shared byte-identical between builder-abap2UI5-js/adapters/web/
// shims/ (the source) and builder-cap2UI5-web/stubs/ - see fs for why.
"use strict";
module.exports = {
  randomUUID: () => globalThis.crypto.randomUUID(),
};
