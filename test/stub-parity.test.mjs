// The four Node-builtin stubs under stubs/ are byte-identical copies of
// builder-abap2UI5-js/adapters/web/shims/*.js - ONE implementation for the
// two browser bundles of the ecosystem. The two sets grew separately once:
// same semantics, different gaps (a degenerate `relative` on one side, no
// `extname` on the other), which is exactly the state a framework change
// turns into a bug in whichever bundle kept the gap. The source repository
// is not mirrored here, so the comparison reads it from GitHub main - and
// when that is unreachable the test SKIPS and says so, because this
// repository's gate must not go red over an unreachable github.com and must
// not claim to have verified something it did not (the same rule
// abap2UI5's shared-file gate states for itself).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_REPO = "cap2UI5/builder-abap2UI5-js";
const RAW = (name) =>
  `https://raw.githubusercontent.com/${SOURCE_REPO}/main/adapters/web/shims/${name}.js`;
const STUBS = ["fs", "path", "crypto", "async_hooks"];

for (const name of STUBS) {
  test(`stubs/${name}.cjs is byte-identical to its source in ${SOURCE_REPO}`, async (t) => {
    let theirs;
    try {
      const res = await fetch(RAW(name), { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      theirs = await res.text();
    } catch (err) {
      t.skip(`source unreachable (${err.message}) - not compared, not verified`);
      return;
    }
    const mine = fs.readFileSync(path.join(ROOT, "stubs", `${name}.cjs`), "utf8");
    assert.equal(
      mine,
      theirs,
      `stubs/${name}.cjs has drifted from ${SOURCE_REPO} adapters/web/shims/${name}.js - `
        + "one implementation, two copies: change the source there first, then copy it here",
    );
  });
}
