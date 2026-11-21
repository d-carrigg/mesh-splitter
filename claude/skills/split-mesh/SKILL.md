---
name: split-mesh
description: Split a 3D-printable mesh (STL or 3MF) into separate parts with Mesh Splitter, then export a multi-part 3MF for OrcaSlicer or Bambu Studio, a painted 3MF, or one closed STL per part. Use when the user wants to split, segment or cut a model into parts or colors, or prepare a single-shell mesh for multi-color or multi-piece printing.
argument-hint: "[mesh file] [what to split]"
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/claude/run.mjs *)
---

# Split a mesh with Mesh Splitter

Run the Mesh Splitter command line. It uses the same splitting code as the Mesh Splitter app and OrcaSlicer plugin, so a split made here matches one made there with the same settings.

```
node "${CLAUDE_PLUGIN_ROOT}/claude/run.mjs" MESH [method] [outputs] [options]
```

- Needs Node.js 20 or newer. The first run installs two npm packages (`npm ci`) into the plugin folder; that takes a few seconds and prints a note.
- MESH is an `.stl` or `.3mf` file. Output paths are relative to the current directory.
- Full option list: `node "${CLAUDE_PLUGIN_ROOT}/claude/run.mjs" --help`.

## Methods (pick one; default is auto)

| Option | Use when |
| --- | --- |
| `--auto [N]` | No idea yet where the parts go. Splits along concave creases into N parts (2 to 32); without N it picks the count from the creases. |
| `--shells` | The mesh already has separate pieces (one part per shell). |
| `--seeds FILE` | The user names the parts they want ("head, body, base"). Grows each part from seed points. |
| `--session FILE` | The user saved a `.split.json` from the app. Re-exports that exact split. |

Settings: `--crease DEG` (default 2; lower makes more, smaller parts) and `--denoise N` (default 4; higher ignores small dents).

## Outputs (any mix; with none, writes `<name>_parts.3mf` next to the mesh)

| Option | Writes |
| --- | --- |
| `-o FILE` | Multi-part 3MF: one object, one part per split part with its name and filament slot. The best file for OrcaSlicer or Bambu Studio. |
| `--painted FILE` | Painted 3MF: one mesh, each face painted with its part's filament. |
| `--stl DIR` | One closed STL per part (cut openings capped). |
| `--merged FILE` | All parts in one STL. |
| `--save-session FILE` | `.split.json` the user can open in the app (**Load session**) to keep editing by hand. |
| `--report FILE` | JSON: the mesh's bounds and each part's name, filament, face count, bounds (`min`, `max`, `size`) and `center`. |

## Workflow

You can't see the model, so use `--report` to learn where things are.

1. **Look first.** Run `--auto --report report.json` (add `-o` only if the user wants a file now). Read the report: the mesh bounds tell you which axis is up (usually Z, with the model sitting at Z = 0) and how big it is (mm); each part's center and bounds tell you where it is.
2. **Name parts from geometry.** Describe the auto parts to the user by position and size ("top part, 40 mm tall, centered above the body" is probably the head). Don't guess beyond what the numbers show.
3. **For specific parts, use seeds.** Write a seeds file with one entry per wanted part and seed points placed on that part's surface, inside its region of the bounds. Several points per part help for long or branching parts. Then run with `--seeds` and `--report` again and check that each named part got a sensible face count and bounds. If one part swallowed another, add or move seed points, or lower `--crease`.
4. **Export** what the user asked for. For multi-color printing in OrcaSlicer or Bambu Studio, prefer `-o model_parts.3mf`; tell them to import it with Ctrl+I. For printing parts separately (or gluing), use `--stl DIR`.
5. **Hand off when needed.** Moving, rotating, scaling, healing joints and replacing parts happen in the app, not the command line. Write `--save-session` and tell the user to open it in the app (`uv run mesh-splitter` from a clone of the repo, or the OrcaSlicer plugin) with **Load session**.

Seeds file format (`filament` 1 to 16 and `name` are optional; `faces` takes face indices):

```json
[
  { "name": "Head", "filament": 2, "points": [[0, 0, 140]] },
  { "name": "Body", "filament": 3, "points": [[0, 0, 80], [0, 10, 60]] },
  { "name": "Base", "filament": 4, "points": [[0, 0, 2]] }
]
```

Faces no seed can reach (for example a separate shell with no seed) stay in the **Unassigned** part on filament 1.

## Notes

- A split only cuts along concave creases (where the surface folds inward). A smooth area with no crease will not split cleanly; say so instead of forcing it.
- Moves, rotations, scaling and replacements saved in a session are not applied by the command line; it prints a note naming those parts.
- Docs: https://d-carrigg.github.io/mesh-splitter/features/command-line/
