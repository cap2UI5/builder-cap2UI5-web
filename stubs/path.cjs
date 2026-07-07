// Browser stub for node:path — minimal posix implementation covering the
// calls the framework makes (join/resolve/relative/basename/dirname). Paths
// only feed fs lookups that always miss in the browser (see stubs/fs.js),
// so string-level correctness is all that is needed.

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

function basename(p, ext) {
  const base = p.split("/").filter(Boolean).pop() || "";
  return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
}

function dirname(p) {
  const norm = normalize(p);
  const idx = norm.lastIndexOf("/");
  if (idx < 0) return ".";
  if (idx === 0) return "/";
  return norm.slice(0, idx);
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

module.exports = {
  join,
  resolve,
  relative,
  basename,
  dirname,
  normalize,
  sep: "/",
  delimiter: ":",
};
