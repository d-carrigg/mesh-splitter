"""Build the example meshes in this folder from code, so they carry the repo's MIT license.

    uv run --with manifold3d --with trimesh --with scikit-image --with scipy python examples/make_models.py

Writes examples/<name>/<name>.stl for each model. Three styles, each a single closed solid:
- robot: hard-surface, boxes and cylinders (sharp creases at every joint)
- bear: organic, smoothly blended blobs (soft creases)
- rocket: a rocket with fins and portholes on a separate stand (two shells, thin fins)
- gardener: the flagship example; organic figure (blended blobs) with hard-surface props (base, toolbox, rake, hat)
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


def save(man, name, edge=None, weld=False):
    if edge:  # split long edges: CAD-style meshes have long thin triangles, see the README
        man = man.refine_to_length(edge)
    mesh = man.to_mesh()
    tm = trimesh.Trimesh(mesh.vert_properties[:, :3], mesh.tri_verts, process=True)
    if weld:  # (gardener) clean up what welding in Mesh Splitter would otherwise load as stray one-face shells
        shells = tm.split(only_watertight=False)
        tm = trimesh.util.concatenate([s for s in shells if len(s.faces) >= 4])  # zero-area two-triangle slivers
        tm.merge_vertices(digits_vertex=3)  # vertices closer than Mesh Splitter's weld tolerance
        tm.update_faces(tm.nondegenerate_faces())
        tm.remove_unreferenced_vertices()
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


def rod(a, b, r):
    """Cylinder of radius r from point a to point b."""
    a, b = np.array(a, float), np.array(b, float)
    d = b - a
    n = np.linalg.norm(d)
    d /= n
    c = m3.Manifold.cylinder(n, r, r, SEG, False)
    return c.rotate([0, np.degrees(np.arccos(d[2])), 0]).rotate([0, 0, np.degrees(np.arctan2(d[1], d[0]))]).translate(a)


def gardener():
    """Gardener on a grass base: rake in the right hand, the left hand on the swing handle of a wooden toolbox.

    The figure is organic (smooth-blended blobs, marching cubes) with hard unions at the joints, so each limb
    meets the body at a crease. The props are hard-surface (flat faces, sharp edges). Front is -Y, right is +X.
    """
    def cap(p, a, b, r):
        a, b = np.array(a, float), np.array(b, float)
        ab = b - a
        t = np.clip(((p - a) @ ab) / (ab @ ab), 0, 1)
        return np.linalg.norm(p - (a + t[..., None] * ab), axis=-1) - r

    def ball(p, c, r):
        return np.linalg.norm(p - np.array(c, float), axis=-1) - r

    def ell(p, c, r):
        return (np.linalg.norm((p - np.array(c, float)) / np.array(r, float), axis=-1) - 1) * min(r)

    def smin(a, b, k):
        h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
        return b * (1 - h) + a * h - k * h * (1 - h)

    step = 0.9
    xg, yg, zg = np.arange(-58, 52, step), np.arange(-38, 26, step), np.arange(5, 160, step)
    X, Y, Z = np.meshgrid(xg, yg, zg, indexing="ij")
    p = np.stack([X, Y, Z], -1)
    d = ell(p, (0, 0, 84), (25, 19, 33))                                          # torso (overalls)
    d = smin(d, ell(p, (0, 0, 112), (19, 15, 8)), 6)                              # shoulders
    d = smin(d, cap(p, (0, -1, 116), (0, -1, 122), 7.5), 1.0)                     # neck
    head = ball(p, (0, -1, 136), 18)
    head = smin(head, ball(p, (0, -19.5, 133), 4.5), 1.5)                         # nose
    for s in (-1, 1):
        head = smin(head, ell(p, (s * 18, -1, 135), (2.5, 4, 5.5)), 1.5)          # ears
    d = np.minimum(d, head)
    for s in (-1, 1):
        d = np.minimum(d, cap(p, (s * 9, -1, 58), (s * 10, -2, 20), 7.5))          # legs
        boot = smin(cap(p, (s * 10, -3, 13), (s * 11, -16, 11), 8), ball(p, (s * 10, 1, 12), 8), 3)
        d = np.minimum(d, np.maximum(boot, -(Z - 6.0)))                            # boots, flat soles
    # right arm (+X): upper arm, forearm bent forward, fist around the rake handle
    d = np.minimum(d, cap(p, (21, 0, 110), (34, -4, 90), 6.5))
    d = smin(d, cap(p, (34, -4, 90), (36, -18, 82), 6), 2)
    d = np.minimum(d, ball(p, (36, -24, 80), 7.5))
    # left arm (-X): hangs down to the toolbox handle
    d = np.minimum(d, cap(p, (-21, 0, 110), (-34, -2, 87), 6.5))
    d = smin(d, cap(p, (-34, -2, 87), (-45, -4, 70), 6), 2)
    d = np.minimum(d, ball(p, (-48, -4, 64), 7.5))
    d = np.maximum(d, -(Z - 6.0))
    v, f, _, _ = measure.marching_cubes(d, 0, spacing=(step, step, step))
    v += np.array([xg[0], yg[0], zg[0]])
    tm = trimesh.Trimesh(v, f, process=True)
    figure = m3.Manifold(m3.Mesh(np.asarray(tm.vertices, np.float32), np.asarray(tm.faces, np.uint32)))

    parts = [figure]
    for s in (-1, 1):  # eyes
        parts.append(sphere(2.6, (s * 7, -17.4, 140)))
    parts += [cyl(31, 2.4, (0, -1, 150)),                    # hat brim
              m3.Manifold.cylinder(8, 18.6, 18.0, 96, True).translate([0, -1, 155]),  # hat band
              cyl(16, 13, (0, -1, 161.5), r2=13.5)]           # hat crown
    parts += [cyl(3.2, 3, (-9, -17.6, 93), (90, 0, 0)), cyl(3.2, 3, (9, -17.6, 93), (90, 0, 0))]  # overall buttons
    parts.append(box(16, 2, 10, (0, -19.0, 82)))                            # bib pocket

    # toolbox: open wooden box with tall end boards; a swing handle on two pivots
    cx, cy = -52, -4
    parts.append(box(46, 30, 28, (cx, cy, 20)) - box(42, 26, 30, (cx, cy, 24)))
    for s in (-1, 1):
        parts.append(box(4, 30, 40, (cx + s * 25, cy, 26)))
        parts.append(cyl(3, 3, (cx + s * 22.5, cy, 42), (0, 90, 0)))        # pivot pins
    bail = [rod((cx + s * 21, cy, 42), (cx + s * 18, cy, 64), 2.6) for s in (-1, 1)]
    bail += [rod((cx - 18, cy, 64), (cx + 18, cy, 64), 3.5)]                # grip, under the left hand
    bail += [sphere(2.6, (cx + s * 18, cy, 64)) for s in (-1, 1)]
    bail += [sphere(3.2, (cx + s * 21, cy, 42)) for s in (-1, 1)]
    parts += bail

    # rake: handle through the right fist, head resting on the base
    a, b = (44, -58, 11.5), (31.6, -5.3, 117.7)  # through the fist center (36, -24, 80)
    parts.append(rod(a, b, 3.5))
    parts.append(box(44, 6, 5, a))
    parts += [box(2.6, 2.6, 5, (a[0] + x, a[1], 7.5)) for x in range(-20, 21, 5)]

    base = m3.Manifold.extrude(m3.CrossSection.square([190, 110], True).offset(8, m3.JoinType.Round), 4)
    top = m3.Manifold.extrude(m3.CrossSection.square([186, 106], True).offset(6, m3.JoinType.Round), 2.5).translate([0, 0, 3.5])
    parts.append((base + top).translate([-5, -12, 0]))
    return m3.Manifold.batch_boolean(parts, m3.OpType.Add)


if __name__ == "__main__":
    save(robot(), "robot", edge=2.5)
    save(bear(), "bear")
    save(rocket(), "rocket", edge=2.5)
    save(gardener(), "gardener", edge=4, weld=True)
