// Unit tests for the sample landing page.
//
// The titles on that page are read out of a GENERATED file (the overview
// app's catalogue table) with a regex — a liberty that has to stay honest in
// both directions: when the table matches, every link and title must be built
// from it; when it stops matching, the page must degrade to class names
// rather than fail the build or invent a title.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSampleCatalog, sampleEntries, renderSamplesPage } from "../samples-page.mjs";

// Verbatim shape of two entries as the transpiler emits them in
// core/srv/app/samples/z2ui5_cl_smp_app_000.js.
const OVERVIEW_SOURCE = `
  get_catalog() {
    result = z2ui5_cl_util.abap_tab_assign(result, [{ group: \`samples\`, header: \`Table\`, sub: \`Editable Cells, Add and Delete Rows\`, keywords: \`edit input add row delete\`, path: \`src/01\`, app: \`z2ui5_cl_smp_app_011\` }, { group: \`samples\`, header: \`Basics I\`, sub: \`Hello World, the Smallest App\`, keywords: \`hello world minimal\`, path: \`src/01\`, app: \`z2ui5_cl_smp_app_493\` }]);
    return result;
  }
`;

const shipped = [
  { app: "z2ui5_cl_smp_app_011", repoPath: "core/srv/app/samples/z2ui5_cl_smp_app_011.js" },
  { app: "z2ui5_cl_smp_app_493", repoPath: "core/srv/app/samples/z2ui5_cl_smp_app_493.js" },
  { app: "z2ui5_cl_smp_app_112", repoPath: "core/srv/app/samples/z2ui5_cl_smp_app_112.js" },
];

test("the catalogue is read out of the overview app's own table", () => {
  const catalog = parseSampleCatalog(OVERVIEW_SOURCE);
  assert.equal(catalog.size, 2);
  assert.deepEqual(catalog.get("z2ui5_cl_smp_app_011"), {
    group: "samples",
    header: "Table",
    sub: "Editable Cells, Add and Delete Rows",
    keywords: "edit input add row delete",
    path: "src/01",
    app: "z2ui5_cl_smp_app_011",
  });
});

test("entries carry the catalogue title, the section and both source links", () => {
  const [first] = sampleEntries(shipped, parseSampleCatalog(OVERVIEW_SOURCE));
  assert.equal(first.app, "z2ui5_cl_smp_app_493");
  assert.equal(first.title, "Hello World, the Smallest App");
  assert.equal(first.group, "Basics I");
  assert.equal(first.jsUrl, "https://github.com/cap2UI5/cap2UI5/blob/main/core/srv/app/samples/z2ui5_cl_smp_app_493.js");
  // Same URL shape the overview app builds for its source-code icon.
  assert.equal(first.abapUrl, "https://github.com/abap2UI5/samples/blob/main/src/01/z2ui5_cl_smp_app_493.clas.abap");
});

test("an uncatalogued sample falls back to its class name and sorts last", () => {
  const entries = sampleEntries(shipped, parseSampleCatalog(OVERVIEW_SOURCE));
  const last = entries.at(-1);
  assert.equal(last.app, "z2ui5_cl_smp_app_112");
  assert.equal(last.title, "z2ui5_cl_smp_app_112");
  assert.equal(last.group, "Not in the catalogue");
  // No catalogue entry means no known ABAP path — omit the link rather than
  // guess one that 404s.
  assert.equal(last.abapUrl, null);
});

test("a catalogue that no longer matches degrades to a plain class list", () => {
  const entries = sampleEntries(shipped, parseSampleCatalog("get_catalog() { return []; }"));
  assert.equal(entries.length, 3);
  assert.ok(entries.every((e) => e.title === e.app && e.abapUrl === null));
});

test("the page deep-links every sample into the playground and escapes its text", () => {
  const html = renderSamplesPage(
    sampleEntries([{ app: "z2ui5_cl_smp_app_112", repoPath: "core/srv/app/samples/z2ui5_cl_smp_app_112.js" }], new Map()),
    { siteTitle: 'cap2UI5 <"Playground">' },
  );
  assert.match(html, /href="\.\/index\.html\?app_start=z2ui5_cl_smp_app_112"/);
  assert.match(html, /href="\.\/index\.html"/); // back into the app
  assert.ok(!html.includes('<"Playground">'), "title must be HTML-escaped");
  assert.match(html, /prefers-color-scheme: dark/); // works in both schemes
});
