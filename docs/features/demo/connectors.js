// Helpers for connectors.json: the curler's part names, the left foot's peg made a hexagonal frustum, and the exported
// parts (the multi-part 3MF's meshes, connectors included) pulled apart along a connector's axis.
(async () => {
  const THREE = await import("three"), S = app.S;
  window.cam = (p, t) => { app.camera.position.set(...p); app.controls.target.set(...t); app.camera.up.set(0, 0, 1); app.camera.lookAt(...t); app.controls.update(); app.render(); };
  const names = ["Stone", "Broom head", "Right arm", "Handle", "Left hand", "Base", "Left arm", "Left foot", "Right foot", "Broom stick", "Eyes"];
  names.forEach((n, k) => { S.parts[k + 1].name = n; });
  app.refreshUI();
  const idx = (n) => S.parts.findIndex((p) => p.name === n);
  const at = (a, b) => app.connState().list.find((e) => e.s && [e.s.a, e.s.b].sort().join() === [idx(a), idx(b)].sort().join());
  window.part = (n) => { S.active = idx(n); app.afterEdit(""); };
  const ex = {}, A = {};
  window.prepare = () => { // after Add to all parts
    app.editConns([at("Base", "Left foot").k], (c) => { c.shape = "hex"; c.style = "frustum"; }, "");
    const axis = (e) => new THREE.Vector3().setFromMatrixColumn(e.pl.F, 2), arm = at("Stone", "Right arm");
    A.foot = axis(at("Base", "Left foot")); A.arm = axis(arm);
    const color = Object.fromEntries(S.parts.map((p) => [p.name, p.color]));
    for (const p of app.buildParts3MF().parts) {
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(p.pos, 3)); g.setIndex([...p.tri]);
      const m = new THREE.Mesh(g.toNonIndexed(), new THREE.MeshStandardMaterial({ color: p.name.endsWith("dowel") ? "#e4e4e4" : color[p.name], roughness: 0.7, flatShading: true }));
      m.geometry.computeVertexNormals(); m.visible = false; m.userData.ex = true; ex[p.name] = m; app.scene.add(m);
    }
    const ctr = (n) => { ex[n].geometry.computeBoundingBox(); return ex[n].geometry.boundingBox.getCenter(new THREE.Vector3()).toArray(); };
    const side = new THREE.Vector3(0, 0, 1).cross(A.arm).normalize();
    window.C = { side: side.toArray(), foot: ctr("Left foot"), shoulder: new THREE.Vector3().setFromMatrixPosition(arm.pl.F).toArray(), out: A.arm.toArray() };
  };
  window.explode = (shown, moves) => { // show only the exported parts `shown`, each moved d mm along connector k's axis
    app.scene.traverse((o) => { if ((o.isMesh || o.isLine || o.isLineSegments || o.isPoints) && !o.userData.ex) o.visible = false; });
    for (const [n, m] of Object.entries(ex)) { m.visible = shown.includes(n); m.position.set(0, 0, 0); }
    for (const [n, [k, d]] of Object.entries(moves)) ex[n].position.copy(A[k]).multiplyScalar(d);
    app.render();
  };
})()
