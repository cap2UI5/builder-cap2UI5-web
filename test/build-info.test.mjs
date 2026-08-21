// Unit tests for the deployment marker.
//
// BUILD_INFO.json is the only file in dist/ whose exact bytes are load-bearing
// for the pipeline rather than for the browser: build.yml compares it against
// the deployed copy to decide whether to publish at all, and the post-deploy
// verification polls the live copy for the sha it just pushed. Anything that
// varies without an input varying (a timestamp, a build id, an error message
// from an unreachable CDN) turns every rebuild into a deploy and every wait
// into a wait for the wrong thing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveOpenUI5Version, buildInfoJson } from "../build-info.mjs";

const SHA = "b5745a8871a8b4e5b0dcf7c0a9c9a1a4f7a0b111";

test("the marker is deterministic — same inputs, same bytes", () => {
  const args = {
    upstreamCommit: SHA,
    registryCount: 110,
    excludedSamples: ["core/srv/app/samples/z2ui5_cl_smp_app_020.js"],
    openui5Version: "1.140.0",
  };
  assert.equal(buildInfoJson(args), buildInfoJson({ ...args }));
  // …and the excluded set serializes identically whatever order it arrived in
  assert.equal(
    buildInfoJson({ ...args, excludedSamples: ["b.js", "a.js"] }),
    buildInfoJson({ ...args, excludedSamples: ["a.js", "b.js"] }),
  );
});

test("the marker records what decides the deployed site's contents", () => {
  const info = JSON.parse(
    buildInfoJson({ upstreamCommit: SHA, registryCount: 110, excludedSamples: ["x.js"], openui5Version: "1.140.0" }),
  );
  assert.deepEqual(info, {
    upstream_commit: SHA,
    registry_count: 110,
    excluded_samples: ["x.js"],
    openui5_version: "1.140.0",
  });
});

test("an unknown OpenUI5 version is OMITTED, not written as null or an error", () => {
  // A firewalled runner must not rewrite the marker of an unchanged site.
  const info = JSON.parse(buildInfoJson({ upstreamCommit: SHA, registryCount: 110 }));
  assert.ok(!("openui5_version" in info));
  assert.deepEqual(info, { upstream_commit: SHA, registry_count: 110, excluded_samples: [] });
});

test("the version probe degrades to null on every failure shape", async () => {
  const cases = [
    () => Promise.reject(new Error("getaddrinfo ENOTFOUND")), // no network
    () => ({ ok: false, status: 403, json: async () => ({}) }), // proxy/CDN says no
    () => ({ ok: true, json: async () => { throw new Error("not JSON"); } }), // HTML error page
    () => ({ ok: true, json: async () => ({}) }), // renamed field
    () => ({ ok: true, json: async () => ({ version: "unknown" }) }), // not a version
  ];
  for (const fetchImpl of cases) {
    assert.equal(await resolveOpenUI5Version(fetchImpl), null);
  }
});

test("a real version answer is recorded as-is", async () => {
  const version = await resolveOpenUI5Version(async () => ({ ok: true, json: async () => ({ version: "1.140.0" }) }));
  assert.equal(version, "1.140.0");
});
