# Mesh Splitter

Split one solid mesh into separate, color-coded parts for multi-color or multi-piece printing, right inside OrcaSlicer. You can also scale, rotate, transform, or replace subsections of a mesh. For the example photo, I made the eyes 1 part, then replaced them with a flipped version to change where the figure looked. It also runs in **any browser**.

![Splitting a curling-stone figure, picking the eyes as a part, and replacing them with a flipped version](docs/demo.gif)

## Features

- **Split in a few clicks:** auto split, split by shells, or click a seed per part. Cuts follow the model's creases.
- **One color per part:** each part gets its own filament slot. Rename, hide, or show only one part.
- **Move, rotate, scale:** drag handles in the view (W / E / R, Shift to snap), with undo.
- **Rotate on joint:** spin a part about its cut's axis (J), so a part on an angled surface stays seated on it.
- **Heal joint:** after moving or rotating a part, stretch or squeeze it near its cut so the cut's edge lands back on its neighbor (no gap).
- **Replace with…:** right-click a part and swap in another STL. It snaps onto the joint and keeps the part's name and filament. A replacement made from the same model, such as edited eyes, stays in place.
- **Send to Orca:** one multi-part 3MF, every part on its filament. Painted 3MF, merged STL and per-part STLs are also available.
- **Optional AI part naming:** suggests part names and flags bad cuts (browser version).

## Install in OrcaSlicer

1. Download `mesh_splitter_any.py` from the [latest release](https://github.com/d-carrigg/mesh-splitter/releases/latest).
2. In OrcaSlicer 2.5, open **Plugins**, click the arrow next to **Browse plugins**, then **Install local plugin** and pick the file.
3. Tick **Activate** and allow writing to Downloads. A **Mesh Splitter** tab appears next to Prepare / Preview.

The tab lists the objects on your plate, and a single object opens automatically. **Send to Orca** saves `<name>_parts.3mf` to Downloads. Import it with **Ctrl+I**, because Orca's plugin API can't add objects to the plate itself.

## Run in a browser

Install [uv](https://docs.astral.sh/uv/getting-started/installation/), then run:

```
uv run mesh-splitter
```

It opens at `http://127.0.0.1:8766/app/`. Everything runs locally, and nothing is uploaded.

## Controls

| Key | Action |
| --- | --- |
| W / E / R / Q | Move / rotate / scale handles, then hide them |
| J | Rotate on joint: one ring about the part's cut axis, pivoting at the cut's center |
| Shift (while dragging) | Snap to 1 mm, 15° or 5% |
| C | Toggle part colors / filament colors |
| Home | Frame the model |
| Del | Delete the part (its faces join the neighbor) |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Right-click | Part actions: rename, show only, replace, … |

## How it works

1. **Face graph:** the mesh is loaded as triangles. For every edge between two faces, it measures the dihedral angle and whether the crease is concave (a valley, where parts usually meet) or convex (a ridge).
2. **Crease barrier:** each face gets a concavity score, smoothed over its neighbors (the **Smooth** slider) so noise doesn't count as a crease.
3. **Growing parts from seeds:** every seed grows outward across the face graph. Each face goes to the seed it can reach while crossing the shallowest worst crease on the way. Ties go to the nearer seed by surface distance. So a part fills its whole smooth surface and stops at the valleys around it.
4. **Auto split:** places seeds by farthest-point sampling, then moves each one to the deepest face of its region and regrows, a few times over. With the automatic count, it over-splits first, then merges neighbors whose shared boundary isn't a real crease.
5. **Cleanup:** tiny regions are absorbed into their neighbors. Boundaries are snapped onto the nearest crease with a minimum cut. Then the jagged triangle edges along each boundary are smoothed into a clean cut line by splitting the faces it crosses. The surface shape doesn't change.
6. **Export:** each part becomes its own body, with the filament slot you picked.

**Split by shells** skips all of this and makes one part per disconnected piece of the mesh.

## AI part naming (optional, browser only)

Splitting runs entirely on your machine. Optionally, you can send the result to an AI vision model. It suggests a name for each part and points out bad cuts, such as stray fragments, slivers or a feature split in two. Nothing changes until you click **Apply names**.

It needs the local server, so it works in the browser version (`uv run mesh-splitter`) but not inside the OrcaSlicer plugin. **Check**, which runs the same cut checks locally without AI, works in both.

It currently uses [OpenRouter](https://openrouter.ai/) (OpenAI-compatible API, any vision model it lists).

1. Get an API key from OpenRouter.
2. Put `OPENROUTER_API_KEY=sk-or-...` in a `.env` file in the repo root. Optionally add `OPENROUTER_MODEL=...` to pick the model.
3. Run `uv run mesh-splitter`, open a mesh and split it.
4. Open the AI panel (sparkle button) and click **Name parts**.
5. Read the suggested names and issues, then click **Apply names** to keep the names.

The key stays in the local server and is never sent to the page.

## Development

- `app/index.html`: the whole app, a single HTML file.
- `plugin/`: OrcaSlicer plugin. `npm ci && uv run python build.py` writes `dist/mesh_splitter_any.py`. Tests: `uv run python test_plugin.py`.
- `server/`: local server behind `uv run mesh-splitter` and the AI naming proxy.
- `docs/demo/`: script that records `docs/demo.gif` with headless Chromium and ffmpeg: `node docs/demo/record.mjs` (needs `npm ci` in `plugin/`). Steps, timing, camera and size are in `docs/demo/demo.config.json`. The meshes come from `prep_curling.py` and aren't in the repo.

The OrcaCloud listing description lives in `plugin/DESCRIPTION.md`. OrcaCloud's GitHub publishing only takes the version, changelog and files, so paste it into **Edit plugin** when it changes.

CI builds and tests the plugin on every push, and publishes it to the release from `main`. Releasing uses [Release Please](https://github.com/googleapis/release-please). Title PRs as [Conventional Commits](https://www.conventionalcommits.org/) (`feat: ...`, `fix: ...`); they land in the changelog. Each merge to `main` updates an open `chore(main): release X.Y.Z` PR that bumps `pyproject.toml` and `CHANGELOG.md`. Merge that PR whenever you want to ship: it creates the `vX.Y.Z` GitHub release, and the workflow builds the plugin, attaches it, and publishes it to the [OrcaCloud Plugin Hub](https://cloud.orcaslicer.com/app/plugins/plugin-hub) with the changelog.

## License

MIT, see [LICENSE](LICENSE).

The figure in the demo is a model created with [Meshy](https://www.meshy.ai/) under the [CC BY 4.0 License](https://creativecommons.org/licenses/by/4.0/). The model is not included in this repo.
