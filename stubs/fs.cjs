// Browser stub for node:fs.
//
// The framework's filesystem lookups (app-dir walks, class file resolution)
// must simply find nothing in the browser, so every lookup falls through to
// the class registry that web/entry.mjs fills from the generated manifest.
module.exports = {
  existsSync: () => false,
  readdirSync: () => [],
  readFileSync: () => {
    throw new Error("fs.readFileSync is not available in the browser build");
  },
};
