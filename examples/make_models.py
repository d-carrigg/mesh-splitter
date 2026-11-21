"""Build the example meshes in this folder from code, so they carry the repo's MIT license.

    uv run --with manifold3d --with trimesh --with scikit-image --with scipy python examples/make_models.py

Writes examples/<name>/<name>.stl for each model. Three styles, each a single closed solid:
- robot: hard-surface, boxes and cylinders (sharp creases at every joint)
- bear: organic, smoothly blended blobs (soft creases)
- rocket: a rocket with fins and portholes on a separate stand (two shells, thin fins)
"""
import pathlib
import numpy as np
import manifold3d as m3
import trimesh
from skimage import measure

HERE = pathlib.Path(__file__).parent
SEG = 48


def box(sx, sy, sz, at=(0, 0, 0)):
    return m3.Manifold.cube([sx, sy, sz], True).translate(at)


def cyl(r, h, at=(0, 0, 0), rot=(0, 0, 0), r2=None):
    c = m3.Manifold.cylinder(h, r, r if r2 is None else r2, SEG, True)
    return c.rotate(rot).translate(at)


def sphere(r, at=(0, 0, 0)):
    return m3.Manifold.sphere(r, SEG).translate(at)


def save(man, name, edge=None):
    if edge:  # split long edges: CAD-style meshes have long thin triangles, see the README
        man = man.refine_to_length(edge)
    mesh = man.to_mesh()
    tm = trimesh.Trimesh(mesh.vert_properties[:, :3], mesh.tri_verts, process=True)
    out = HERE / name / f"{name}.stl"
    out.parent.mkdir(exist_ok=True)
    tm.export(out)
    print(f"{out.relative_to(HERE.parent)}: {len(tm.faces)} faces, {len(tm.split(only_watertight=False))} shell(s), "
          f"watertight={tm.is_watertight}, size={np.round(tm.extents, 1)} mm")


def wrench():
    """Open-end wrench gripped in the left fist: handle out to the side, open jaw at the far end, flat to the front."""
    handle = box(24, 4, 5, (-44, 0, 39))  # from inside the fist (x = -32) out to the head
    jaw = box(10, 8, 6, (0, 0, 0)).rotate([0, -30, 0]).translate([-64, 0, 42])  # opening, tilted up and out
    head = cyl(7.5, 4, (-60, 0, 39), (90, 0, 0)) - jaw
    return handle + head


def robot():
    """Waving robot: box body, cylinder joints. Right arm raised, left arm holds a wrench."""
    parts = [
        box(34, 22, 40, (0, 0, 62)),                      # torso
        box(30, 20, 6, (0, 0, 39)),                       # hips
        cyl(5, 10, (0, 0, 86)),                           # neck
        box(26, 22, 22, (0, 0, 101)),                     # head
        cyl(3, 8, (0, 0, 116)), sphere(3.5, (0, 0, 121)),  # antenna
        cyl(4, 4, (-6, -11.5, 103), (90, 0, 0)), cyl(4, 4, (6, -11.5, 103), (90, 0, 0)),  # eyes
        box(12, 4, 3, (0, -11.5, 95)),                    # mouth
    ]
    for s in (-1, 1):  # legs + feet
        parts += [cyl(6, 34, (s * 9, 0, 21)), box(16, 26, 6, (s * 9, -3, 3))]
    # left arm (x<0): hangs down, holding a wrench out to the side
    parts += [sphere(7, (-21, 0, 76)), cyl(5, 34, (-26, 0, 58), (0, -14, 0)), box(10, 10, 10, (-31, 0, 39)), wrench()]
    # right arm (x>0): raised and waving
    parts += [sphere(7, (21, 0, 76)), cyl(5, 34, (34, 0, 92), (0, 40, 0)), box(10, 10, 10, (45, 0, 106))]
    for k in range(3):
        parts.append(box(3, 6, 8, (42 + 3 * k, 0, 114)))  # fingers
    return m3.Manifold.batch_boolean(parts, m3.OpType.Add)


