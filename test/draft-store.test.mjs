// Unit tests for the browser draft store.
//
// It replaces the CDS entity z2ui5_t_01 in the static build, and its bound
// FIFO is the only thing keeping a long-lived tab from growing without limit
// (one draft per roundtrip). The bound also silently caps how far back
// navigation can reach — worth pinning, since nothing else observes it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDraftStore } from "../draft-store.mjs";

test("saves and loads a draft by id", () => {
  const store = createDraftStore();
  store.save({ id: "a", id_prev: null, data: "{}" });
  assert.deepEqual(store.load("a"), { id: "a", id_prev: null, data: "{}" });
});

test("an unknown id loads as null, not undefined", () => {
  // The framework checks for a falsy entry; undefined would work by accident,
  // null is the documented contract shared with the server-side stores.
  assert.equal(createDraftStore().load("nope"), null);
});

test("re-saving the same id overwrites in place", () => {
  const store = createDraftStore();
  store.save({ id: "a", data: "first" });
  store.save({ id: "a", data: "second" });
  assert.equal(store.load("a").data, "second");
});

test("evicts oldest-first once the bound is reached", () => {
  const store = createDraftStore({ maxEntries: 3 });
  for (const id of ["a", "b", "c", "d"]) store.save({ id, data: id });

  assert.equal(store.load("a"), null, "oldest evicted");
  assert.equal(store.load("d").data, "d", "newest kept");
  assert.equal(store.load("b").data, "b");
  assert.equal(store.load("c").data, "c");
});

test("stays at the bound over a long session", () => {
  const store = createDraftStore({ maxEntries: 5 });
  for (let i = 0; i < 500; i++) store.save({ id: `id-${i}`, data: String(i) });

  // exactly the last 5 survive
  assert.equal(store.load("id-494"), null);
  for (let i = 495; i < 500; i++) assert.equal(store.load(`id-${i}`).data, String(i));
});

test("two stores do not share state", () => {
  // entry.mjs creates one per page load; a shared Map would leak drafts
  // across tests and, worse, make the bound global.
  const a = createDraftStore();
  const b = createDraftStore();
  a.save({ id: "x", data: "1" });
  assert.equal(b.load("x"), null);
});
