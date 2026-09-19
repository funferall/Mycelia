"""Build Mycelia's original, texture-free botanical asset pack in Blender 4.2.

    blender --background --python tools/make-forest-assets.py -- --render

Default output: public/assets. --output DIR supports isolated rebuild checks.
--render imports the exported GLBs again and photographs them in design/shots.
Geometry is authored here in metres, Z-up; glTF export converts it to Y-up.
No downloaded models, textures, add-ons, or paid services are required.
"""

import argparse
import json
import math
from pathlib import Path
import random
import sys

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
SEED = 20260919
TAU = math.tau


def vec(x, y, z):
    return Vector((x, y, z))


def radial(angle, reach, height):
    return vec(math.cos(angle) * reach, math.sin(angle) * reach, height)


def material(name, color, double=False):
    result = bpy.data.materials.new(name)
    result.diffuse_color = (*color, 1)
    result.use_nodes = True
    shader = result.node_tree.nodes['Principled BSDF']
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = 0.92
    result.use_backface_culling = not double
    return result


class Mesh:
    """One draw primitive per material, regardless of how many branches/leaves."""

    def __init__(self, name, materials, lod=0):
        self.name, self.materials = name, materials
        self.lod = lod
        self.vertices, self.faces, self.slots = [], [], []

    def face(self, points, slot=0):
        start = len(self.vertices)
        self.vertices.extend(tuple(p) for p in points)
        self.faces.append(tuple(range(start, start + len(points))))
        self.slots.append(slot)

    def tube(self, points, radii, slot=0, sides=6, cap=True):
        if self.lod:
            sides = 3 if self.lod == 2 else max(3, sides - 2)
            if len(points) == 3:
                points, radii = [points[0], points[-1]], [radii[0], radii[-1]]
            if self.lod == 2 and len(points) > 3:
                points, radii = points[::2] + [points[-1]], radii[::2] + [radii[-1]]
        rings = []
        for i, (point, radius) in enumerate(zip(points, radii)):
            direction = points[min(i + 1, len(points) - 1)] - points[max(0, i - 1)]
            direction.normalize()
            axis = direction.cross(vec(0, 1, 0)).normalized()
            if axis.length < 0.1:
                axis = direction.cross(vec(1, 0, 0)).normalized()
            side = direction.cross(axis).normalized()
            rings.append([point + radius * (axis * math.cos(j * TAU / sides)
                                           + side * math.sin(j * TAU / sides))
                          for j in range(sides)])
        for lower, upper in zip(rings, rings[1:]):
            for j in range(sides):
                k = (j + 1) % sides
                self.face([lower[j], lower[k], upper[k], upper[j]], slot)
        if cap:
            self.face(list(reversed(rings[0])), slot)
            self.face(rings[-1], slot)

    def leaf(self, center, length, width, angle, tilt=0.2, slot=1):
        along = radial(angle, length, length * tilt)
        across = radial(angle + math.pi / 2, width, 0)
        # A folded blade: two opaque triangles; no texture or alpha sorting.
        self.face([center - along * .5, center + across,
                   center + along * .5], slot)
        self.face([center - along * .5, center + along * .5,
                   center - across + vec(0, 0, width * .3)], slot)

    def object(self):
        data = bpy.data.meshes.new(self.name)
        data.from_pydata(self.vertices, [], self.faces)
        data.update()
        obj = bpy.data.objects.new(self.name, data)
        bpy.context.collection.objects.link(obj)
        for mat in self.materials:
            data.materials.append(mat)
        for face, slot in zip(data.polygons, self.slots):
            face.material_index = slot
        # Weld the tube rings for decimation and ensure consistent normals.
        bpy.ops.object.select_all(action='DESELECT')
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.remove_doubles(threshold=0.00001)
        bpy.ops.mesh.normals_make_consistent(inside=False)
        bpy.ops.object.mode_set(mode='OBJECT')
        return obj


