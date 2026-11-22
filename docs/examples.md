# Examples

Split a model once, then pose it, resize parts, or swap them out. Every picture below is the same model, edited in Mesh Splitter.

## Robot

Move, rotate, stretch and scale parts, or replace them with your own.

| | | |
| --- | --- | --- |
| ![Original](examples/img/robot-model.png)<br>Original | ![Both arms up](examples/img/robot-arms-up.png)<br>Both arms up | ![Arm lowered](examples/img/robot-arms-down.png)<br>Arm lowered |
| ![Longer arm (stretch)](examples/img/robot-long-arm.png)<br>Longer arm (stretch) | ![Head turned](examples/img/robot-head-turn.png)<br>Head turned | ![Walking legs](examples/img/robot-walk.png)<br>Walking legs |
| ![Bigger wrench](examples/img/robot-big-wrench.png)<br>Bigger wrench | ![Antenna swapped for a top hat](examples/img/robot-top-hat.png)<br>Antenna swapped for a top hat | ![Party hat](examples/img/robot-party-hat.png)<br>Party hat |
| ![Crown](examples/img/robot-crown.png)<br>Crown | ![New round head](examples/img/robot-round-head.png)<br>New round head |  |

## Teddy bear

Turn parts on their joints; heal joint keeps them attached.

| | | |
| --- | --- | --- |
| ![Original](examples/img/bear-model.png)<br>Original | ![Arms up](examples/img/bear-arms-up.png)<br>Arms up | ![Waving](examples/img/bear-wave.png)<br>Waving |
| ![Head turned](examples/img/bear-head-turn.png)<br>Head turned | ![Bigger head](examples/img/bear-big-head.png)<br>Bigger head | ![Bigger ears](examples/img/bear-big-ears.png)<br>Bigger ears |
| ![Legs raised](examples/img/bear-legs-up.png)<br>Legs raised |  |  |

## Rocket

Resize parts, move them apart, or merge them.

| | | |
| --- | --- | --- |
| ![Original](examples/img/rocket-model.png)<br>Original | ![Bigger fins](examples/img/rocket-big-fins.png)<br>Bigger fins | ![Smaller fins](examples/img/rocket-small-fins.png)<br>Smaller fins |
| ![Longer body](examples/img/rocket-long-body.png)<br>Longer body | ![Wider body](examples/img/rocket-wide-body.png)<br>Wider body | ![Bigger window](examples/img/rocket-big-window.png)<br>Bigger window |
| ![Lifted off the stand](examples/img/rocket-lift-off.png)<br>Lifted off the stand | ![Fins merged into one part](examples/img/rocket-merged-fins.png)<br>Fins merged into one part |  |

## In OrcaSlicer: Print as

The robot with its head turned on the neck joint (Heal joint on), sent back with **Replace** in each [Print as](features/exporting.md#print-as) mode. The model takes the original's place on the plate each time.

| | | |
| --- | --- | --- |
| ![One part: one object, one part, on filament 1](examples/img/robot-orca-one-part.png)<br>**One part:** one object, one part, on the original's filament | ![Painted: one part, painted with the parts' colors](examples/img/robot-orca-painted.png)<br>**Painted:** one part, painted with the parts' colors; OrcaSlicer gets the filaments it needs | ![Parts: one part per split part, each on its own filament](examples/img/robot-orca-parts.png)<br>**Parts:** one part per split part, each on its own filament |

## Try them

The models, sessions and replacement parts are in the repo's [examples folder](https://github.com/d-carrigg/mesh-splitter/tree/main/examples). Open an STL, then **Open > Load session…** and pick its `.split.json`.
