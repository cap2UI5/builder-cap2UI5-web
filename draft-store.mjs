// In-memory draft store for the browser build.
//
// Implements the z2ui5_cl_core_srv_draft.set_store contract:
//   load(id)                    → { id, id_prev, data } | null
//   save({ id, id_prev, data }) → void
//
// Drafts in abap2UI5/cap2UI5 are session-scoped by design (the CAP server
// keeps them in an in-memory SQLite, the ABAP original deletes them after a
// few hours). In the browser the tab IS the session, so a plain Map is the
// natural equivalent — a reload starts a fresh session, exactly like
// closing and reopening a served app.
//
// maxEntries bounds memory: every roundtrip inserts one draft, so a
// long-lived tab would otherwise grow without limit. Eviction is FIFO
// (Map preserves insertion order); evicting old drafts only limits how far
// back-navigation can reach, which matches the ABAP original's cleanup job.
export function createDraftStore({ maxEntries = 500 } = {}) {
  const drafts = new Map();
  return {
    load(id) {
      return drafts.get(id) || null;
    },
    save(entry) {
      drafts.set(entry.id, entry);
      while (drafts.size > maxEntries) {
        drafts.delete(drafts.keys().next().value);
      }
    },
  };
}
