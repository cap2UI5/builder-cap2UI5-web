// Unit tests for gen-registry's directory walk. The walk order is
// load-bearing: it mirrors the runtime's z2ui5_cl_util._walkClassFiles
// (top-level files first, then subdirectories) so that a top-level class
// shadows a nested duplicate of the same name — first hit wins. This was
// previously exercised only indirectly by the browser smoke test.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { walkClassFiles } from "../gen-registry.mjs";

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "regwalk-"));
  fs.writeFileSync(path.join(dir, "top_a.js"), "");
  fs.writeFileSync(path.join(dir, "top_b.js"), "");
  fs.writeFileSync(path.join(dir, "notes.txt"), ""); // non-js ignored
  fs.mkdirSync(path.join(dir, "sub"));
  fs.writeFileSync(path.join(dir, "sub", "nested_c.js"), "");
  fs.mkdirSync(path.join(dir, "sub", "deep"));
  fs.writeFileSync(path.join(dir, "sub", "deep", "deep_d.js"), "");
  return dir;
}

test("collects only .js files, top-level before subdirectories", () => {
  const dir = fixture();
  try {
    const files = walkClassFiles(dir).map((f) => path.relative(dir, f));
    assert.deepEqual(files, [
      "top_a.js",
      "top_b.js",
      path.join("sub", "nested_c.js"),
      path.join("sub", "deep", "deep_d.js"),
    ]);
    // the non-js file is excluded
    assert.ok(!files.some((f) => f.endsWith(".txt")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("returns an empty list for a missing directory", () => {
  assert.deepEqual(walkClassFiles(path.join(os.tmpdir(), "does-not-exist-regwalk")), []);
});