def palette(species, dead=False):
    colors = {'oak': (.20, .145, .095), 'birch': (.56, .43, .25),
              'hemlock': (.17, .115, .08)}
    bark = material(species + '-bark', (.24, .205, .16) if dead else colors[species])
    if dead:
        return [bark, material('exposed-heartwood', (.43, .33, .20))]
    foliage = material(species + ('-needle' if species == 'hemlock' else '-leaf'),
                       (.095, .20, .095) if species == 'hemlock' else (.23, .36, .095), True)
    return [bark, foliage]


def crown_spray(mesh, center, angle, rng, birch=False, count=16):
    if mesh.lod:
        count = 6 if mesh.lod == 1 else 3
    blade_scale = (1, 1.35, 2.1)[mesh.lod]
    for i in range(count):
        phase = i * 2.39996 + angle
        radius = .25 + .86 * math.sqrt((i + .5) / count)
        offset = radial(phase, radius, rng.uniform(-.36, .40))
        mesh.leaf(center + offset, rng.uniform(.7, 1.05) * (.76 if birch else 1) * blade_scale,
                  (.22 if birch else .32) * blade_scale, phase + .4, rng.uniform(-.45, .45))


def tree(species, dead=False, sapling=False, lod=0):
    rng = random.Random(SEED + sum(map(ord, species)))
    mesh = Mesh(species + ('-dead' if dead else ''), palette(species, dead), lod)
    birch = species == 'birch'
    pine = species == 'hemlock'
    height = 13.5 if pine else 12.0 if birch else 11.0
    radius = .29 if birch else .48 if pine else .63
    points = [vec(0, 0, 0), vec(.08, -.04, height * .15),
              vec(-.10, .10, height * .34), vec(.15, .06, height * .56),
              vec(.30, -.04, height * .80), vec(.12, .12, height)]
    radii = [radius, radius * .77, radius * .62, radius * .43, radius * .22, .018]
    if dead:
        # Open, dark hollow and a ragged rim built as real interior geometry.
        hollow(mesh, radius, height * .38, sides=9 if lod < 2 else 7, doorway=True)
        mesh.tube(points[2:], radii[2:], sides=6)
    else:
        mesh.tube(points, radii, sides=8)
    root_count = 3 if lod == 2 else 5
    for i in range(root_count):
        angle = i * TAU / root_count + .3
        mesh.tube([vec(0, 0, .35), radial(angle, radius * 1.6, .14),
                   radial(angle + .1, radius * 2.8, .025)],
                  [radius * .35, radius * .18, .015], sides=4)
    if pine:
        tier_count = 4 if sapling else 7
        for tier in range(tier_count):
            z = 2.5 + tier * (9 / tier_count)
            reach = 3.9 * (1 - tier / (tier_count + 1.2))
            branch_count = 3 if lod == 2 else 5
            for j in range(branch_count):
                angle = j * TAU / branch_count + tier * .72 + rng.uniform(-.16, .16)
                reach_local = reach * rng.uniform(.83, 1.12)
                origin = vec(.06, 0, z)
                elbow = origin + radial(angle, reach_local * .55, -.28)
                tip = origin + radial(angle + .07, reach_local, -.45)
                mesh.tube([origin, elbow, tip], [.12 * (1 - tier / 9), .055, .009], sides=4)
                if not dead:
                    spray_count = (5, 3, 2)[lod]
                    for k in range(spray_count):
                        t = k / (spray_count - 1)
                        center = elbow.lerp(tip, t)
                        width = reach * (.19, .26, .40)[lod] * (1 - t * .66)
                        mesh.leaf(center, reach * (.7 if lod < 2 else .95), width, angle, -.16)
                        if lod < 2:
                            mesh.leaf(center + radial(angle + .8, width, .06),
                                      reach * .55, width * .7, angle + .55, -.22)
        if not dead:
            mesh.leaf(vec(.13, .08, height - .3), 1.0, .25, .7, 1.1)
    else:
        branch_count = (4 if sapling else 6) if lod == 2 else (5 if sapling else 10)
        for i in range(branch_count):
            progress = i * ((4 if sapling else 9) / (branch_count - 1))
            angle = progress * 2.39996 + .25
            start = vec(.05, .04, 3.5 + progress * (.55 if birch else .25))
            reach = (2.0 if birch else 3.5) * (1 - progress * .043)
            elbow = start + radial(angle, reach * .65, 1.1)
            end = start + radial(angle + .18, reach, 2.0 if birch else 3.0 + progress * .12)
            mesh.tube([start, elbow, end], [radius * .35, .12, .03], sides=5)
            for j in range(2 if lod == 2 else 3):
                swing = angle + (j - (.5 if lod == 2 else 1)) * .8
                tip = end + radial(swing, .7 if birch else 1.0, .8 + rng.random() * .5)
                mesh.tube([end, tip], [.045, .008], sides=3)
                if not dead:
                    crown_spray(mesh, tip, swing, rng, birch, 14)
        if not dead:
            crown_spray(mesh, points[-1], 0, rng, birch, 18)
    if birch and not dead and lod == 0:
        # Yellow birch: bronze papery bark and dark horizontal lenticels.
        for i in range(14):
            z = .6 + i * .32
            center = points[0].lerp(points[2], z / points[2].z)
            radius_at = radius * (1 - .38 * z / points[2].z)
            angle = i * 2.39996
            p = center + radial(angle, radius_at + .012, 0)
            side = radial(angle + math.pi / 2, .14, .012)
            mesh.face([p - side, p + side, p + side + vec(0, 0, .045),
                       p - side + vec(0, 0, .028)], 0)
    obj = mesh.object()
    # The base plane is the contact plane; clamp root cross sections to it.
    for vertex in obj.data.vertices:
        vertex.co.z = max(0, vertex.co.z)
    if birch and not dead and lod == 0:
        dark = material('birch-lenticels', (.085, .065, .045))
        obj.data.materials.append(dark)
        for face in list(obj.data.polygons)[-14:]:
            face.material_index = 2
    if sapling:
        for vertex in obj.data.vertices:
            vertex.co *= .20
        obj.name = species + '-sapling'
    return obj, vec(.15, 0, height * .77) * (.20 if sapling else 1)


