// Browser stub for node:path - a minimal posix implementation covering the
// calls the framework makes. Paths only feed fs lookups that always miss in
// the browser (see the fs stub), so string-level correctness is all that is
// needed - but that correctness is load-bearing: a wrong join/relative
// changes which module a require resolves to. Shared byte-identical between
// builder-abap2UI5-js/adapters/web/shims/ (the source) and
// builder-cap2UI5-web/stubs/ - see fs for why.
"use strict";

function normalize(p) {
  const isAbs = p.startsWith("/");
  const out = [];
  for (const seg of p.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (out.length && out[out.length - 1] !== "..") out.pop();
      else if (!isAbs) out.push("..");
      continue;
    }
    out.push(seg);
  }
  // never preserves a trailing slash (posix.normalize would) - harmless for
  // the framework, whose normalized paths only feed basename/require lookups
  return (isAbs ? "/" : "") + out.join("/") || (isAbs ? "/" : ".");
}

function join(...parts) {
  return normalize(parts.filter(Boolean).join("/"));
}

function resolve(...parts) {
  let resolved = "";
  for (const part of parts) {
    if (!part) continue;
    resolved = part.startsWith("/") ? part : `${resolved}/${part}`;
  }
  return normalize(resolved || "/");
}

function relative(from, to) {
  const f = resolve(from).split("/").filter(Boolean);
  const t = resolve(to).split("/").filter(Boolean);
  while (f.length && t.length && f[0] === t[0]) {
    f.shift();
    t.shift();
  }
  return [...f.map(() => ".."), ...t].join("/") || ".";
}

function dirname(p) {
  const norm = normalize(p);
  const idx = norm.lastIndexOf("/");
  if (idx < 0) return ".";
  if (idx === 0) return "/";
  return norm.slice(0, idx);
}

function basename(p, ext) {
  const base = p.split("/").filter(Boolean).pop() || "";
  return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
}

function extname(p) {
  const base = normalize(p).split("/").pop() || "";
  const idx = base.lastIndexOf(".");
  return idx > 0 ? base.slice(idx) : "";
}

module.exports = {
  sep: "/",
  delimiter: ":",
  normalize,
  join,
  resolve,
  relative,
  dirname,
  basename,
  extname,
};
