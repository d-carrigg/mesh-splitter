import { test } from "node:test";
import assert from "node:assert/strict";
import { zlibSync } from "fflate";
import { b64, decodeSession } from "../app/session.js";

const session = (parts) => ({ version: 2, faces: 2, parts, labels: b64(zlibSync(new Uint8Array(new Int32Array([0, 1]).buffer))) });

test("a part's gap is one setting: sessions saved with the old fill/anchor flags load as part.gap", () => {
  const { parts } = decodeSession(session([{ name: "Body" }, { name: "Arm", anchor: true, fill: true }, { name: "Hand", fill: true }, { name: "Head" }]), 2);
  assert.deepEqual(parts, [{ name: "Body" }, { name: "Arm", gap: "anchor" }, { name: "Hand", gap: "fill" }, { name: "Head" }]);
});
