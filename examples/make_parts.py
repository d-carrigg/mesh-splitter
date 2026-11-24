"""Build the replacement parts used by the Examples gallery, in the robot's own coordinates (so they drop in place).

    uv run --with manifold3d --with trimesh python examples/make_parts.py

Writes examples/robot/parts/<name>.stl:
- top_hat, party_hat, crown: hats that replace the antenna, sitting on top of the head (z = 112)
- round_head: a round head with big eyes that replaces the square head and neck

and examples/gardener/parts/<name>.stl, in the gardener's coordinates:
- cap: a baseball cap that replaces the straw hat (with its band merged in)
- shovel: a shovel that replaces the rake, on the same handle line through the right fist
"""
import pathlib
import numpy as np
import manifold3d as m3
import trimesh

HERE = pathlib.Path(__file__).parent / "robot" / "parts"
SEG = 64
TOP = 112.0  # top of the robot's head


def cyl(r, h, z, r2=None, x=0.0, y=0.0):
    return m3.Manifold.cylinder(h, r, r if r2 is None else r2, SEG).translate([x, y, z])


def sphere(r, at, seg=SEG):
    return m3.Manifold.sphere(r, seg).translate(at)


def top_hat():
    return cyl(14, 1.6, TOP) + cyl(9, 15, TOP + 1.2) + cyl(9.4, 3, TOP + 2.4)  # brim, crown, band


def party_hat():
    return cyl(10, 22, TOP, r2=0.8) + sphere(3, (0, 0, TOP + 22.5))


def crown():
    ring = cyl(11.5, 7, TOP) - cyl(10, 9, TOP - 1)
    spikes = []
    for k in range(6):
        a = k * 60
        spike = m3.Manifold.cylinder(7, 2.4, 0.3, 24).translate([10.75, 0, TOP + 7]).rotate([0, 0, a])
        ball = sphere(1.4, (10.75, 0, TOP + 14.2), 16).rotate([0, 0, a])
        spikes += [spike, ball]
    return m3.Manifold.batch_boolean([ring, *spikes], m3.OpType.Add)


def round_head():
    head = sphere(14, (0, 0, 99))
    neck = cyl(5, 8, 81)
    eyes = [cyl(4.5, 4, 0).rotate([90, 0, 0]).translate([s * 5.5, -11, 102]) for s in (-1, 1)]
    mouth = m3.Manifold.cube([10, 4, 2.5], True).translate([0, -12.6, 93])
    ears = [m3.Manifold.cylinder(6, 3.5, 3.5, SEG, True).rotate([0, 90, 0]).translate([s * 13.5, 0, 99]) for s in (-1, 1)]
    return m3.Manifold.batch_boolean([head, neck, *eyes, mouth, *ears], m3.OpType.Add)


HEAD = (0, -1, 136)  # the gardener's head: center, radius 18
FIST = np.array([36, -24, 80.0])  # center of the right fist; the rake handle runs along AXIS through it
AXIS = np.array([-8, 34, 68.5]) / np.linalg.norm([-8, 34, 68.5])


def along_axis(man, at):
    """Turn a part built along +Z so it runs along the handle line, then move its origin to the point `at`."""
    pitch, yaw = np.degrees(np.arccos(AXIS[2])), np.degrees(np.arctan2(AXIS[1], AXIS[0]))
    return man.rotate([0, pitch, 0]).rotate([0, 0, yaw]).translate(list(at))


def cap():
    x, y, z = HEAD
    crown = sphere(19.2, (x, y, z)) - m3.Manifold.cube([60, 60, 60], True).translate([x, y, z + 9 - 30])
    visor = (m3.Manifold.cylinder(2, 16, 16, SEG).scale([1, 0.75, 1]).translate([x, y - 16, z + 9])
             - m3.Manifold.cube([40, 40, 10], True).translate([x, y + 4, z + 9]))
    button = sphere(2.2, (x, y, z + 19))
    return m3.Manifold.batch_boolean([crown, visor, button], m3.OpType.Add)


def shovel():
    lo = FIST - AXIS * 44.5  # bottom of the handle, where the blade starts
    handle = m3.Manifold.cylinder(98, 3.5, 3.5, SEG)
    grip = (m3.Manifold.cube([4, 16, 4], True).translate([0, 0, 102])
            + m3.Manifold.cylinder(6, 2.5, 2.5, SEG).translate([0, -7, 96])
            + m3.Manifold.cylinder(6, 2.5, 2.5, SEG).translate([0, 7, 96]))
    socket = m3.Manifold.cylinder(10, 4.5, 3.6, SEG).translate([0, 0, -6])
    blade = m3.Manifold.extrude(m3.CrossSection([[[-12, 0], [-12, -24], [0, -32], [12, -24], [12, 0]]]), 2.4).rotate([90, 0, 0])
    return along_axis(m3.Manifold.batch_boolean([handle, grip, socket, blade.translate([0, 1.2, -4]).rotate([0, 0, 90])], m3.OpType.Add), lo)


def save(man, name, here=HERE):
    mesh = man.to_mesh()
    tm = trimesh.Trimesh(mesh.vert_properties[:, :3], mesh.tri_verts, process=True)
    here.mkdir(parents=True, exist_ok=True)
    tm.export(here / f"{name}.stl")


if __name__ == "__main__":
    for f in (top_hat, party_hat, crown, round_head):
        save(f(), f.__name__)
    for f in (cap, shovel):
        save(f(), f.__name__, HERE.parent.parent / "gardener" / "parts")