def hollow(mesh, radius, height, sides=10, doorway=False):
    # Both inner wall and cavity floor use wood, never a foliage-tinted material.
    bottom = [radial(i * TAU / sides, radius, 0) for i in range(sides)]
    outer = [radial(i * TAU / sides, radius * .79,
                    height * (1 + .05 * math.sin(i * 4.1))) for i in range(sides)]
    inner = [vec(p.x * .62, p.y * .62, p.z - .025) for p in outer]
    floor = [vec(p.x, p.y, .025 if doorway else height * .23) for p in inner]
    for i in range(sides):
        j = (i + 1) % sides
        if doorway and i in (5, 6):
            lip_i = bottom[i].lerp(outer[i], .55)
            lip_j = bottom[j].lerp(outer[j], .55)
            inner_i = floor[i].lerp(inner[i], .55)
            inner_j = floor[j].lerp(inner[j], .55)
            mesh.face([lip_i, lip_j, outer[j], outer[i]])
            mesh.face([lip_j, lip_i, inner_i, inner_j], 1)
            mesh.face([inner[i], inner[j], inner_j, inner_i])
            if i == 5:
                mesh.face([bottom[i], lip_i, inner_i, floor[i]], 1)
            if i == 6:
                mesh.face([lip_j, bottom[j], floor[j], inner_j], 1)
        else:
            mesh.face([bottom[i], bottom[j], outer[j], outer[i]])
            mesh.face([inner[i], inner[j], floor[j], floor[i]])
        mesh.face([outer[i], outer[j], inner[j], inner[i]], 1)
    mesh.face(floor)
    mesh.face(list(reversed(bottom)))


