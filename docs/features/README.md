# Features

Five pages, one section per feature, each with a screenshot or a before / after image of the curling figure.

| Page | Covers |
| --- | --- |
| [Splitting](splitting.md) | Auto split, split by shells, seeds and Add part |
| [Editing parts](editing-parts.md) | Fill, brush, merge, Replace with…, show only, rename, AI part naming |
| [Move, rotate, scale and heal](transforms.md) | Handles (W / E / R), Shift snap, undo, rotate on joint (J), heal joint |
| [Exporting](exporting.md) | Send to Orca, painted 3MF, part STLs, merged STL |
| [Command line](command-line.md) | `mesh-splitter split`: methods, outputs, settings, seeds file |

## Regenerating the images

Every image here is made by `docs/demo/record.mjs` from the configs in `docs/features/demo/`, the same way as the README GIF:

```
cd plugin && npm ci && cd ..
node docs/demo/record.mjs docs/features/demo/*.json
```

A config with `"out": null` only writes its `shot` and `compare` steps (PNGs in `docs/features/img/`); one with an `out` path also records a GIF. The demo meshes aren't in the repo (see `docs/demo/prep_curling.py`). The shells example uses `sheet_tile.stl`, a curling sheet tile made of several separate shells.
