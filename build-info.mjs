// BUILD_INFO.json — the deployment marker served next to the site.
//
// Its determinism is load-bearing, which is why it is assembled here rather
// than inline: build.yml compares the freshly built marker byte-for-byte
// against the deployed one to decide whether anything changed ("site
// unchanged — no deploy commit"), and the post-deploy verification polls the
// live marker for the upstream sha it just published. A timestamp, a build id
// or an error string in this file would make every rebuild look like a change
// and every wait for the deploy converge on the wrong thing. Nothing that is
// not a property of the inputs may go in.

// Which OpenUI5 the shipped shell actually loads. The bootstrap deliberately
// uses the unpinned cachebuster URL (see UI5_CDN_SRC), so the version is
// whatever the CDN serves on the day — and nothing recorded which one a given
// deploy got, so "the site broke and nothing changed here" could not be
// answered. This is the version endpoint of the SAME CDN origin the bootstrap
// points at; keep the two together.
const VERSION_URL = "https://sdk.openui5.org/resources/sap-ui-version.json";

// The build must not depend on the CDN being reachable: a firewalled runner,
// a CDN outage or an HTML error page must degrade to "version unknown", never
// to a failed build — and never to a recorded error, which would be a change
// signal for a site that did not change.
const VERSION_TIMEOUT_MS = 10000;

/**
 * The OpenUI5 version the cachebuster URL currently resolves to, or null when
 * it cannot be determined.
 *
 * @param fetchImpl injectable for the tests — the real one is Node's fetch
 */
export async function resolveOpenUI5Version(fetchImpl = fetch) {
  try {
    const res = await fetchImpl(VERSION_URL, { signal: AbortSignal.timeout(VERSION_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const version = (await res.json())?.version;
    // Only a real version string is worth recording; anything else (an HTML
    // error page, a proxy notice, a renamed field) is treated as unknown.
    return typeof version === "string" && /^\d+\.\d+\.\d+/.test(version) ? version : null;
  } catch (e) {
    console.warn(`BUILD_INFO: OpenUI5 version not recorded (${e.message})`);
    return null;
  }
}

/**
 * The marker's contents, as the text to write.
 *
 * `openui5_version` is OMITTED when unknown rather than written as null or an
 * error: an unreachable CDN must not rewrite the marker of an otherwise
 * unchanged site. `excluded_samples` is sorted so the same set always
 * serializes the same way.
 */
export function buildInfoJson({ upstreamCommit, registryCount, excludedSamples = [], openui5Version = null }) {
  return (
    JSON.stringify(
      {
        upstream_commit: upstreamCommit,
        registry_count: registryCount,
        excluded_samples: [...excludedSamples].sort(),
        ...(openui5Version ? { openui5_version: openui5Version } : {}),
      },
      null,
      2,
    ) + "\n"
  );
}
