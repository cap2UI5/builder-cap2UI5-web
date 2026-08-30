// Browser stub for node:fs.
//
// The framework's filesystem lookups (asset default provider, app-dir walks,
// class file resolution) must simply find nothing in the browser, so every
// lookup falls through to whatever the page installed instead - the injected
// asset provider, the class registry filled from the generated manifest.
//
// ONE implementation, TWO copies: builder-abap2UI5-js/adapters/web/shims/
// (the source) and builder-cap2UI5-web/stubs/ carry this file byte-identical,
// and builder-cap2UI5-web's stub-parity test is what notices a drift. The two
// grew separately once - same semantics, different gaps (a degenerate
// `relative` on one side, no `extname` on the other) - which is exactly the
// state a framework change turns into a bug in whichever bundle kept the gap.
"use strict";
module.exports = {
  existsSync: () => false,
  readdirSync: () => [],
  readFileSync: () => {
    throw new Error("fs.readFileSync is not available in the browser bundle");
  },
  statSync: () => {
    throw new Error("fs.statSync is not available in the browser bundle");
  },
};
