// Mesh Splitter core: mesh parsing, the face graph, the splitting algorithms and the file writers.
// No DOM, three.js or UI state: the browser app (app/index.html) and the command line (cli/split.mjs) both
// import this module, so a split made from the command line matches one made in the app.
//
// A "split" object holds the working state that these functions read and change:
//   { name, pos: Float32Array, tri: Uint32Array, nV, nF, G: face graph, labels: Int32Array part per face,
//     parts: [{ name, color, filament, seeds: [face], visible }], active }   (parts[0] is "Unassigned")
// Options: step = crease step (deg, the app's "Crease" slider), smooth = concavity smoothing passes ("Denoise").
//
// The code lives in the modules below; this file is the one entry point the app, the command line and the
// plugin build import.
export { parseSTL, parse3MF, weld, soupIndex, newSplit, flipInsideOut, refineLong, setMesh, toPlate } from "./mesh.js";
export { DEFAULTS, buildGraph, components, Heap, computeBarrier, ensureBarrier } from "./graph.js";
export { grow, segmentFromSeeds, autoSplit, splitShells } from "./segment.js";
export { PALETTE, UNASSIGNED_COLOR, newPart, dropEmptyParts, partCounts } from "./parts.js";
export { snapCreases, smoothCut } from "./boundary.js";
export { safeName, paintCode, painted3MF, meshOf, loopKey, soupVolume, pocketShell, reverseSoup, closedPart, stlBinary, parts3MF } from "./export.js";
export { b64, unb64, decodeSession, encodeSession } from "./session.js";
