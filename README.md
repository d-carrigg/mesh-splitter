# Mesh Splitter

Turn one solid mesh into separate, colour-coded parts for multi-colour or multi-piece 3D printing. Use it as an **OrcaSlicer plugin** or in **any browser**.

![A curling-stone figure split into 10 colour-coded parts](docs/screenshot.png)

Made for AI-generated figures and other STL/3MF files that come as one shell with no CAD source.

## Features

- **Split in a few clicks:** auto split, split by shells, or click a seed per part. Cuts follow the model's creases.
- **One colour per part:** each part gets its own filament slot. Rename, hide, or show only one part.
- **Move, rotate, scale:** drag handles in the view (W / E / R, Shift to snap), with undo.
- **Replace with…:** right-click a part and swap in another STL. It snaps onto the joint and keeps the part's name and filament.
- **Send to Orca:** one multi-part 3MF, every part on its filament. Painted 3MF, merged STL and per-part STLs are also available.
- **Optional AI review:** suggests part names and flags bad cuts.

## Install in OrcaSlicer

1. Download `mesh_splitter.py` from the [latest release](https://github.com/d-carrigg/mesh-splitter/releases/tag/orca-plugin).
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
| Shift (while dragging) | Snap to 1 mm, 15° or 5% |
| C | Toggle part colours / filament colours |
| Home | Frame the model |
| Del | Delete the part (its faces join the neighbour) |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Right-click | Part actions: rename, show only, replace, … |

## AI review (optional)

**Check** runs local checks and needs no key. **Review** sends rendered views to a vision model on [OpenRouter](https://openrouter.ai/) for part names and cut problems. Put `OPENROUTER_API_KEY=sk-or-...` in a `.env` file in the repo root. The key stays in the local server.

## Development

- `app/index.html`: the whole app, a single HTML file.
- `plugin/`: OrcaSlicer plugin. `npm ci && uv run python build.py` writes `dist/mesh_splitter.py`. Tests: `uv run python test_plugin.py`.
- `server/`: local server behind `uv run mesh-splitter` and the AI review proxy.

CI builds and tests the plugin on every push, and publishes it to the release from `main`.

## License

MIT, see [LICENSE](LICENSE).

The figure in the screenshot is a model created with [Meshy](https://www.meshy.ai/) under the [CC BY 4.0 License](https://creativecommons.org/licenses/by/4.0/). The model is not included in this repo.
