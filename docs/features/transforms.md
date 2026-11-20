# Move, rotate, scale and undo

Each part can be moved, rotated and scaled on its own. The change shows in the view and is used by every export.

![Select the handle, move it on X with Shift held, then E and R, then undo](img/transforms.gif)

## How to use it

1. Click a part with the select tool (**V**).
2. Press a key for handles in the view:
   - **W:** move arrows. Shift snaps to 1 mm.
   - **E:** rotate rings. Shift snaps to 15°.
   - **R:** scale handles (corner box = all axes, arrow = one axis). Shift snaps to 5%.
   - **J:** [rotate on joint](rotate-on-joint.md).
   - **Q:** hide the handles.
3. Or type values on the part card: scale %, rotation ° and move mm for X / Y / Z. **uniform** scales all three axes together. The reset button clears the part's transform.

## Undo

**Ctrl+Z** undoes and **Ctrl+Y** redoes edits: transforms, splits, fills, merges and replacements. Each handle drag is one undo step. The undo and redo buttons are in the top bar.

## Tips

- The pivot is the part's center (the joint's center for rotate on joint).
- After a move or rotate, a part can leave a gap at its cut. [Heal joint](heal-joint.md) closes it.
