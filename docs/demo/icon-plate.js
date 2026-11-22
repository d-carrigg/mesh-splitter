// The icon's signature: "DCARRIGG" built into the print plate, right of the broom, drawn in 3D so it follows the
// plate's perspective and the parts pass over it (harder to crop or paint out than a corner overlay).
// Run by icon.config.json after the model loads. Display only: nothing in the app changes.
(async () => {
  const THREE = await import("three");
  const plate = app.scene.children.find((o) => o.isGroup && o.children.some((c) => c.type === "GridHelper"));
  const w = 150, h = 34; // mm on the plate
  const cv = document.createElement("canvas"); cv.width = 2048; cv.height = Math.round(2048 * h / w);
  const g = cv.getContext("2d");
  g.font = `900 ${cv.height * 0.86}px Arial, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
  const draw = (d, color) => { g.fillStyle = color; g.fillText("DCARRIGG", cv.width / 2 + d, cv.height / 2 + d); };
  draw(10, "rgba(0,0,0,.75)"); draw(-6, "rgba(255,255,255,.55)"); draw(0, "#9a9aa6"); // shadow, lit edge, face: embossed
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, toneMapped: false }));
  m.position.set(plate.position.x + 102, plate.position.y - 20, plate.position.z + 0.05);
  m.rotation.z = Math.PI / 2;
  app.scene.add(m); app.render();
})()
