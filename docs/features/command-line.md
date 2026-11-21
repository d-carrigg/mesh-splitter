# Command line

Split a mesh without opening the app: for batch jobs, scripts, or a quick split you already know the settings for. It runs the same splitting code as the browser app and the OrcaSlicer plugin, so the same settings give the same parts.

- [Setup](#setup)
- [Examples](#examples)
- [Methods](#methods)
- [Outputs](#outputs)
- [Settings](#settings)
- [Seeds file](#seeds-file)

## Setup

You need [uv](https://docs.astral.sh/uv/getting-started/installation/) and [Node.js](https://nodejs.org/) 20 or newer. From the repo folder:

```
uv run mesh-splitter split --help
```

The first run installs two small npm packages (`npm ci`). You can also run it with Node directly: `npm ci`, then `node cli/split.mjs ...`.

## Examples

```
# Auto split, count picked from the creases; writes figure_parts.3mf next to the mesh
uv run mesh-splitter split figure.stl

# Exactly 6 parts, plus one STL per part
uv run mesh-splitter split figure.stl --auto 6 -o figure.3mf --stl parts/

# One part per shell, as a painted 3MF
uv run mesh-splitter split kit.3mf --shells --painted kit_painted.3mf

# Parts grown from seed points
uv run mesh-splitter split figure.stl --seeds seeds.json -o figure.3mf

# Finish a split in the app, then re-export it from a script
uv run mesh-splitter split figure.stl --session figure.split.json --stl parts/
```

It prints each part with its filament slot and face count, then the files it wrote.

## Methods

Pick one. Without one, it auto splits.

| Option | What it does |
| --- | --- |
| `--auto [N]` | [Auto split](splitting.md#auto-split) into N parts (2 to 32). Without N, it picks the count from the model's creases, like the app does when it opens a model. |
| `--shells` | [Split by shells](splitting.md#split-by-shells): one part per separate piece. |
| `--seeds FILE` | Grow parts from seed points, like [seeds](splitting.md#seeds-and-add-part) in the app. See [Seeds file](#seeds-file). |
| `--session FILE` | Apply a `.split.json` saved from the app (**Save session**). It must be for the same mesh. |

Moves, rotations, scaling and replacements from a session are not applied: those parts are written in their original position and shape, and it prints a note naming them.

## Outputs

With no output option, it writes `<name>_parts.3mf` next to the mesh. Use any mix of these:

| Option | Writes |
| --- | --- |
| `-o, --out FILE` | Multi-part 3MF: one object, one part per split part with its name and filament slot. The same file as **Send to Orca**. Import it with **Ctrl+I**. |
| `--painted FILE` | Painted 3MF: one mesh, each face painted with its part's filament slot. |
| `--stl DIR` | One closed STL per part, with the cut openings capped. |
| `--merged FILE` | All parts in one STL. |
| `--save-session FILE` | A `.split.json` you can load in the app (**Load session**) to keep editing. |

See [Exporting](exporting.md) for how each format loads in the slicer.

## Settings

| Option | App control | Default |
| --- | --- | --- |
| `--crease DEG` | **Crease** slider: concave creases sharper than this separate parts. Lower is more sensitive. | 2 |
| `--denoise N` | **Denoise** slider: smoothing passes on the concavity map. Higher ignores small dents. | 4 |
| `-q, --quiet` | Print only errors. | |

## Seeds file

A JSON list of parts. Each part has seed points (x, y, z in the mesh's units, usually mm), face indices, or both. Each point picks the nearest face. `name` and `filament` (1 to 16) are optional; a part without a filament gets the next free slot.

```json
[
  { "name": "Head", "filament": 2, "points": [[0, 0, 40]] },
  { "name": "Body", "filament": 3, "points": [[0, 0, 10], [0, 5, 0]] },
  { "name": "Base", "faces": [120] }
]
```

Faces no seed can reach, such as a separate shell with no seed on it, stay in the **Unassigned** part on filament 1.
