---
name: verify-send-to-orca
description: Check a change to Send to Orca against every order of sends, Open as project and deletes. Use when you change plugin/plugin.py (object_index, send_to_orca, Bridge save), plugin/project3mf.py (apply), or how app/main.js updates S.source.orca after a send.
---

# Verify Send to Orca

## What it promises

Each Send to Orca works, whatever the user did in OrcaSlicer since the last one, and Add or Replace object never removes an object other than the model that was split.

The harm when it breaks: the second Send fails with "no longer on the plate", or a send replaces the wrong object. Both shipped once. #95 addressed the source object by its id, and OrcaSlicer gives every object a new id when it opens a project, so the send after Open as project failed. A send after the user deleted the original failed too. #102 fixed both.

## How it checks

`SendSequenceModel` in `plugin/test_plugin.py` runs every sequence of these steps, up to `DEPTH` (4) long, on the real `plugin.py` and `project3mf.py` under `plugin/fake_orca.py`:

- **Send** in each mode in `MODES`: add, replace_object, replace_plate. The page side copies `app/main.js` (the `S.source.orca = { ...S.source.orca, ...m.source, id: null }` line after a send): it keeps the reply's source and forgets the id.
- **open**: Open as project on the file the last Send handed over. Every object comes back with a new id.
- **delete**: the user deletes the first object named bolt.

It is a bounded exhaustive check of the real code, not a hand model, so nothing can drift between a model and the code. A pass covers these steps and this bound only.

Run it, about 4 s:

```
cd plugin && uv run --frozen python -m unittest test_plugin.SendSequenceModel
```

`npm run check` runs it too, so it runs on every PR.

## Reading a failure

A failure names the shortest sequence that breaks, for example `After add -> open -> add: Send (add) failed: 'bolt' is no longer on the plate`. Replay that sequence by hand in `SendToOrcaTests` to see the reply and the handed 3MF.

- **A real bug**: the plugin's reply or the handed project is wrong for what a user did. Fix `object_index`, `send_to_orca` or `project3mf.apply`, not the check.
- **A modeling error**: the check does something OrcaSlicer doesn't. `step()`'s open rebuilds the plate from the handed 3MF's build order. Its delete rewrites the project with `orca_project`. If OrcaSlicer behaves differently, fix `step()` to match it and say why in the commit.
- **An intended change**: if Send's contract changes, for example a new mode, add it to `MODES` and update the checks at the end of `step()`.

## Proven able to fail

At 127fe70, the commit before #102, it fails on `delete -> add` and, without delete, on `add -> open -> add`, the two bugs #102 fixed.

## Not covered

- fill_plate. It makes the run take about 40 s.
- Import geometry only, more than one plate, and renaming the model in OrcaSlicer.
- The page's new-project prompt (`orcaNewProject`, `ORCA.sentAt` in `app/main.js`).
- OrcaSlicer's real event order. fake_orca stands in for it. The real-OrcaSlicer check on the release PR (`plugin/real_orca_test.py`) is the only run against the real thing.

## Coverage record

- `plugin/plugin.py`: `object_index`, `send_to_orca`, `Bridge.handle` (cmd `save`)
- `plugin/project3mf.py`: `apply`
- `app/main.js`: the `S.source.orca` update after a send

Last confirmed against the code at commit b017cd0. When a later change touches the files above, rerun the check and read `step()` against the code. Move this commit forward only after you confirm that the check still describes the code at the new commit.
