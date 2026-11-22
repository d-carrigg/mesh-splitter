# Manual full-app check

A hands-on pass over every feature, run on request ("check the whole app") rather than in CI. Each step says what to do and what you should see. Take a screenshot of every step marked 📷 and of anything that fails. Note each step as pass or fail; a failure is reported, not fixed in the same pass.

## Setup

- Models (all in the repo unless noted):
  - `examples/robot/robot.stl`: one shell, hard creases. Main model for this check.
  - `examples/robot/parts/top_hat.stl`: a replacement part.
  - `examples/rocket/rocket.stl`: two shells.
  - `examples/bear/bear.stl` + `bear.split.json`: a saved session.
  - `curler.stl` (curling figure, from the project files): for comparing with the docs images.
- Browser app: `uv run mesh-splitter` (opens `http://127.0.0.1:8766`). Use a fresh browser profile, or clear the site's storage: the app remembers each file's last split (reopening it says "Restored your last session"), and the recent files and AI settings.
- Mock AI model: `uv run python server/mock_llm_server.py --port 1234 --models mock-vision-1` (an OpenAI-compatible server, like LM Studio, that names each part "mock part N").
- OrcaSlicer 2.5.1 with the plugin installed from `plugin/dist/mesh_splitter_any.whl` (Plugins > Install local plugin).
- Docs images to compare with: `docs/features/img/`, `docs/how-it-works/img/`, `docs/examples/img/`. To redraw them for a side-by-side check without touching the repo, copy each `docs/features/demo/*.json` with `"shots"` pointed at a temp folder and run `node docs/demo/record.mjs <copies>`.

## 1. Open

| # | Do | Expect |
|---|---|---|
| 1.1 | Open the app with no model. | Empty view with "Drop an STL or 3MF here" and **Open…**. No export or editing until a model is open. 📷 |
| 1.2 | **Open…** in the drop area (or Ctrl+O), pick `robot.stl`. | Model loads standing on the grid, framed. Header shows the name, faces and `1 shell`. It is auto split at once: several colored parts in the list (`Part 1`, `Part 2`, …), each with a filament slot. The status bar reports the split. 📷 |
| 1.3 | Check the model's position. | Whole model sits on the plate as one piece. No part is stretched or moved on its own. |
| 1.4 | Drag the model onto the view instead (drop a file). | Same result as 1.2. |
| 1.5 | Open the **Open** menu (sidebar, next to Model). | `robot.stl` is listed under **Recent**. Clicking it reopens it with its last split. |
| 1.6 | Orbit (left-drag), pan (right-drag), zoom (wheel), then **Frame view** (Home). | View moves smoothly; Home frames the whole model. |

## 2. Split

| # | Do | Expect |
|---|---|---|
| 2.1 | Click **Split** in the toolbar (or press A). | Split panel opens at the right on **Auto**: Parts (empty = auto), Crease step, Smoothing, "Only inside the selected part", **Split**. 📷 |
| 2.2 | Set Parts to 6, click **Split**. | Exactly 6 parts. Cuts sit on concave creases (shoulders, neck, wrists), not across flat faces. 📷 |
| 2.3 | Clear Parts, click **Split**. | Automatic count again (same as on open). |
| 2.4 | Select one part, tick **Only inside the selected part**, Parts 2, **Split**. | Only that part is split in two; the others keep their faces and names. No empty (0-face) part is left in the list. |
| 2.5 | Pick **Seeds**. Press Esc to deselect, click the head; Esc, click the body; Esc, click an arm. Then **Grow from seeds**. | A marker per click. After Grow: 3 parts grown from the clicks, boundaries on creases. Alt+click near a seed removes it. **Clear seeds** removes all. 📷 |
| 2.6 | Pick **Paint**, select a part, pick the brush (B), set Pen size, drag over a neighboring part. | Painted faces join the selected part. Shift+drag erases (faces become unassigned, gray). Right-drag still orbits. |
| 2.7 | Pick the fill tool (F), click a region of another part. | The clicked region floods into the selected part up to creases sharper than **Fill stop angle**. |
| 2.8 | Right-click a gray (unassigned) face. | Menu offers **Fill into nearest part** and **Fill all unassigned**; both clear the gray. |
| 2.9 | **Smooth boundaries**. | Part borders look smooth (no stair steps along triangles). |
| 2.10 | Open `rocket.stl`, Split > **Shells** > **Split by shells**. | Header said `2 shells`; result is `Shell 1`, `Shell 2`, each on its own slot. On `robot.stl` (1 shell) it says it can't split by shells (a message in the page, not a browser pop-up). 📷 |
| 2.11 | Back on `robot.stl`: Parts header **Add** (+), click a spot on the model. | A new part grows from the point at once; a small card shows **Point**, **Crease** slider and **Done**. Moving Crease regrows it live; **Point** + click adds more area; **Done** closes. 📷 |
| 2.12 | Split panel **Done**. | Panel closes. |

