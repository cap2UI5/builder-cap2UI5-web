// Live-site smoke test — runs the exact same assertion suite as smoke.mjs,
// but against the deployed GitHub Pages site instead of a locally served
// dist/. No build state needed; only `npm ci` and a Playwright Chromium.
//
// Usage:
//   node live-smoke.mjs                      # tests the production site
//   SMOKE_URL=https://host/path node live-smoke.mjs   # tests any deployment
//
// The default target lives under a project subpath
// (https://cap2ui5.github.io/web-cap2UI5-build/) — runSmoke navigates
// relative to the base URL, and the bundle's fetch interceptor matches the
// trailing /rest/root/z2ui5 path, so the subpath is covered by design.
//
// Used by CI twice: build.yml's post-deploy verification (after the Pages
// deploy went live) and the daily health.yml cron, which catches breakage
// from new OpenUI5 CDN releases between deployments (the UI5 bootstrap is
// deliberately unpinned on current stable).

import { runSmoke } from "./smoke.mjs";

const LIVE_URL = "https://cap2ui5.github.io/web-cap2UI5-build/";
const base = (process.env.SMOKE_URL || LIVE_URL).replace(/\/+$/, "");

console.log(`live smoke against ${base}/ …`);
await runSmoke(base);
