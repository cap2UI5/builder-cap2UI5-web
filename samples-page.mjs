// dist/samples.html — the way into the playground.
//
// The site ships ~104 sample apps and, until this page existed, the only way
// to reach any of them was to know its class name and hand-type
// ?app_start=z2ui5_cl_smp_app_047. The catalogue that names them already
// exists: the overview app (z2ui5_cl_smp_app_000) carries it as a table of
// {group, header, sub, keywords, path, app} and renders it inside the running
// app. This module lifts the same table out of that source at build time, so
// the landing page and the in-app overview cannot describe the same sample
// differently.
//
// The page is listed from what the REGISTRY actually shipped, not from the
// samples directory: a class that failed the smoke-require or was dropped by
// the esbuild retry is not in the bundle, and a link to it would open an
// error dialog.

/** The ABAP originals these samples are ported from. */
const SAMPLES_REPO = "https://github.com/abap2UI5/samples";
/** The app repo this build mirrors — the JS that actually runs here. */
const CAP2UI5_REPO = "https://github.com/cap2UI5/cap2UI5";

/** Samples the catalogue does not list (helpers, sub-apps, the overview itself). */
const UNLISTED_GROUP = "Not in the catalogue";

// Verified against a built site: of the classes the catalogue leaves out, some
// are sub-apps another sample instantiates (z2ui5_cl_smp_app_105/_112) and
// answer with the framework's error app when started on their own. They are
// listed anyway — they ARE in the bundle and the class name is the only
// documentation of them there is — but not without saying so.
const UNLISTED_NOTE =
  "Helper and sub-app classes the catalogue does not name. Some are meant to be started by another sample and report an error on their own.";

/** The in-app sample overview — the catalogue this page is generated from. */
const OVERVIEW_APP = "z2ui5_cl_smp_app_000";

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * The catalogue table out of the overview app's source.
 *
 * Reading a generated file with a regex is a liberty, so it is taken
 * defensively: a table that no longer matches yields an empty catalogue and
 * the page falls back to class names — a plainer list, never a failed build
 * and never a wrong title. The shape matched is the one the transpiler emits
 * for the ABAP table constructor, all values in backticks.
 */
export function parseSampleCatalog(overviewSource) {
  const entry =
    /\{\s*group:\s*`([^`]*)`,\s*header:\s*`([^`]*)`,\s*sub:\s*`([^`]*)`,\s*keywords:\s*`([^`]*)`,\s*path:\s*`([^`]*)`,\s*app:\s*`([^`]*)`\s*\}/g;
  const catalog = new Map();
  for (const [, group, header, sub, keywords, path, app] of overviewSource.matchAll(entry)) {
    if (!catalog.has(app)) catalog.set(app, { group, header, sub, keywords, path, app });
  }
  return catalog;
}

/**
 * One list entry per shipped sample class, grouped and sorted the way the
 * page renders them.
 *
 * @param classes  [{ app, repoPath }] — class name plus its path in the app repo
 * @param catalog  the parsed catalogue (may be empty)
 */
export function sampleEntries(classes, catalog = new Map()) {
  const entries = classes.map(({ app, repoPath }) => {
    const c = catalog.get(app);
    return {
      app,
      // The catalogue's `sub` is the sample's actual subject ("Editable
      // Cells, Add and Delete Rows"); `header` is the section it sits in.
      title: c?.sub || app,
      group: c?.header || UNLISTED_GROUP,
      keywords: c?.keywords || "",
      jsUrl: `${CAP2UI5_REPO}/blob/main/${repoPath}`,
      // Same URL the overview app builds for its source-code icon.
      abapUrl: c ? `${SAMPLES_REPO}/blob/main/${c.path}/${app}.clas.abap` : null,
    };
  });
  // Uncatalogued samples last, everything else alphabetically by section and
  // title — the same reading order as the in-app overview.
  return entries.sort(
    (a, b) =>
      Number(a.group === UNLISTED_GROUP) - Number(b.group === UNLISTED_GROUP) ||
      a.group.localeCompare(b.group) ||
      a.title.localeCompare(b.title) ||
      a.app.localeCompare(b.app),
  );
}

function renderEntry(e) {
  // data-find carries everything the filter matches on, lowercased once here
  // instead of on every keystroke in the browser.
  const find = esc(`${e.title} ${e.app} ${e.group} ${e.keywords}`.toLowerCase());
  const source = [
    `<a class="src" href="${esc(e.jsUrl)}" title="the JavaScript class this playground runs">JS</a>`,
    e.abapUrl ? `<a class="src" href="${esc(e.abapUrl)}" title="the ABAP original this sample was ported from">ABAP</a>` : "",
  ].join("");
  return `      <li data-find="${find}">
        <a class="run" href="./index.html?app_start=${esc(e.app)}">${esc(e.title)}</a>
        <code>${esc(e.app)}</code>
        <span class="links">${source}</span>
      </li>`;
}