## 3. Parts list

| # | Do | Expect |
|---|---|---|
| 3.1 | Click a part in the view, then a row in the list. | Both select it: row highlighted, outline in the view, **Part** section shows Name, color, Filament slot. |
| 3.2 | Rename: type in **Name**, Enter. Then double-click a row name, type, Enter; and right-click a row > **Rename**, Esc. | First two rename (list and Part section update); Esc cancels. |
| 3.3 | Set **Print as** to **Parts**. Change the color swatch and the Filament slot. | Part color changes in view and list; the slot number on the row changes. **Filament colors** (C) shows parts on the same slot in one color; C again goes back. |
| 3.4 | Eye on a row; eye at the top of the list. | Row eye hides/shows that part; top eye shows all. |
| 3.5 | **Solo** in the Part section, then **Solo** again (or right-click > **Show only this** / **Show all again**). | Only that part shows; then all come back as before. |
| 3.6 | Select a part, Shift+click two more (view or list). **Merge** appears; click it. | The three become one with the first part's name, color and slot. |
| 3.7 | Shift+select two parts, right-click a selected row. | Menu: Merge N parts, Same filament as …, Move with …, Show only these, Hide these, Delete N parts. Each works. |
| 3.8 | Select a part, press Del (or **Delete**). | Its faces join the neighboring part; part count drops by one. |
| 3.9 | Right-click a part > **Replace with…**, pick `top_hat.stl` (on the head). | The part is swapped for the hat, lined up on the old joint, keeping name and slot. Part section shows Flip, Roll 90°, Pick joint, in place, fit, embed. Each changes the placement. The trash next to **Replace…** brings the old part back. 📷 |
| 3.10 | Right-click a part row > **Zoom to part**. | View frames that part. |

## 3b. Print as

| # | Do | Expect |
|---|---|---|
| 3b.1 | Open `robot.stl` fresh. Look under the name. | **Print as** shows **One part / Painted / Parts**, on **One part**. Parts rows show no filament slots; the Part section has no Filament slot. Main button reads **Export 3MF**. 📷 |
| 3b.2 | Press C (**Filament colors**) in each mode. | **One part:** the whole model in one color. **Painted** and **Parts:** each part in its filament slot's color. The button's tooltip says which. C again goes back to part colors. 📷 |
| 3b.3 | Switch to **Parts**, reload the page and reopen `robot.stl`. | It comes back as **Parts** (remembered per model). A 3MF with several parts opens as **Parts**; a painted 3MF opens as **Painted**. |

## 4. Transform