def bear():
    """Seated teddy bear from smooth-blended spheres and capsules (signed distance field, marching cubes)."""
    def capsule(p, a, b, r):
        a, b = np.array(a, float), np.array(b, float)
        ab = b - a
        t = np.clip(((p - a) @ ab) / (ab @ ab), 0, 1)
        return np.linalg.norm(p - (a + t[..., None] * ab), axis=-1) - r

    def ball(p, c, r):
        return np.linalg.norm(p - np.array(c, float), axis=-1) - r

    def smin(a, b, k):  # polynomial smooth union
        h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
        return b * (1 - h) + a * h - k * h * (1 - h)

    step = 0.8
    g = np.arange(-40, 40 + step, step)
    zg = np.arange(-2, 92 + step, step)
    X, Y, Z = np.meshgrid(g, g, zg, indexing="ij")
    p = np.stack([X, Y, Z], -1)
    body = ball(p, (0, 0, 28), 22) * 1.0
    body = np.maximum(body, -(Z - 2))  # flat seat
    d = body
    head = ball(p, (0, -2, 62), 16)
    d = smin(d, head, 4)
    for s in (-1, 1):
        d = smin(d, ball(p, (s * 12, 2, 76), 6), 2.5)                              # ears
        d = smin(d, capsule(p, (s * 16, -4, 40), (s * 26, -16, 26), 6.5), 3)       # arms
        d = smin(d, capsule(p, (s * 11, -6, 10), (s * 14, -26, 8), 8), 3)          # legs
        d = smin(d, ball(p, (s * 14, -28, 8), 8.5), 2)                             # feet
    d = smin(d, ball(p, (0, -16, 58), 6.5), 3)                                     # snout
    d = np.maximum(d, -(Z - 0.0))
    v, f, _, _ = measure.marching_cubes(d, 0, spacing=(step, step, step))
    v += np.array([g[0], g[0], zg[0]])
    tm = trimesh.Trimesh(v, f, process=True)
    return m3.Manifold(m3.Mesh(np.asarray(tm.vertices, np.float32), np.asarray(tm.faces, np.uint32)))


def rocket():
    """Rocket with three fins, a nose cone and portholes, standing on a separate launch stand (two shells)."""
    body = cyl(12, 60, (0, 0, 50))
    nose = m3.Manifold.cylinder(26, 12, 0.6, SEG).translate([0, 0, 80])
    tip = sphere(1.2, (0, 0, 106))
    nozzle = cyl(7, 8, (0, 0, 16), r2=9)
    parts = [body, nose, tip, nozzle]
    for k in range(3):
        fin = m3.Manifold.extrude(m3.CrossSection([[[0, 0], [16, -6], [16, 6], [0, 26]]]), 2.4).translate([0, 0, -1.2])
        fin = fin.rotate([90, 0, 0]).translate([10, 0, 24]).rotate([0, 0, 120 * k])
        parts.append(fin)
    shell = m3.Manifold.batch_boolean(parts, m3.OpType.Add)
    for z in (52, 68):  # recessed portholes with a raised rim
        shell = shell - cyl(4, 6, (0, -12, z), (90, 0, 0))
        shell = shell + (cyl(5.5, 1.5, (0, -12, z), (90, 0, 0)) - cyl(4, 3, (0, -12, z), (90, 0, 0)))
    stand = cyl(30, 4, (0, 0, -6)) + cyl(9, 3, (0, 0, -2.5)) - cyl(7, 3, (0, 0, -1.0))
    return shell + stand.translate([0, 0, 2.0])  # stand top at z=12-ish below the nozzle, separate shell


if __name__ == "__main__":
    save(robot(), "robot", edge=2.5)
    save(bear(), "bear")
    save(rocket(), "rocket", edge=2.5)
