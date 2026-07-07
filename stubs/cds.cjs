// Browser stub for @sap/cds.
//
// The bundle never touches CDS at runtime: web/entry.mjs installs a custom
// draft store (z2ui5_cl_core_srv_draft.set_store) before the first
// roundtrip, so the only module that imports @sap/cds never reaches its CDS
// code path. Requiring the stub is therefore harmless — but any accidental
// use should fail loudly rather than silently misbehave.
module.exports = new Proxy(
  {},
  {
    get(_target, prop) {
      throw new Error(
        `@sap/cds is not available in the browser build (accessed cds.${String(prop)})`,
      );
    },
  },
);
