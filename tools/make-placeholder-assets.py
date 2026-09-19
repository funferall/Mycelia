"""
Build the placeholder 3D asset set with Blender, headless.

    "C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe" \
        --background --python tools/make-placeholder-assets.py

These are deliberately simple, low-poly stand-ins for authored art, not final
models. They exist so the game's asset intake pipeline has real files to load,
scale, anchor and tint before the art pass lands.

Conventions, which the asset contract in DESIGN.md states in full:

* metres, Blender Z-up in the file, exported Y-up (the glTF exporter's default),
  which is what the game expects;
* origin at the base of the trunk, so a tree can be dropped onto terrain,
  scaled to a simulation height, and photographed from its own ground;
* one mesh object per asset, flat low-poly with per-part materials;
* deterministic: the same script always writes the same vertices.
"""

import math
import os
import random

import bpy
from mathutils import Vector

SEED = 20260918
random.seed(SEED)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_ROOT = os.path.normpath(os.path.join(HERE, "..", "public", "assets"))


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name: str, color: tuple[float, float, float], roughness: float = 0.9):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def cone_between(a: Vector, b: Vector, r1: float, r2: float, mat, verts: int = 8):
    """A tapered limb from a to b, as a cone aligned to that direction."""
    direction = b - a
    length = direction.length
    bpy.ops.mesh.primitive_cone_add(
        vertices=verts, radius1=r1, radius2=r2, depth=length, location=(a + b) / 2
    )
    obj = bpy.context.active_object
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(direction.normalized())
    obj.data.materials.append(mat)
    return obj


def blob(center: Vector, radius: float, mat, squash: float = 0.72, subdiv: int = 2):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdiv, radius=radius, location=center)
    obj = bpy.context.active_object
    obj.scale = (1.0, 1.0, squash)
    obj.rotation_euler = (
        random.uniform(-0.4, 0.4),
        random.uniform(-0.4, 0.4),
        random.uniform(0.0, math.tau),
    )
    obj.data.materials.append(mat)
    return obj


def join(objects, name: str):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    joined = bpy.context.active_object
    joined.name = name
    # Origin at the world origin: the base of the trunk for a tree, the ground
    # contact for a prop. The game anchors on it rather than guessing a centre.
    bpy.context.scene.cursor.location = (0.0, 0.0, 0.0)
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    # Foliage reads as a mass and wants smooth shading; trunks and props are
    # built from cones and cylinders whose hard edges are the point. Shading
    # follows the material rather than the object so one asset can do both.
    soft = {
        index
        for index, mat in enumerate(joined.data.materials)
        if any(word in mat.name for word in ("leaf", "needle", "foliage", "cap"))
    }
    for polygon in joined.data.polygons:
        polygon.use_smooth = polygon.material_index in soft
    return joined


def export(obj, relative_path: str) -> None:
    path = os.path.join(OUT_ROOT, relative_path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
    )
    print(f"wrote {path} ({len(obj.data.polygons)} faces)")


def oak():
    """Stout trunk, heavy spreading limbs, a broad dome of foliage."""
    bark = material("oak-bark", (0.24, 0.19, 0.14))
    leaf = material("oak-leaf", (0.22, 0.34, 0.14))
    parts = [cone_between(Vector((0, 0, 0)), Vector((0, 0, 4.4)), 0.62, 0.38, bark, 10)]

    crown: list[Vector] = []
    for i in range(6):
        angle = i * (math.tau / 6) + 0.35
        start = Vector((0, 0, 3.0 + i * 0.18))
        reach = 2.4 + random.uniform(-0.3, 0.5)
        end = Vector((math.cos(angle) * reach, math.sin(angle) * reach, 6.2 + random.uniform(-0.4, 0.6)))
        parts.append(cone_between(start, end, 0.30, 0.12, bark))
        for j in range(2):
            swing = angle + j * 1.2 - 0.6
            tip = end + Vector(
                (math.cos(swing) * 1.3, math.sin(swing) * 1.3, 0.9 + random.uniform(-0.2, 0.5))
            )
            parts.append(cone_between(end, tip, 0.11, 0.05, bark, 6))
            crown.append(tip)
    crown.append(Vector((0, 0, 7.3)))
    for point in crown:
        parts.append(blob(point, random.uniform(1.05, 1.5), leaf, 0.62))
    return join(parts, "oak")


def birch():
    """Slim pale trunk, upright limbs, a light and airy crown."""
    bark = material("birch-bark", (0.78, 0.76, 0.70), 0.85)
    leaf = material("birch-leaf", (0.33, 0.46, 0.18))
    parts = [cone_between(Vector((0, 0, 0)), Vector((0.12, 0.06, 6.5)), 0.28, 0.16, bark, 8)]

    crown: list[Vector] = []
    for i in range(6):
        angle = i * (math.tau / 6) + 0.2
        start = Vector((0.1, 0.05, 4.0 + i * 0.3))
        end = start + Vector((math.cos(angle) * 1.3, math.sin(angle) * 1.3, 2.2 + random.uniform(-0.2, 0.5)))
        parts.append(cone_between(start, end, 0.12, 0.04, bark, 6))
        crown.append(end)
        # A lighter second clump per limb keeps the birch airy rather than a
        # scaled-down oak.
        crown.append(end + Vector((random.uniform(-0.6, 0.6), random.uniform(-0.6, 0.6), 0.9)))
    crown.append(Vector((0.12, 0.06, 8.1)))
    for point in crown:
        parts.append(blob(point, random.uniform(0.6, 0.95), leaf, 0.82))
    return join(parts, "birch")


