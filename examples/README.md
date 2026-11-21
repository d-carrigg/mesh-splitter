# Examples

Three test models in different styles, with the split made for each. The [Examples page](https://d-carrigg.github.io/mesh-splitter/examples/) in the docs shows them.

| Folder | Model | Style | Split |
| --- | --- | --- | --- |
| [robot](robot) | Waving robot holding a wrench | Hard-surface: boxes and cylinders, sharp creases | 12 parts from seed points; hands move with the arms, the wrench with the left hand, right arm stretched to 125% |
| [bear](bear) | Seated teddy bear | Organic: smoothly blended blobs, soft creases | 9 parts from seed points; snout and ears move with the head, head turned 25° on its joint with heal joint on |
| [rocket](rocket) | Rocket with fins and portholes on a stand | Two shells, thin fins, recessed details | 7 parts from the auto split on open, renamed |

Each folder has:

- `<name>.stl`: the model.
- `<name>.seeds.json`: seed points for the [command line](../docs/features/command-line.md#seeds-file) (robot and bear).
- `<name>.split.json`: the finished session. Open the STL in the app, then **Open > Load session…**.
- `<name>_parts.3mf`: the multi-part 3MF from **Export 3MF**, with transforms and heal applied.

## Try them

```
# Auto split, the same as opening the model in the app
uv run mesh-splitter split examples/rocket/rocket.stl -o rocket_parts.3mf

# Split from seed points
uv run mesh-splitter split examples/robot/robot.stl --seeds examples/robot/robot.seeds.json --stl robot_parts/
```

## License and credit

These models are made from code by [make_models.py](make_models.py) for this repo and are under its [MIT license](../LICENSE), like the rest of it. No third-party models are used. To rebuild them:

```
uv run --with manifold3d --with trimesh --with scikit-image --with scipy python examples/make_models.py
```

The robot and rocket are refined to edges of 2.5 mm or less, which is finer than Mesh Splitter's own refinement of coarse meshes.

`robot/parts/` holds the hats and round head the docs gallery swaps onto the robot, made by [make_parts.py](make_parts.py) in the robot's own coordinates:

```
uv run --with manifold3d --with trimesh python examples/make_parts.py
```

The docs gallery images come from `node docs/demo/record.mjs docs/examples/demo/gallery-*.json`. The edits for each image are in those configs (helpers in `docs/examples/demo/gallery.js`).
