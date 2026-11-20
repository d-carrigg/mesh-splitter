# Features

One page per feature, each with a screenshot or a before / after image of the curling figure.

| Feature | What it does |
| --- | --- |
| [Auto split](auto-split.md) | Splits the mesh into parts along its creases, with a count you pick or an automatic one. |
| [Split by shells](split-by-shells.md) | One part per disconnected piece of the mesh. |
| [Seeds and Add part](seeds.md) | Click a point per part and grow the parts from those points. |
| [Fill, brush and merge](fill-brush-merge.md) | Fix up parts by hand: flood a region, paint faces, or join parts. |
| [Move, rotate, scale and undo](transforms.md) | Handles in the view (W / E / R), Shift to snap, Ctrl+Z to undo. |
| [Rotate on joint](rotate-on-joint.md) | Spin a part about its cut (J), so it stays seated on the part it joins. |
| [Heal joint](heal-joint.md) | After a move or rotate, stretch the part near its cut so it meets its neighbor again. |
| [Replace with…](replace.md) | Swap a part for another STL, lined up on the joint or kept in place. |
| [Show only this part](show-only.md) | Hide every other part. |
| [Rename](rename.md) | Give parts real names, which carry into the exported 3MF. |
| [Send to Orca](send-to-orca.md) | Save one multi-part 3MF with a filament per part, from inside OrcaSlicer. |
| [AI part naming](ai-part-naming.md) | Optional: a vision model suggests part names and flags bad cuts (browser version, OpenRouter). |

## Regenerating the images

Every image here is made by `docs/demo/record.mjs` from the configs in `docs/features/demo/`, the same way as the README GIF:

```
cd plugin && npm ci && cd ..
node docs/demo/record.mjs docs/features/demo/*.json
```

A config with `"out": null` only writes its `shot` and `compare` steps (PNGs in `docs/features/img/`); one with an `out` path also records a GIF. The demo meshes aren't in the repo (see `docs/demo/prep_curling.py`). `split-by-shells` uses `sheet_tile.stl`, a curling sheet tile made of several separate shells.
