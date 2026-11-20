Split one solid mesh into separate, color-coded parts for multi-color or multi-piece printing, right inside OrcaSlicer. You can also scale, rotate, transform, or replace subsections of a mesh. For the example photo, I made the eyes 1 part, then replaced them with a flipped version to change where the figure looked.

![A curling-stone figure split into 10 color-coded parts](https://raw.githubusercontent.com/d-carrigg/mesh-splitter/main/docs/screenshot.png)

**Note:** For anyone seeing the "Medium Security Risk": when I upload the plugin, the AI review refuses to look at the numpy lib because 1.5MB is too large for it, so it just skips it and flags as medium. If I compress it, then it reviews just fine as low risk. The github repo is open source (linked below) if you would like to review yourself. This plugin system is new, so still trying to understand the quirks.

## Features

- **Split in a few clicks:** auto split, split by shells, or click a seed per part. Cuts follow the model's creases.
- **One color per part:** each part gets its own filament slot. Rename, hide, or show only one part.
- **Move, rotate, scale:** drag handles in the view (W / E / R, Shift to snap), with undo.
- **Replace with…:** right-click a part and swap in another STL. It snaps onto the joint and keeps the part's name and filament.
- **Send to Orca:** one multi-part 3MF with every part on its filament. Painted 3MF, merged STL and per-part STLs are also available.

## How to use

1. Subscribe, then tick **Activate** and allow writing to Downloads. A **Mesh Splitter** tab appears next to Prepare / Preview.
2. The tab lists the objects on your plate. A single object opens automatically.
3. Split the mesh, then click **Send to Orca**. It saves `<name>_parts.3mf` to Downloads. Import it with **Ctrl+I** (Orca's plugin API can't add objects to the plate itself).

Source, issues and a browser version: [github.com/d-carrigg/mesh-splitter](https://github.com/d-carrigg/mesh-splitter)

Screenshot model created with [Meshy](https://www.meshy.ai/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