| # | Do | Expect |
|---|---|---|
| 4.1 | Select an arm. | Selecting shows the Move arrows. W / E / R switch tool; pressing the active tool's key again hides the handles. Move arrows on the part. Transform panel opens at the right showing **only Position** (+ At the cut, Heal joint, Reset/Done). Drag an arrow: the part moves; Shift snaps 1 mm; panel values follow. 📷 |
| 4.2 | Press E. | Rotate rings. Panel shows **only Rotation** and **Rotate around: Part center / Joint**. Shift snaps 15°. 📷 |
| 4.3 | Press R. | Scale handles. Panel shows **only Scale**, **Uniform scale** and **Stretch / Auto / Gap**. Shift snaps 5%. 📷 |
| 4.4 | Type values in the panel fields. | Part follows the typed position / rotation / scale. Uniform scale keeps X/Y/Z equal. |
| 4.5 | Q. | Handles hide. |
| 4.6 | Select the arm, press J (or Rotate around > **Joint**). | One ring, a dashed axis line and the cut outlined in green, centered on the shoulder. Drag: the arm turns about the shoulder and stays seated. 📷 compare with `rotate-joint-ui.png` |
| 4.7 | Rotate the arm with E (part center) by ~45°. At the cut = **Open** (default), Heal joint off. | A visible gap/step at the shoulder; the hole in the body shows. **No part changes color.** 📷 compare with `gap-fill.png` (left) and `heal-joint.png` (left) |
| 4.8 | At the cut > **Fill**. | Body hole is patched following its curve; arm end closed flat. |
| 4.9 | At the cut > **Anchor**. | New material sweeps from the body to the moved arm, no folds. 📷 compare with `gap-anchor.png` |
| 4.10 | Back to Open. Tick **Heal joint**, set Blend. | Arm bends near the cut so its edge lands on the body's edge; rest of the arm unchanged. 📷 compare with `heal-joint.png` (right) |
| 4.11 | R, type Stretch 125. Then tick **Auto** with Gap 1. | Arm lengthens from the shoulder; hand follows without stretching. Auto picks the smallest stretch that clears what the arm holds; on a part that holds or carries nothing it stays at 100%, the status settles, and Reset turns it off. |
| 4.12 | Move a part through another part it didn't touch. | **⚠ Goes through …** in the Part section and status bar. |
| 4.13 | Select a hand, right-click the arm > **Move with …** (with the arm selected, right-click the hand). Rotate the arm. | The hand moves with the arm. **Stop moving with …** unlinks. Reach and Hold work the same way from the menu. |
| 4.14 | **Reset**, then **Done**. | Part back to original; panel closes. |

## 5. Undo / redo

| # | Do | Expect |
|---|---|---|
| 5.1 | After several edits (split, rename, merge, move), press Ctrl+Z repeatedly, then Ctrl+Y. | Each step undoes in order and redoes in order. The toolbar undo/redo buttons enable/disable to match. One handle drag = one step. |

## 6. Check parts

| # | Do | Expect |
|---|---|---|
| 6.1 | Click **Check parts** (toolbar). | Results card opens in front of any open panel (Transform, Split): fragments, slivers, unassigned faces, collisions, or "no problems". Clicking a listed problem selects the part. 📷 |

## 7. AI names (mock model)

| # | Do | Expect |
|---|---|---|
| 7.1 | Parts header **AI names**. | First time: **Connect an AI model** with Provider, API key, Model. Privacy note shown. 📷 |
| 7.2 | Provider **Custom or local**, Base URL `http://127.0.0.1:1234/v1`, Model `mock-vision-1`, **Connect**. | Connects; panel switches to **Name parts** with "Using mock-vision-1" and **Change**. A wrong URL shows a clear error. |
| 7.3 | **Name parts**. | Progress with stage, timer and Cancel; then a list of suggested names. Nothing renamed yet. |
| 7.4 | **Apply names**. | Parts renamed to `mock part N`. Ctrl+Z undoes it. |
| 7.5 | **Change** > **Forget key** / **Cancel**. | Settings open and close correctly. |

## 8. Export

