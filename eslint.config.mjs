// ESLint flat config for the browser-build tooling (this repo is
// "type": "module", so the config itself is ESM). Generated/mirrored trees
// (input/, generated/, dist/) and node_modules are excluded.
import js from "@eslint/js";

// WHATWG fetch globals. In the page they are the browser's; under Node they
// have been built in since 18. Both the interceptor and its node:test suite
// use them, so they are shared rather than duplicated per scope.
const fetchGlobals = {
  fetch: "readonly",
  Response: "readonly",
  Request: "readonly",
  Headers: "readonly",
  URL: "readonly",
  AbortController: "readonly",
  AbortSignal: "readonly",
};

const nodeGlobals = {
  // fetch and AbortSignal are built into Node since 18 — build.mjs probes the
  // OpenUI5 CDN for the version it records in BUILD_INFO.json.
  fetch: "readonly",
  AbortSignal: "readonly",
  process: "readonly",
  __dirname: "readonly",
  __filename: "readonly",
  console: "readonly",
  Buffer: "readonly",
  URL: "readonly",
  globalThis: "readonly",
  setTimeout: "readonly",
};

export default [
  { ignores: ["input/**", "generated/**", "dist/**", "node_modules/**"] },
  js.configs.recommended,
  {
    // ESM build tooling (Node).
    files: ["*.mjs"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: nodeGlobals },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
  {
    // The browser entry and the interceptor it installs run in the page,
    // not in Node — except roundtrip.mjs, which is also exercised directly
    // by the node:test suite.
    files: ["entry.mjs", "roundtrip.mjs", "draft-store.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...fetchGlobals,
        window: "readonly",
        document: "readonly",
        globalThis: "readonly",
        console: "readonly",
      },
    },
  },
  {
    // Browser stubs (CommonJS).
    files: ["stubs/**/*.cjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: { module: "writable", require: "readonly", globalThis: "readonly", Buffer: "readonly" },
    },
  },
  {
    // Playwright smoke scripts: Node scripts that also contain
    // page.evaluate(() => …) callbacks executed in the browser, so they
    // reference browser globals that are legitimately defined at run time.
    files: ["smoke.mjs", "live-smoke.mjs"],
    languageOptions: {
      globals: {
        ...nodeGlobals,
        window: "readonly",
        document: "readonly",
        fetch: "readonly",
        location: "readonly",
      },
    },
  },
  {
    // node:test suites.
    files: ["test/**/*.mjs"],
    languageOptions: { sourceType: "module", globals: { ...nodeGlobals, ...fetchGlobals } },
  },
];
