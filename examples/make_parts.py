"""Build the replacement parts used by the Examples gallery, in the robot's own coordinates (so they drop in place).

    uv run --with manifold3d --with trimesh python examples/make_parts.py

Writes examples/robot/parts/<name>.stl:
- top_hat, party_hat, crown: hats that replace the antenna, sitting on top of the head (z = 112)
- round_head: a round head with big eyes that replaces the square head and neck
"""
import pathlib
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


def save(man, name):
    mesh = man.to_mesh()
    tm = trimesh.Trimesh(mesh.vert_properties[:, :3], mesh.tri_verts, process=True)
    HERE.mkdir(parents=True, exist_ok=True)
    tm.export(HERE / f"{name}.stl")


if __name__ == "__main__":
    for f in (top_hat, party_hat, crown, round_head):
        save(f(), f.__name__)