| # | Do | Expect |
|---|---|---|
| 8.1 | For each **Print as**, click the main export button (or Ctrl+E). | **One part:** `Export 3MF` downloads `robot.3mf`, one object with one part. **Painted:** `Export painted 3MF` downloads one part painted per slot. **Parts:** `Export parts 3MF` downloads `robot_parts.3mf`: one object, one part per split part, names and filament slots kept, moved parts where you put them. Check each in OrcaSlicer. |
| 8.2 | Export arrow > menu. | Menu draws on top of the Transform panel: Multi-part 3MF, Painted 3MF, Part STLs (.zip), Merged STL. 📷 |
| 8.3 | Each format. | Painted 3MF: one mesh painted per slot. STLs zip: one closed STL per part. Merged STL: whole model as one STL with moved parts in place. |
| 8.4 | **Open > Save session**, reload the page, open `robot.stl`, **Load session…**. | Split, names, slots and transforms come back. Also: `bear.stl` + `bear.split.json` loads the bear's finished split. |

## 9. Menus, tooltips and layering

| # | Do | Expect |
|---|---|---|
| 9.1 | First right-click on a part in the view. | Mesh Splitter's part menu (Select, New part here, Show only this, Hide, Replace with…, Delete) and **not** the browser's own menu. 📷 |
| 9.2 | Hover each toolbar and panel button. | Every button has a tooltip naming it and its key. |
| 9.3 | Open Split, then Check parts; open Transform, then the export menu; open AI names with Transform open. | The last opened popover/menu is on top and readable; none is hidden behind another panel. |
| 9.4 | Esc. | Closes the context menu, then add-part, then deselects, then closes Split, in that order. |

## 10. OrcaSlicer plugin (2.5.1)

| # | Do | Expect |
|---|---|---|
| 10.1 | Start OrcaSlicer with the plugin installed. | It loads with no error; the **Mesh Splitter** tab is there. |
| 10.2 | Put one object on the plate, open the tab. | The page shows the plugin UI (no browser top bar); the single object opens by itself and is auto split. With several objects, they are listed under **From the plate** in the Open menu. 📷 compare with `orca-plate-menu.png` |
| 10.3 | Print as **One part**. Turn a part on its joint with **Heal joint** on. Arrow next to **Send to Orca** > **Replace** *(name)*. | OrcaSlicer asks how to open the file: pick **Open as project**. The object is replaced in place: one object, one part, on the original's filament, with the turned part. No added filaments. 📷 |
| 10.4 | Print as **Painted**, **Replace** again. | One object, one part, painted with the parts' colors. OrcaSlicer has the extra filaments it needs. 📷 |
| 10.5 | Print as **Parts**, **Send to Orca** (Add to plate). | The original stays; the model is placed next to it with one part per split part, each on its own filament. 📷 |
| 10.6 | **Replace plate**, then **Fill plate**. | Replace plate clears the plate and puts the model where the original was. Fill plate fills the plate with named copies, 6 mm apart, none on excluded areas. 📷 |
| 10.7 | Arrow > **Multi-part 3MF to Downloads**. | Saves `<name>_parts.3mf`; Ctrl+I imports it as one object with a part per split part. |
| 10.8 | AI names in the plugin against the mock server. | OrcaSlicer asks to allow the address; after Yes, names come back. |

## 11. Command line

| # | Do | Expect |
|---|---|---|
| 11.1 | `uv run mesh-splitter split examples/rocket/rocket.stl -o build/rocket_parts.3mf` | Writes the 3MF; prints the parts. |
| 11.2 | `uv run mesh-splitter split examples/robot/robot.stl --seeds examples/robot/robot.seeds.json --stl build/robot_stl --merged build/robot.stl --painted build/robot_painted.3mf --report build/robot.json` | Writes every output; the report lists each part. |
| 11.3 | `uv run mesh-splitter split examples/bear/bear.stl --session examples/bear/bear.split.json -o build/bear.3mf` | Writes the 3MF with the session's parts and names. |
| 11.4 | `uv run mesh-splitter split --version` | Prints the version. |

## 12. Docs and examples

| # | Do | Expect |
|---|---|---|
| 12.1 | Redraw the docs screenshots into a temp folder (see Setup) and compare each with the committed image. | Same layout, colors and part split. Any visible difference is reported. |
| 12.2 | Open each example model + its `.split.json` in the app. | Each matches its picture on the Examples page. |
