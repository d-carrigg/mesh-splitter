// Helpers for connectors.json: connectors on the curler's left foot and broom, and the exported parts (the multi-part
// 3MF's meshes, connectors included) pulled apart along each connector's axis.
(async () => {
  const THREE = await import("three"), S = app.S;
  window.wait = (ms) => new Promise((r) => setTimeout(r, ms));
  window.cam = (p, t) => { app.camera.position.set(...p); app.controls.target.set(...t); app.camera.up.set(0, 0, 1); app.camera.lookAt(...t); app.controls.update(); app.render(); };
  const set = (i, o) => { S.parts[i].conn = { ...app.connDefaults(i, o.type || "plug"), ...o }; };
  set(8, { shape: "hex", style: "frustum" }); // the left foot: a hexagonal, tapered peg into the base
  set(2, { type: "dowel", shape: "square" }); // the broom: a square dowel into the hand
  S.active = 8; app.afterEdit("");
  const axis = (k) => new THREE.Vector3().setFromMatrixColumn(app.connPlan(k).F, 2);
  const A = { 8: axis(8), 2: axis(2) }, color = Object.fromEntries(S.parts.map((p) => [p.name, p.color])), ex = {};
  for (const p of app.buildParts3MF().parts) {
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(p.pos, 3)); g.setIndex([...p.tri]);
    const m = new THREE.Mesh(g.toNonIndexed(), new THREE.MeshStandardMaterial({ color: p.name.endsWith("dowel") ? "#e4e4e4" : color[p.name], roughness: 0.7, flatShading: true }));
    m.geometry.computeVertexNormals(); m.visible = false; m.userData.ex = true; ex[p.name] = m; app.scene.add(m);
  }
  const ctr = (n) => { ex[n].geometry.computeBoundingBox(); return ex[n].geometry.boundingBox.getCenter(new THREE.Vector3()).toArray(); };
  window.C = { foot: ctr("Part 8"), broom: ctr("Part 2") };
  window.explode = (names, moves) => { // show only the exported parts `names`, each moved d mm along connector k's axis
    app.scene.traverse((o) => { if ((o.isMesh || o.isLine || o.isLineSegments || o.isPoints) && !o.userData.ex) o.visible = false; });
    for (const [n, m] of Object.entries(ex)) { m.visible = names.includes(n); m.position.set(0, 0, 0); }
    for (const [n, [k, d]] of Object.entries(moves)) ex[n].position.copy(A[k]).multiplyScalar(d);
    app.render();
  };
})()