def deadwood(kind):
    mesh = Mesh(kind, [material('weathered-bark', (.21, .145, .095)),
                       material('broken-heartwood', (.49, .35, .18))])
    if kind == 'stump':
        hollow(mesh, .7, 1.15)
        for i in range(5):
            a = i * TAU / 5
            mesh.tube([vec(0, 0, .3), radial(a, 1.1, .12), radial(a, 1.4, .03)],
                      [.22, .12, .02], sides=5)
    elif kind == 'log':
        mesh.tube([vec(-2.7, 0, .48), vec(-.4, .09, .44), vec(2.6, -.1, .45)],
                  [.40, .45, .32], sides=10, cap=False)
        for x, radius in [(-2.7, .39), (2.6, .31)]:
            mesh.face([vec(x, math.sin(i * TAU / 10) * radius,
                           .46 + math.cos(i * TAU / 10) * radius) for i in range(10)], 1)
        for i in range(3):
            mesh.tube([vec(i - 1, 0, .6), vec(i - .7, .45, 1.05)], [.14, .025], sides=5)
    elif kind == 'snag':
        hollow(mesh, .52, 5.0, 9)
        for i in range(5):
            start = vec(0, 0, 1.5 + i * .6)
            mesh.tube([start, start + radial(i * 2.4, 1.2, .7)], [.18, .025], sides=5)
    else:
        # Windthrown root plate: an upright soil fan with exposed radial roots.
        mesh.materials.append(material('root-soil', (.12, .085, .05), True))
        outline = [vec(math.cos(i * math.pi / 8) * (1.65 + .16 * math.sin(i * 2.1)),
                       .1 + .11 * math.sin(i * 1.7),
                       .15 + math.sin(i * math.pi / 8) * (2.0 + .24 * math.sin(i * 3.7)))
                   for i in range(9)]
        for i in range(9):
            p = outline[i]
            if i < 8:
                mesh.face([vec(0, .22, .15), p, outline[i + 1]], 2)
            mesh.tube([vec(0, 0, .3), p * .68, p + vec(.14, -.2, .05)],
                      [.19, .09, .015], sides=5)
            mesh.tube([p * .68, p + vec(.3, -.45, -.2)], [.07, .009], sides=4)
        mesh.tube([vec(0, 0, .4), vec(0, -2.0, .3)], [.44, .28], sides=9)
    obj = mesh.object()
    ground(obj)
    return obj, None


def understory(kind):
    rng = random.Random(SEED)
    mesh = Mesh(kind, [material('stem', (.17, .21, .075)),
                       material(kind + '-foliage', (.17, .30, .085), True)])
    if kind == 'fern':
        for i in range(8):
            angle = i * TAU / 8
            reach = .65 + rng.random() * .3
            points = [vec(0, 0, .025), radial(angle, reach * .28, .5),
                      radial(angle, reach * .72, .64), radial(angle, reach, .46)]
            mesh.tube(points, [.018, .013, .009, .002], sides=3)
            for j in range(7):
                t = (j + 1) / 8
                center = radial(angle, reach * t, .16 + .53 * math.sin(t * 2.2))
                length = .28 * math.sin(t * math.pi) + .06
                for sign in [-1, 1]:
                    direction = angle + sign * 1.0
                    mesh.leaf(center + radial(direction, length * .4, 0),
                              length, length * .15, direction, .05)
    else:
        for i in range(28):
            a = i * 2.39996
            base = radial(a, rng.uniform(.01, .18), 0)
            height = rng.uniform(.32, .8)
            bend = base + radial(a, .16, height * .65)
            tip = base + radial(a, .35, height)
            side = radial(a + math.pi / 2, .018, 0)
            mesh.face([base - side, base + side, bend + side, bend - side], 1)
            mesh.face([bend - side, bend + side, tip], 1)
    return mesh.object(), None


