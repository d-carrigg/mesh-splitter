# Mesh Splitter

Split one solid mesh into separate, color-coded parts for multi-color or multi-piece printing, right inside OrcaSlicer. Scale, rotate, or completely replace sections of the mesh for easy customization of single or multi-material prints. If you have ever been asked to print a part and customize "just this one thing," you may like this plugin.

For the example photo, I made the eyes 1 part, then replaced them with a flipped version to change where the figure looked. It also runs in **any browser**.

![Splitting a curling-stone figure, picking the eyes as a part, and replacing them with a flipped version](docs/demo.gif)

## Features

Every feature is documented with pictures on the [docs site](https://d-carrigg.github.io/mesh-splitter/).

- **Split in a few clicks:** [auto split](https://d-carrigg.github.io/mesh-splitter/features/splitting/#auto-split), [split by shells](https://d-carrigg.github.io/mesh-splitter/features/splitting/#split-by-shells), or [click a seed per part](https://d-carrigg.github.io/mesh-splitter/features/splitting/#seeds-and-add-part). Cuts follow the model's creases.
- **One color per part:** each part gets its own filament slot. [Rename](https://d-carrigg.github.io/mesh-splitter/features/editing-parts/#rename), hide, or [show only one part](https://d-carrigg.github.io/mesh-splitter/features/editing-parts/#show-only-this-part). Fix parts by hand with [fill, brush and merge](https://d-carrigg.github.io/mesh-splitter/features/editing-parts/#fill).
- **[Move, rotate, scale](https://d-carrigg.github.io/mesh-splitter/features/transforms/#move-rotate-scale-and-undo):** drag handles in the view (W / E / R, Shift to snap), with undo.
- **[Rotate on joint](https://d-carrigg.github.io/mesh-splitter/features/transforms/#rotate-on-joint):** spin a part about its cut's axis (J), so a part on an angled surface stays seated on it.
- **[Heal joint](https://d-carrigg.github.io/mesh-splitter/features/transforms/#heal-joint):** after moving or rotating a part, stretch or squeeze it near its cut so the cut's edge lands back on its neighbor (no gap).
- **[Fill and anchor](https://d-carrigg.github.io/mesh-splitter/features/transforms/#fill-and-anchor):** when a part moves off another, patch the hole it leaves (Fill), or keep it joined with new material (Anchor).
- **[Replace with…](https://d-carrigg.github.io/mesh-splitter/features/editing-parts/#replace-with):** right-click a part and swap in another STL. It snaps onto the joint and keeps the part's name and filament. A replacement made from the same model, such as edited eyes, stays in place.
- **[Send to Orca](https://d-carrigg.github.io/mesh-splitter/features/exporting/#send-to-orca):** one multi-part 3MF, every part on its filament. Painted 3MF, merged STL and per-part STLs are also available.
- **[Command line](https://d-carrigg.github.io/mesh-splitter/features/command-line/):** `uv run mesh-splitter split model.stl --auto 6 -o model.3mf` splits and exports without opening the app, with the same results.
- **[Claude Code plugin](https://d-carrigg.github.io/mesh-splitter/features/claude-code/):** ask Claude to split a model for you (`/plugin marketplace add d-carrigg/mesh-splitter`).
- **Optional [AI part naming](https://d-carrigg.github.io/mesh-splitter/features/ai-naming/):** suggests part names and flags bad cuts, in the browser and in OrcaSlicer, with OpenAI, OpenRouter, Claude or a local model (LM Studio, Ollama).

## Install in OrcaSlicer

1. Download `mesh_splitter_any.whl` from the [latest release](https://github.com/d-carrigg/mesh-splitter/releases/latest).
2. In OrcaSlicer 2.5, open **Plugins**, click the arrow next to **Browse plugins**, then **Install local plugin** and pick the file.
3. Tick **Activate** and allow writing to Downloads. A **Mesh Splitter** tab appears next to Prepare / Preview.

The tab lists the objects on your plate, and a single object opens automatically. **Send to Orca** saves `<name>_parts.3mf` to Downloads. Import it with **Ctrl+I**, because Orca's plugin API can't add objects to the plate itself.

## Run in a browser

Install [uv](https://docs.astral.sh/uv/getting-started/installation/), then run:

```
uv run mesh-splitter
```

It opens at `http://127.0.0.1:8766/app/`. Everything runs locally, and nothing is uploaded.

## Command line

Split and export from a terminal or script. It runs the same splitting code as the app. The easiest way is to download the file for your computer from the [latest release](https://github.com/d-carrigg/mesh-splitter/releases/latest) (Windows, Mac, Linux; nothing to install) and run it, for example `mesh-splitter-windows-x64.exe figure.stl --auto 6 -o figure.3mf`. With [Node.js](https://nodejs.org/) 20+, `npx github:d-carrigg/mesh-splitter figure.stl` also works without a clone. From the repo folder, with uv and Node.js:

```
uv run mesh-splitter split figure.stl --auto 6 -o figure.3mf --stl parts/
uv run mesh-splitter split kit.3mf --shells --painted kit_painted.3mf
uv run mesh-splitter split figure.stl --seeds seeds.json
uv run mesh-splitter split figure.stl --session figure.split.json
```

All options, the seeds file format and outputs: [Command line docs](https://d-carrigg.github.io/mesh-splitter/features/command-line/), or `uv run mesh-splitter split --help`.

## Claude Code plugin

Let [Claude Code](https://code.claude.com/docs) split meshes for you. Needs Node.js 20+:

```
/plugin marketplace add d-carrigg/mesh-splitter
/plugin install mesh-splitter@mesh-splitter
```

Then ask, for example, "split figure.stl into head, body and base and give me a 3MF for OrcaSlicer". See the [Claude Code plugin docs](https://d-carrigg.github.io/mesh-splitter/features/claude-code/).

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

Parts are grown from seeds across the mesh and stop at concave creases, the valleys where one part meets the next. Auto split places the seeds itself, and the cut lines are then snapped onto the creases and smoothed. The app, the OrcaSlicer plugin and the command line all run the same code, so the same settings give the same parts.

Details, with diagrams: [How it works](https://d-carrigg.github.io/mesh-splitter/how-it-works/).

## AI part naming (optional)

Splitting runs entirely on your machine. Optionally, you can send the result to an AI vision model. It suggests a name for each part and points out bad cuts, such as stray fragments, slivers or a feature split in two. Nothing changes until you click **Apply names**.

It works in the browser version and inside the OrcaSlicer plugin, with OpenAI, OpenRouter, Anthropic Claude, or any OpenAI-compatible server, including local ones such as LM Studio and Ollama (no key, nothing leaves your computer). Nothing is sent until you click **Name parts**, and only to the provider you pick. There is no telemetry. **Check**, which runs the same cut checks locally without AI, works in both.

1. Open a mesh and split it.
2. Open the AI panel (sparkle button), click the settings button, pick a provider, paste your key (none for local servers), and click **Save**.
3. Click **Name parts**, read the suggested names and issues, then click **Apply names** to keep the names.

The key is saved on your computer and is never sent to the page. Details: [AI part naming](https://d-carrigg.github.io/mesh-splitter/features/ai-naming/).

## Development

- `app/index.html`: the app (UI, display, editing tools).
- `app/core.js`: the entry point for mesh loading, the splitting algorithm and the file writers, with no UI code. The app, the plugin bundle and the command line all import it. The code is in the modules it re-exports: `mesh.js` (reading STL/3MF, welding), `graph.js` (face graph, concavity barrier), `segment.js` (seeds, auto split, shells), `parts.js`, `boundary.js` (crease snapping, smooth cut), `export.js` (3MF/STL writers) and `session.js` (`.split.json`).
- `test/golden.mjs`: end-to-end check that the splitting output hasn't changed: runs the command line on the example meshes with every method and output, and compares hashes of everything it writes with `test/golden.json` (`npm ci && node test/golden.mjs`; `--update` after an intended change).
- `cli/split.mjs`: the command line (`uv run mesh-splitter split`, or `npm ci && node cli/split.mjs`).
- `plugin/`: OrcaSlicer plugin. `npm ci && uv run python build.py` writes `dist/mesh_splitter_any.whl` (plain plugin code + page in a wheel). Tests: `uv run python test_plugin.py`. CI also installs the plugin in a real OrcaSlicer 2.5.1 (Linux AppImage, headless under Xvfb) and checks that it loads, reads the plate mesh, and that its 3MF imports as one part per split part: `real_orca_test.py`. CI runs the tests only on the Release Please PR (or when started by hand from the Actions tab).
- `server/`: local server behind `uv run mesh-splitter`, and the AI naming providers (`llm_providers.py`, also built into the plugin).
- `docs/demo/`: script that records `docs/demo.gif` with headless Chromium and ffmpeg: `node docs/demo/record.mjs` (needs `npm ci` in `plugin/`). Steps, timing, camera and size are in `docs/demo/demo.config.json`. The meshes come from `prep_curling.py` and aren't in the repo. The same script makes the feature docs' images: `node docs/demo/record.mjs docs/features/demo/*.json`.
- Hosted web app: `.github/workflows/web-app.yml` publishes `app/` to Azure Static Web Apps (Free plan) on each release, with the headers in `app/staticwebapp.config.json`. There is no server there, so AI naming goes straight from the browser to the provider (`app/llm-direct.js`, a port of `server/llm_providers.py`; `node --test test/llm-direct.test.mjs`).
- Docs site: `mkdocs.yml` + `docs/`, built with MkDocs Material and deployed to [GitHub Pages](https://d-carrigg.github.io/mesh-splitter/) by `.github/workflows/docs.yml` on every merge to `main`. Preview locally with `pip install mkdocs-material && mkdocs serve`.

The OrcaCloud listing description lives in `plugin/DESCRIPTION.md`. OrcaCloud's GitHub publishing only takes the version, changelog and files, so paste it into **Edit plugin** when it changes.

CI builds and tests the plugin on every push, and publishes it to the release from `main`. Releasing uses [Release Please](https://github.com/googleapis/release-please). Title PRs as [Conventional Commits](https://www.conventionalcommits.org/) (`feat: ...`, `fix: ...`); they land in the changelog. Each merge to `main` updates an open `chore(main): release X.Y.Z` PR that bumps `pyproject.toml` and `CHANGELOG.md`. Merge that PR whenever you want to ship: it creates the `vX.Y.Z` GitHub release, and the workflow builds the plugin, attaches it, and publishes it to the [OrcaCloud Plugin Hub](https://cloud.orcaslicer.com/app/plugins/plugin-hub) with the changelog.

## License

MIT, see [LICENSE](LICENSE).

The figure in the demo is a model created with [Meshy](https://www.meshy.ai/) under the [CC BY 4.0 License](https://creativecommons.org/licenses/by/4.0/). The model is not included in this repo.