/** The complete static page. */
export function renderSamplesPage(entries, { siteTitle }) {
  const groups = [];
  for (const e of entries) {
    if (!groups.length || groups.at(-1).name !== e.group) groups.push({ name: e.group, items: [] });
    groups.at(-1).items.push(e);
  }
  const sections = groups
    .map(
      (g) => `    <section>
      <h2>${esc(g.name)}</h2>${g.name === UNLISTED_GROUP ? `\n      <p class="note">${esc(UNLISTED_NOTE)}</p>` : ""}
      <ul>
${g.items.map(renderEntry).join("\n")}
      </ul>
    </section>`,
    )
    .join("\n");

  // The overview app is the same catalogue as a running sample — worth its own
  // way in, and it is the one sample nobody would guess the class name of.
  const overview = entries.some((e) => e.app === OVERVIEW_APP)
    ? ` Or open the <a href="./index.html?app_start=${OVERVIEW_APP}">sample overview app</a>, which is this list running inside the framework.`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(siteTitle)} — Samples</title>
  <style>
    /* Horizon-ish, in both schemes; no webfont, no CDN — this page must
       render even when the UI5 CDN the app itself needs is unreachable. */
    :root {
      --bg: #f5f6f7; --card: #fff; --line: #d9d9d9;
      --fg: #1d2d3e; --muted: #556b82; --accent: #0064d9; --code: #eaecee;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #1d232a; --card: #24292e; --line: #3a4149;
        --fg: #eaecee; --muted: #a9b4be; --accent: #7fb1ec; --code: #2d333a;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; background: var(--bg); color: var(--fg);
      font-family: "72", "72full", Arial, Helvetica, sans-serif; font-size: 0.875rem; line-height: 1.5;
    }
    header {
      background: var(--card); border-bottom: 1px solid var(--line);
      padding: 0.75rem 1rem; display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center;
      position: sticky; top: 0; z-index: 1;
    }
    h1 { font-size: 1.125rem; margin: 0; font-weight: 600; }
    h2 {
      font-size: 0.8125rem; text-transform: uppercase; letter-spacing: 0.06em;
      color: var(--muted); margin: 1.5rem 0 0.5rem; font-weight: 600;
    }
    main { max-width: 60rem; margin: 0 auto; padding: 0 1rem 4rem; }
    p.lead { color: var(--muted); margin: 1rem 0 0; }
    p.note { color: var(--muted); margin: 0 0 0.5rem; font-size: 0.8125rem; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    input {
      flex: 1 1 14rem; min-width: 10rem; padding: 0.375rem 0.625rem;
      border: 1px solid var(--line); border-radius: 0.25rem;
      background: var(--bg); color: var(--fg); font: inherit;
    }
    ul { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line); border-radius: 0.25rem; background: var(--card); }
    li { display: flex; flex-wrap: wrap; gap: 0.5rem 0.75rem; align-items: baseline; padding: 0.4rem 0.75rem; border-top: 1px solid var(--line); }
    li:first-child { border-top: 0; }
    li[hidden] { display: none; }
    .run { flex: 1 1 20rem; font-weight: 600; }
    code { color: var(--muted); background: var(--code); border-radius: 0.1875rem; padding: 0.0625rem 0.3125rem; font-size: 0.75rem; }
    .links { display: flex; gap: 0.375rem; }
    .src { font-size: 0.6875rem; letter-spacing: 0.04em; border: 1px solid var(--line); border-radius: 0.1875rem; padding: 0 0.3125rem; color: var(--muted); }
    .src:hover { color: var(--accent); border-color: var(--accent); text-decoration: none; }
    #empty { color: var(--muted); padding: 1rem 0; }
    #empty[hidden] { display: none; }
  </style>
</head>
<body>
  <header>
    <h1>${esc(siteTitle)}</h1>
    <input id="q" type="search" placeholder="Filter ${entries.length} samples — title, class or keyword" autofocus>
    <a href="./index.html">Open the app</a>
  </header>
  <main>
    <p class="lead">
      Every sample below runs entirely in this browser tab — the framework and its
      backend are bundled into the page, so a click just starts the app. Sources:
      the JavaScript that runs here lives in
      <a href="${CAP2UI5_REPO}">cap2UI5</a>, the ABAP originals in
      <a href="${SAMPLES_REPO}">abap2UI5/samples</a>.${overview}
    </p>
${sections}
    <p id="empty" hidden>No sample matches the filter.</p>
  </main>
  <script>
    // Filtering is the one thing this page does; it stays a plain listing
    // with working links when the script never runs.
    var q = document.getElementById("q");
    var items = Array.prototype.slice.call(document.querySelectorAll("li[data-find]"));
    var empty = document.getElementById("empty");
    q.addEventListener("input", function () {
      var needle = q.value.trim().toLowerCase();
      var hits = 0;
      items.forEach(function (li) {
        var show = !needle || li.dataset.find.indexOf(needle) !== -1;
        li.hidden = !show;
        if (show) hits++;
      });
      document.querySelectorAll("main section").forEach(function (s) {
        s.hidden = !s.querySelector("li:not([hidden])");
      });
      empty.hidden = hits > 0;
    });
  </script>
</body>
</html>
`;
}