def lathe(mesh, center, profile, sides=12, slot=0):
    rings = [[center + radial(i * TAU / sides, radius, z) for i in range(sides)]
             for radius, z in profile]
    for lower, upper in zip(rings, rings[1:]):
        for i in range(sides):
            j = (i + 1) % sides
            mesh.face([lower[i], lower[j], upper[j], upper[i]], slot)


def fungus(kind):
    mesh = Mesh(kind, [material('fungus-stem', (.72, .63, .43)),
                       material('fungus-cap', (.42, .20, .065)),
                       material('fungus-gills', (.57, .46, .29))])
    if kind in ('fruiting-body', 'fruiting-cluster'):
        centers = [(0, 0, 1)] if kind == 'fruiting-body' else [(0, 0, 1), (.4, .15, .65), (-.27, .28, .48)]
        for x, y, size in centers:
            origin = vec(x, y, 0)
            mesh.tube([origin, origin + vec(.025, -.025, .38 * size),
                       origin + vec(.04, 0, .66 * size)],
                      [.085 * size, .06 * size, .075 * size], sides=7)
            lathe(mesh, origin, [(r * size, z * size) for r, z in
                  [(.005, .80), (.16, .78), (.32, .70), (.41, .60), (.32, .57), (.08, .62)]],
                  sides=10, slot=1)
            for i in range(12):
                a = i * TAU / 12
                mesh.face([origin + radial(a, .075 * size, .62 * size),
                           origin + radial(a, .39 * size, .60 * size),
                           origin + radial(a + .15, .29 * size, .574 * size)], 2)
    elif kind == 'underground-fruiting-body':
        # A small truffle-like reproductive body, distinct from procedural roots.
        lathe(mesh, vec(0, 0, 0), [(.02, 0), (.22, .045), (.33, .22),
              (.28, .42), (.1, .52), (.002, .53)], sides=11, slot=1)
        for i in range(7):
            a = i * 2.4
            mesh.tube([radial(a, .16, .12), radial(a + .15, .36, .05),
                       radial(a + .4, .44, .01)], [.018, .01, .002], sides=3)
    else:
        lathe(mesh, vec(0, 0, 0), [(.002, 0), (.09, .035), (.15, .14),
              (.16, .25), (.10, .37), (.002, .42)], sides=10, slot=0)
        for i in range(10):
            a = i * TAU / 10
            mesh.tube([radial(a, .145, .21), radial(a, .185, .23)], [.018, .002], sides=3)
    obj = mesh.object()
    for face in obj.data.polygons:
        face.use_smooth = kind != 'underground-fruiting-body'
    return obj, None


def rock(kind):
    rng = random.Random(SEED + len(kind))
    mesh = Mesh(kind, [material('stone', (.29, .30, .265)),
                       material('moss', (.19, .25, .08))])
    centers = [(0, 0, 1)] if kind == 'boulder' else [(-.6, 0, .65), (.35, .2, .85), (.95, -.12, .5)]
    for x, y, size in centers:
        rings = []
        for z, radius in [(0, .65), (.3, 1), (.85, .7), (1.06, .15)]:
            rings.append([vec(x + math.cos(i * TAU / 7) * radius * size * rng.uniform(.88, 1.12),
                              y + math.sin(i * TAU / 7) * radius * size * .75,
                              z * size * rng.uniform(.9, 1.1)) for i in range(7)])
        for lower, upper in zip(rings, rings[1:]):
            for i in range(7):
                j = (i + 1) % 7
                mesh.face([lower[i], lower[j], upper[j], upper[i]],
                          int(kind == 'boulder' and upper[i].z > .65 and i % 3 == 0))
        mesh.face(rings[-1])
        mesh.face(list(reversed(rings[0])))
    return mesh.object(), None


