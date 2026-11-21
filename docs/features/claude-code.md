# Claude Code plugin

Let [Claude Code](https://code.claude.com/docs) split meshes for you. Describe the parts you want ("split the head, body and base into separate colors"), and Claude runs the Mesh Splitter [command line](command-line.md) to split the model and export it. It uses the same splitting code as the app and the OrcaSlicer plugin, so the same settings give the same parts.

- [Install](#install)
- [Use it](#use-it)
- [What Claude can do](#what-claude-can-do)
- [Update or remove](#update-or-remove)

## Install

You need [Node.js](https://nodejs.org/) 20 or newer. In Claude Code, run:

```
/plugin marketplace add d-carrigg/mesh-splitter
/plugin install mesh-splitter@mesh-splitter
```

Or from a terminal:

```
claude plugin marketplace add d-carrigg/mesh-splitter
claude plugin install mesh-splitter@mesh-splitter
```

Restart Claude Code after installing. The first split installs two small npm packages into the plugin folder, which takes a few seconds.

## Use it

Ask in plain words, from a folder that holds your model:

```
Split figure.stl into 6 parts and give me a 3MF for OrcaSlicer
Split robot.stl into head, body, arms and legs, one STL per part
Re-export figure.split.json as a painted 3MF
```

Or call the skill directly: `/mesh-splitter:split-mesh figure.stl head, body, base`.

Claude asks before running the command the first time, unless you allow it. It then tells you which parts it made, with their filament slots, and the files it wrote. Import the multi-part 3MF into OrcaSlicer or Bambu Studio with **Ctrl+I**.

## What Claude can do

| Ask for | Claude uses |
| --- | --- |
| A number of parts, or "split it at the creases" | [Auto split](splitting.md#auto-split) (`--auto`) |
| Named parts (head, body, base) | An auto split, with its parts grouped and renamed (`--merge`) from their positions and sizes (`--report`), or seed points (`--seeds`) |
| One part per separate piece | [Split by shells](splitting.md#split-by-shells) (`--shells`) |
| Finishing a split you saved in the app | `--session` |
| A multi-part 3MF, painted 3MF, per-part STLs or one merged STL | The [command line outputs](command-line.md#outputs) |

Claude can't see the model. It finds parts from their positions and sizes, so check the result in your slicer. Moving, rotating, scaling, healing joints and replacing parts are done in the app: ask Claude for a session file (`--save-session`), then open it in the app with **Load session** to keep editing.

## Update or remove

```
/plugin marketplace update mesh-splitter
/plugin uninstall mesh-splitter@mesh-splitter
```
