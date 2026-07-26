// Snapshots the upstream cap2UI5 repo into input/cap2UI5/ — the build's
// only external input.
//
//   node mirror.mjs                          # shallow-clone from GitHub
//   MIRROR_SOURCE=/path/to/cap2UI5 node …    # copy a local checkout instead
//
// Since the cap2UI5 repo split, the repo root IS the deployable app (with
// the framework vendored at core/), so the whole checkout is mirrored
// (minus .git / node_modules / .github). UPSTREAM_COMMIT records the
// mirrored revision for traceability (same convention as the run/input
// snapshots in the builder repos).

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { INPUT_DIR } from "./paths.mjs";

const UPSTREAM = "https://github.com/cap2UI5/cap2UI5";
const HERE = path.dirname(fileURLToPath(import.meta.url));

// The trigger_web workflow writes the exact upstream revision it wants built
// into this repo's UPSTREAM_HEAD (via deploy key). A plain `git clone
// --depth 1` ignores it and mirrors whatever HEAD GitHub happens to serve,
// which — while replication lags the announced commit — can be an OLDER
// revision, silently deploying a stale site. Read the pin so the clone can be
// advanced to it (same arbitration as builder-cap2UI5:mirror-core.js).
function readPinnedHead() {
  try {
    const sha = fs.readFileSync(path.join(HERE, "UPSTREAM_HEAD"), "utf8").trim();
    return /^[0-9a-f]{40}$/i.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

function commitDate(repo, ref) {
  return Number(execFileSync("git", ["-C", repo, "show", "-s", "--format=%ct", ref]).toString().trim());
}

function copyProject(fromRepo, commit) {
  fs.rmSync(INPUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(INPUT_DIR, { recursive: true });
  for (const entry of fs.readdirSync(fromRepo)) {
    if (entry === ".git" || entry === ".github" || entry === "node_modules") continue;
    fs.cpSync(path.join(fromRepo, entry), path.join(INPUT_DIR, entry), {
      recursive: true,
      filter: (src) => !src.includes(`${path.sep}node_modules`) && !src.includes(`${path.sep}.git`),
    });
  }
  fs.writeFileSync(path.join(INPUT_DIR, "UPSTREAM_COMMIT"), `${commit}\n`);
  console.log(`mirror: cap2UI5@${commit.slice(0, 12)} → input/cap2UI5/`);
}

const local = process.env.MIRROR_SOURCE;
if (local) {
  const commit = execFileSync("git", ["-C", local, "rev-parse", "HEAD"]).toString().trim();
  copyProject(local, commit);
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cap2ui5-mirror-"));
  try {
    execFileSync("git", ["clone", "--depth", "1", UPSTREAM, tmp], { stdio: "inherit" });
    let commit = execFileSync("git", ["-C", tmp, "rev-parse", "HEAD"]).toString().trim();

    const pinned = readPinnedHead();
    if (pinned && pinned !== commit) {
      // Fetch the announced revision and prefer it only when it is strictly
      // newer than the clone HEAD (committer date) — that is the
      // replication-lag case. A pin that is older/equal (a stale slot) is
      // ignored so we never regress to an older build; an unfetchable pin
      // warns and falls back to the clone HEAD.
      try {
        execFileSync("git", ["-C", tmp, "fetch", "--depth", "1", "origin", pinned], { stdio: "inherit" });
        if (commitDate(tmp, pinned) > commitDate(tmp, commit)) {
          execFileSync("git", ["-C", tmp, "checkout", "--quiet", pinned]);
          commit = pinned;
          console.log(`mirror: advanced to pinned UPSTREAM_HEAD ${pinned.slice(0, 12)}`);
        } else {
          console.log(`mirror: clone HEAD ${commit.slice(0, 12)} already at/after pin — keeping it`);
        }
      } catch {
        console.warn(`::warning::UPSTREAM_HEAD ${pinned.slice(0, 12)} not fetchable — mirroring clone HEAD ${commit.slice(0, 12)}`);
      }
    }

    copyProject(tmp, commit);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
