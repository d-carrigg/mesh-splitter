// Edit helpers for the Examples gallery configs (docs/examples/demo/gallery-*.json), run by a "script" step.
// Each helper makes the same edit the app's own tools make (Transform panel, rotate on joint, stretch, move with,
// merge, Replace with…), by part name, so the configs read as a list of edits. Angles in degrees, sizes in %.
(() => {
  const { S } = app;
  const V3 = app.camera.position.constructor, M4 = app.camera.matrix.constructor, Q = app.camera.quaternion.constructor;
  const idx = (name) => { const i = S.parts.findIndex((p) => p.name === name); if (i < 1) throw new Error("no part " + name); return i; };
  const pivotOf = (i, at) => {
    if (Array.isArray(at)) return new V3(...at);
    const jf = at === "center" ? null : app.jointFrame(i);
    return jf ? jf.J.clone() : new V3(...app.ensureXf(i).c).applyMatrix4(app.partMat(i));
  };
  const apply = (i, M) => { app.setXfMatrix(i, M.multiply(app.partMat(i))); app.xfEdited(i); };
  const about = (P, M) => new M4().makeTranslation(P.x, P.y, P.z).multiply(M).multiply(new M4().makeTranslation(-P.x, -P.y, -P.z));
  window.G = {
    // Clean start: no transforms, heal, replacements or seed dots; parts that move with another part keep doing so.
    reset() {
      for (const p of S.parts) { delete p.xf; delete p.heal; delete p.rep; p.seeds = []; p.visible = true; }
      S.active = 0; app.setGizmo("off"); app.afterEdit(""); G.quiet();
    },
    quiet() { document.getElementById("status").textContent = ""; },
    colors(map) { for (const [n, c] of Object.entries(map)) S.parts[idx(n)].color = c; app.afterEdit(""); },
    // Turn a part about a world axis through its joint (the cut toward the body), e.g. raise an arm at the shoulder.
    rotate(name, axis, deg, at) {
      const i = idx(name), P = pivotOf(i, at);
      apply(i, about(P, new M4().makeRotationAxis(new V3(...axis).normalize(), deg * Math.PI / 180))); app.afterEdit("");
    },
    // Rotate on joint (J): spin about the cut's own axis.
    spin(name, deg) {
      const i = idx(name), jf = app.jointFrame(i);
      apply(i, about(jf.J, new M4().makeRotationAxis(jf.n, deg * Math.PI / 180))); app.afterEdit("");
    },
    // Scale in % (one number, or [x, y, z]) about the joint, so the part stays attached, or about "center" / a point.
    scale(name, pct, at) {
      const i = idx(name), k = [].concat(pct).map((v) => v / 100), s = k.length === 1 ? [k[0], k[0], k[0]] : k;
      apply(i, about(pivotOf(i, at), new M4().makeScale(...s))); app.afterEdit("");
    },
    move(name, d) { const i = idx(name); apply(i, new M4().makeTranslation(...d)); app.afterEdit(""); },
    // Move a part d mm straight out from the model's vertical center line (e.g. fins onto a wider body).
    out(name, d) {
      const i = idx(name), c = pivotOf(i, "center"), b = S.G.bbox, r = new V3(c.x - (b[0] + b[3]) / 2, c.y - (b[1] + b[4]) / 2, 0).normalize();
      G.move(name, r.multiplyScalar(d).toArray());
    },
    stretch(name, pct) { app.setStretch([idx(name)], pct); G.quiet(); },
    heal(name, on = true) { const p = S.parts[idx(name)]; if (on) p.heal = { r: 0 }; else delete p.heal; app.afterEdit(""); },
    follow(names, leader) { app.setFollow([].concat(names).map(idx), idx(leader)); G.quiet(); },
    // Merge parts into one (their faces take the first part's label and color).
    merge(into, names) {
      const t = idx(into), set = new Set(names.map(idx));
      for (let f = 0; f < S.nF; f++) if (set.has(S.labels[f])) S.labels[f] = t;
      app.afterEdit("");
    },
    select(name) { S.active = idx(name); app.refreshUI(); },
    // After a "file" step on #repIn: keep the replacement in the file's own coordinates (made for this model).
    inPlace(name) { const p = S.parts[idx(name)]; Object.assign(p.rep, { inPlace: true, fit: false, embed: 0 }); S.active = 0; app.setGizmo("off"); app.afterEdit(""); },
  };
})();
