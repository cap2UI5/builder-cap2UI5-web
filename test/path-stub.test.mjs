// Unit tests for the hand-rolled browser stub of node:path (stubs/path.cjs).
// The framework's directory walks feed fs lookups that always miss in the
// browser, so only string-level correctness matters — but that correctness is
// load-bearing (a wrong join/relative changes which module a require resolves
// to), and it was previously untested. We assert the stub matches Node's own
// path.posix for the call shapes the framework uses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const stub = require("../stubs/path.cjs");
const posix = path.posix;

test("join matches posix for common shapes", () => {
  const cases = [
    ["a", "b", "c"],
    ["/a", "b", "c.js"],
    ["a/", "/b"],
    ["a", "..", "b"],
    ["/a/b", "../c"],
    ["a", ".", "b"],
    ["core", "srv", "z2ui5", "02", "z2ui5_cl_app_hello_world.js"],
  ];
  for (const c of cases) assert.equal(stub.join(...c), posix.join(...c), `join(${c})`);
});

test("normalize matches posix (no trailing slash)", () => {
  for (const p of ["a/./b/../c", "../a/b", "a/b/c/..", "/"]) {
    assert.equal(stub.normalize(p), posix.normalize(p), `normalize(${p})`);
  }
});

test("normalize intentionally drops trailing slashes", () => {
  // The stub never preserves a trailing slash (posix.normalize would). Harmless
  // for the framework — normalized paths only feed basename/require lookups.
  assert.equal(stub.normalize("/a//b/"), "/a/b");
});

test("basename and dirname match posix", () => {
  for (const p of ["/a/b/c.js", "c.js", "/a/b/", "a/b/c"]) {
    assert.equal(stub.basename(p), posix.basename(p), `basename(${p})`);
    assert.equal(stub.basename(p, ".js"), posix.basename(p, ".js"), `basename(${p}, .js)`);
    assert.equal(stub.dirname(p), posix.dirname(p), `dirname(${p})`);
  }
});

test("relative matches posix for absolute pairs", () => {
  const cases = [
    ["/a/b/c", "/a/b/d"],
    ["/a/b", "/a/b/c/d"],
    ["/a/b/c/d", "/a/b"],
  ];
  for (const [from, to] of cases) {
    assert.equal(stub.relative(from, to), posix.relative(from, to), `relative(${from}, ${to})`);
  }
  // Identical paths: the stub returns "." where posix returns "" — either
  // resolves to the same directory for the framework's require() lookups.
  assert.equal(stub.relative("/a/b", "/a/b"), ".");
});

test("exposes posix separators", () => {
  assert.equal(stub.sep, "/");
  assert.equal(stub.delimiter, ":");
});