def hemlock():
    """One straight leader with even, dark, drooping tiers."""
    bark = material("hemlock-bark", (0.20, 0.16, 0.13))
    needle = material("hemlock-needle", (0.13, 0.24, 0.15))
    parts = [cone_between(Vector((0, 0, 0)), Vector((0, 0, 7.2)), 0.45, 0.10, bark, 8)]
    for tier in range(7):
        z = 1.6 + tier * 0.78
        radius = 3.1 * (1.0 - tier / 8.6)
        bpy.ops.mesh.primitive_cone_add(
            vertices=9, radius1=radius, radius2=0.02, depth=1.5, location=(0, 0, z)
        )
        skirt = bpy.context.active_object
        skirt.data.materials.append(needle)
        parts.append(skirt)
        # A shorter inner tier breaks the silhouette out of a plain Christmas
        # tree, which is what makes it read as a hemlock rather than a cone.
        bpy.ops.mesh.primitive_cone_add(
            vertices=8, radius1=radius * 0.62, radius2=0.02, depth=1.9, location=(0, 0, z + 0.42)
        )
        inner = bpy.context.active_object
        inner.data.materials.append(needle)
        parts.append(inner)
    parts.append(blob(Vector((0, 0, 7.4)), 0.55, needle, 1.5))
    return join(parts, "hemlock")


def stump():
    """A cut trunk with a pale sawn top: deadwood the network can reach."""
    bark = material("stump-bark", (0.23, 0.17, 0.12))
    cut = material("stump-cut", (0.62, 0.52, 0.36), 0.95)
    parts = [cone_between(Vector((0, 0, 0)), Vector((0.05, 0.03, 1.5)), 0.72, 0.58, bark, 10)]
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.58, depth=0.08, location=(0.05, 0.03, 1.52))
    top = bpy.context.active_object
    top.data.materials.append(cut)
    parts.append(top)
    for i in range(4):
        angle = i * (math.tau / 4) + 0.4
        start = Vector((0.05, 0.03, 0.25))
        end = start + Vector((math.cos(angle) * 1.4, math.sin(angle) * 1.4, -0.35))
        parts.append(cone_between(start, end, 0.22, 0.07, bark, 6))
    return join(parts, "stump")


def fallen_log():
    """A log lying across the ground, raised on one end."""
    bark = material("log-bark", (0.26, 0.20, 0.14))
    cut = material("log-cut", (0.58, 0.48, 0.34), 0.95)
    parts = [cone_between(Vector((0, -2.6, 0.34)), Vector((0.2, 2.6, 0.46)), 0.42, 0.36, bark, 10)]
    for end in (Vector((0, -2.62, 0.34)), Vector((0.2, 2.62, 0.46))):
        bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.37, depth=0.06, location=end)
        cap = bpy.context.active_object
        cap.rotation_euler = (math.pi / 2, 0, 0.05)
        cap.data.materials.append(cut)
        parts.append(cap)
    for i in range(3):
        angle = i * (math.tau / 3) + 0.8
        start = Vector((0.1, -0.6 + i * 0.7, 0.3))
        end = start + Vector((math.cos(angle) * 0.9, math.sin(angle) * 0.5, 0.55))
        parts.append(cone_between(start, end, 0.09, 0.03, bark, 6))
    return join(parts, "log")


def fruiting_body():
    """A mushroom: the surface signal that the network has fruited."""
    stalk = material("mushroom-stalk", (0.86, 0.82, 0.70), 0.85)
    cap = material("mushroom-cap", (0.55, 0.29, 0.16), 0.8)
    parts = [cone_between(Vector((0, 0, 0)), Vector((0, 0, 0.72)), 0.16, 0.11, stalk, 8)]
    bpy.ops.mesh.primitive_uv_sphere_add(segments=14, ring_count=8, radius=0.46, location=(0, 0, 0.78))
    dome = bpy.context.active_object
    dome.scale = (1.0, 1.0, 0.62)
    dome.data.materials.append(cap)
    parts.append(dome)
    return join(parts, "fruiting-body")


def main() -> None:
    builders = {
        "trees/oak.glb": oak,
        "trees/birch.glb": birch,
        "trees/hemlock.glb": hemlock,
        "props/stump.glb": stump,
        "props/log.glb": fallen_log,
        "fungi/fruiting-body.glb": fruiting_body,
    }
    for relative, build in builders.items():
        clear_scene()
        random.seed(SEED + sum(ord(c) for c in relative))
        export(build(), relative)


main()