def ground(obj):
    low = min(v.co.z for v in obj.data.vertices)
    for vertex in obj.data.vertices:
        vertex.co.z -= low


def triangle_count(obj):
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


def export_asset(obj, anchor, path, asset_id, lod, budget):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    obj.name = asset_id.replace('.', '_') + '_LOD' + str(lod)
    obj['asset_id'] = asset_id
    obj['lod'] = lod
    obj['season_mode'] = 'procedural-tint'
    if anchor is not None:
        empty = bpy.data.objects.new('anchor_crown', None)
        bpy.context.collection.objects.link(empty)
        empty.location = anchor
        empty.select_set(True)
    else:
        empty = None
    count = triangle_count(obj)
    if count > budget:
        raise ValueError(f'{asset_id} LOD{lod}: {count} triangles exceeds {budget}')
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB',
                              use_selection=True, export_apply=True, export_extras=True,
                              export_yup=True, export_animations=False)
    if empty:
        bpy.data.objects.remove(empty, do_unlink=True)
    print(f'ASSET {path.name}: {count} triangles')
    return {'file': path.as_posix(), 'triangles': count, 'maxTriangles': budget,
            'bytes': path.stat().st_size}


def make_lod(source, level, build):
    if level:
        obj, _ = build(level)
        # All tiers share the same physical height and ground plane. Anchors are
        # identical; the runtime must likewise use LOD0 height for dead variants.
        before = [min(v.co.z for v in source.data.vertices), max(v.co.z for v in source.data.vertices)]
        after = [min(v.co.z for v in obj.data.vertices), max(v.co.z for v in obj.data.vertices)]
        for vertex in obj.data.vertices:
            vertex.co.z = before[0] + (vertex.co.z - after[0]) * (before[1] - before[0]) / (after[1] - after[0])
        obj.data.update()
    else:
        obj = source.copy()
        obj.data = source.data.copy()
        bpy.context.collection.objects.link(obj)
    return obj


