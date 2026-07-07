// Shared path constants for the build scripts.
//
// CAP_DIR points at the CAP project inside the mirrored upstream snapshot
// (input/cap2UI5/cap2UI5 — repo subfolder cap2UI5/ holds the deployable
// project). mirror.mjs populates it; everything else reads from it.

import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const INPUT_DIR = path.join(ROOT_DIR, "input", "cap2UI5");
export const CAP_DIR = path.join(INPUT_DIR, "cap2UI5");
export const DIST_DIR = path.join(ROOT_DIR, "dist");