def render_sheet(out, entries, name):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    tree_sheet = name in ('trees', 'lods')
    columns = 3 if tree_sheet else 4
    cell = 15 if tree_sheet else 5.5
    for index, entry in enumerate(entries):
        bpy.ops.object.select_all(action='DESELECT')
        bpy.ops.import_scene.gltf(filepath=str(out / entry['file']))
        imported = list(bpy.context.selected_objects)
        offset = vec((index % columns) * cell, -(index // columns) * cell, 0)
        for obj in imported:
            if obj.parent is None:
                obj.location += offset
        font = bpy.data.curves.new('label', 'FONT')
        font.body = entry['label']
        font.size = .52 if tree_sheet else .22
        label = bpy.data.objects.new('label', font)
        bpy.context.collection.objects.link(label)
        label.location = offset + vec(-cell * .42, -cell * .37, .01)
        font.materials.append(material('label-ink', (.18, .14, .095)))
    rows = math.ceil(len(entries) / columns)
    center = vec((columns - 1) * cell / 2, -(rows - 1) * cell / 2, 2 if tree_sheet else .5)
    bpy.ops.mesh.primitive_plane_add(size=250, location=(center.x, center.y, -.025))
    bpy.context.object.data.materials.append(material('specimen-paper', (.64, .59, .47)))
    bpy.ops.object.camera_add(location=center + vec(0, -30, 30))
    camera = bpy.context.object
    camera.rotation_euler = (center - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = max(columns * cell * 1.07, rows * cell * 1.02)
    bpy.context.scene.camera = camera
    bpy.ops.object.light_add(type='AREA', location=center + vec(-10, -5, 24))
    bpy.context.object.data.energy = 6500
    bpy.context.object.data.shape = 'DISK'
    bpy.context.object.data.size = 18
    bpy.ops.object.light_add(type='SUN', location=(0, 0, 20))
    bpy.context.object.rotation_euler = (.3, -.5, -.3)
    bpy.context.object.data.energy = 1.8
    scene = bpy.context.scene
    scene.world = bpy.data.worlds.new('studio')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.5, .55, .6, 1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value = .45
    scene.render.engine = 'CYCLES'
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 4
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 1400 if tree_sheet else 1100
    scene.render.resolution_percentage = 100
    target = ROOT / 'design' / 'shots' / ('forest-assets-' + name + '.png')
    target.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(target)
    bpy.ops.render.render(write_still=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT / 'public' / 'assets')
    parser.add_argument('--render', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    out = args.output.resolve()
    recipes = []
    for dead in (False, True):
        for species in ('oak', 'birch', 'hemlock'):
            stem = species + ('-dead' if dead else '')
            recipes.append((f'tree.{stem}', f'trees/{stem}',
                            lambda lod=0, s=species, d=dead: tree(s, d, lod=lod), True))
    for species in ('oak', 'birch', 'hemlock'):
        recipes.append((f'understory.{species}-sapling', f'understory/{species}-sapling',
                        lambda lod=0, s=species: tree(s, sapling=True, lod=lod), True))
    for kind in ('fern', 'grass'):
        recipes.append((f'understory.{kind}', f'understory/{kind}', lambda k=kind: understory(k), False))
    for kind in ('stump', 'log', 'snag', 'root-plate'):
        recipes.append((f'prop.{kind}', f'props/{kind}', lambda k=kind: deadwood(k), False))
    for kind in ('fruiting-body', 'fruiting-cluster', 'underground-fruiting-body', 'spore-body'):
        recipes.append(('fungus.' + ('fruitingBody' if kind == 'fruiting-body' else kind),
                        f'fungi/{kind}', lambda k=kind: fungus(k), False))
    for kind in ('boulder', 'stream-rocks'):
        recipes.append((f'prop.{kind}', f'props/{kind}', lambda k=kind: rock(k), False))
    manifest = {'schemaVersion': 1, 'generator': 'tools/make-forest-assets.py',
                'seed': SEED, 'units': 'metres', 'upAxis': 'Y',
                'seasonMode': 'procedural-tint', 'assets': []}
    for asset_id, stem, build, tiers in recipes:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        source, anchor = build()
        ground(source)
        entry = {'id': asset_id, 'lods': []}
        if asset_id.startswith('tree.'):
            entry['variant'] = 'dead-hollow' if asset_id.endswith('-dead') else 'living'
            entry['species'] = asset_id.split('.')[1].replace('-dead', '')
        if anchor is not None:
            entry['anchorCrown'] = [round(anchor.x, 5), round(anchor.z, 5), round(-anchor.y, 5)]
        for level in range(3 if tiers else 1):
            obj = make_lod(source, level, build)
            path = out / (stem + (f'-lod{level}' if level else '') + '.glb')
            record = export_asset(obj, anchor, path, asset_id, level,
                                  (2000, 900, 320)[level] if tiers else 500)
            record['file'] = path.relative_to(out).as_posix()
            entry['lods'].append(record)
            bpy.data.objects.remove(obj, do_unlink=True)
        manifest['assets'].append(entry)
    out.mkdir(parents=True, exist_ok=True)
    (out / 'forest-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    if args.render:
        trees = [{'file': e['lods'][0]['file'], 'label': e['id']} for e in manifest['assets'] if e['id'].startswith('tree.')]
        props = [{'file': e['lods'][0]['file'], 'label': e['id']} for e in manifest['assets'] if not e['id'].startswith('tree.')]
        render_sheet(out, trees, 'trees')
        render_sheet(out, props, 'props')
        lods = [{'file': tier['file'], 'label': f"{e['id']} / LOD{i}"}
                for e in manifest['assets'][:3] for i, tier in enumerate(e['lods'])]
        render_sheet(out, lods, 'lods')


if __name__ == '__main__':
    main()
