"""Forest v3: fuller trees in three forms per species, and a living forest floor.

Blender 4.2: blender --background --factory-startup --python tools/make-forest-v3-assets.py

Builds nine trees (oak, yellow birch and eastern hemlock, three forms each,
three tiers each) and fifteen forest-floor pieces with the same Mesh/material
helpers as tools/make-forest-assets.py, exports them under public/assets/, and
merges their entries into forest-manifest.json (replacing only its own ids).

Trees are crowns of overlapping leaf clumps on a branching frame; lower tiers
keep the same clumps with fewer, larger cards, so a distant crown stays full.
Budgets are set for the art, generously; the real-GPU check (npm run check:gpu)
is the performance gate.
"""
import importlib.util
import json
import math
import random
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('forest_assets', Path(__file__).with_name('make-forest-assets.py'))
pack = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pack)
vec, radial, material, Mesh = pack.vec, pack.radial, pack.material, pack.Mesh
TAU = math.tau
MOSS = (.085, .15, .04)
TREE_BUDGET = (4000, 2400, 1200)
FLOOR_BUDGET = 2000


# ---------------------------------------------------------------------------
# Building blocks
# ---------------------------------------------------------------------------

def card(mesh, c, n, size, slot, rng, aspect=.55, fold=.1):
    """A leaf card: a folded diamond facing roughly along n."""
    n = n.normalized()
    t = n.cross(Vector((0, 0, 1)))
    if t.length < .1:
        t = n.cross(Vector((1, 0, 0)))
    t.normalize()
    b = n.cross(t).normalized()
    a = rng.uniform(0, TAU)
    t, b = t * math.cos(a) + b * math.sin(a), b * math.cos(a) - t * math.sin(a)
    h, w = size / 2, size * aspect / 2
    mesh.face([c - t * h, c + b * w + n * size * fold, c + t * h, c - b * w + n * size * fold], slot)


def clump(mesh, center, rx, rz, count, size, rng, slot, squash_bottom=.55):
    """A leafy mass: cards over an ellipsoid shell and a sparser core, facing
    outward with jitter, so light and shade come from the shape itself."""
    golden = math.pi * (3 - math.sqrt(5))
    for i in range(count):
        y = 1 - 2 * (i + .5) / count
        r = math.sqrt(1 - y * y)
        th = i * golden
        d = Vector((math.cos(th) * r, math.sin(th) * r, y))
        if d.z < 0:
            d.z *= squash_bottom
        depth = rng.uniform(.62, 1.0) if i % 4 else rng.uniform(.3, .6)
        p = center + Vector((d.x * rx * depth, d.y * rx * depth, d.z * rz * depth))
        n = (d + Vector((rng.uniform(-.45, .45), rng.uniform(-.45, .45), rng.uniform(-.2, .5)))).normalized()
        card(mesh, p, n, size * rng.uniform(.75, 1.2), slot, rng)


def limb(mesh, a, b, r0, r1, rng, bend=.25, sides=6, slot=0):
    """A crooked limb: a tube from a to b through a jittered elbow."""
    mid = a.lerp(b, .5) + Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(0, 1))) * (a - b).length * bend * .4
    mesh.tube([a, mid, b], [r0, (r0 + r1) / 2, r1], slot, sides=sides)


def ridged_trunk(mesh, points, radii, sides, rng, slot=0, ridges=.07):
    """A trunk whose bark is ridged: each ring's radius wobbles with angle."""
    rings = []
    for i, (p, r) in enumerate(zip(points, radii)):
        rings.append([p + radial(j * TAU / sides, r * (1 + ridges * math.sin(j * 3.7 + i * 1.3) + rng.uniform(-.03, .03)), 0)
                      for j in range(sides)])
    for lo, hi in zip(rings, rings[1:]):
        for j in range(sides):
            k = (j + 1) % sides
            mesh.face([lo[j], lo[k], hi[k], hi[j]], slot)
    mesh.face(rings[-1], slot)


def buttress(mesh, radius, count, rng, slot=0):
    """Root flare that grips the ground: low, broad wedges, not spikes."""
    for i in range(count):
        a = i * TAU / count + rng.uniform(-.2, .2)
        reach = radius * rng.uniform(1.5, 1.9)
        mesh.tube([vec(0, 0, radius * 1.2), radial(a, radius * .9, radius * .4), radial(a + .08, reach, .06)],
                  [radius * .5, radius * .36, radius * .16], slot, sides=5)


# ---------------------------------------------------------------------------
# Trees
# ---------------------------------------------------------------------------

def broadleaf(name, seed, lod=0, *, h, girth, spread, crown_h, lean=0.0, twin=False, clumps=12, clump_r=1.8,
              cards=70, card_size=1.0, bark=(.17, .125, .085), leaf=(.20, .33, .085), peel=False, stubs=0):
    rng = random.Random(seed)
    mats = [material(name + '-bark', bark), material(name + '-leaf', leaf, True)]
    if peel:
        mats.append(material(name + '-peel', (.72, .60, .40)))
    mesh = Mesh(name, mats, lod)
    sides = (10, 8, 6)[lod]
    lean_dir = rng.uniform(0, TAU)
    top = h * .55
    trunk = []
    for k in range(6):
        t = k / 5
        sway = Vector((math.sin(t * 2.3 + seed) * .12, math.cos(t * 1.7 + seed) * .1, 0))
        trunk.append(Vector((lean * t * t * top * math.cos(lean_dir), lean * t * t * top * math.sin(lean_dir), t * top)) + sway * t)
    radii = [girth * f for f in (1, .84, .72, .62, .52, .42)]
    ridged_trunk(mesh, trunk, radii, sides, rng, ridges=.04 if peel else .07)
    lines = [trunk]
    if twin:
        split = trunk[2]
        d = lean_dir + math.pi * .7
        second = [split] + [split + Vector((math.cos(d) * .5 * k, math.sin(d) * .5 * k, k * (top - split.z) / 3)) for k in range(1, 4)]
        ridged_trunk(mesh, second, [radii[2] * .8, radii[3] * .75, radii[4] * .7, radii[5] * .6], max(6, sides - 2), rng, ridges=.04)
        lines.append(second)
    buttress(mesh, girth * .85, 5 if girth < .5 else 6, rng)
    if peel and lod < 2:
        # Yellow birch: curls of bronze bark peeling from the trunk.
        for i in range(24):
            z = .7 + i * .34
            if z > trunk[-1].z * .9:
                break
            c = trunk[0].lerp(trunk[-1], z / trunk[-1].z)
            r = girth * (1 - .5 * z / trunk[-1].z)
            a = i * 2.39996
            p = c + radial(a, r + .01, 0)
            s = radial(a + math.pi / 2, .15, 0)
            mesh.face([p - s, p + s, p + s + radial(a, .06, .09), p - s + radial(a, .06, .06)], 2)
    # The crown: overlapping clumps filling a lopsided dome, one canopy mass.
    centre = trunk[-1] + Vector((0, 0, crown_h * .45))
    golden = math.pi * (3 - math.sqrt(5))
    points = []
    for i in range(clumps):
        y = 1 - (i + .5) / clumps * 1.35
        r = math.sqrt(max(0, 1 - y * y))
        th = i * golden + rng.uniform(-.3, .3)
        shell = rng.uniform(.62, .95)
        points.append(centre + Vector((math.cos(th) * r * spread * shell, math.sin(th) * r * spread * shell * rng.uniform(.8, 1.05),
                                       y * crown_h * .5 * shell)))
    def on_trunk(z, line):
        z = max(line[1].z, min(line[-1].z, z))
        for a, b in zip(line, line[1:]):
            if a.z <= z <= b.z:
                return a.lerp(b, (z - a.z) / max(1e-6, b.z - a.z))
        return line[-1]
    leader_top = max(points, key=lambda p: p.z)
    mesh.tube([trunk[-1], trunk[-1].lerp(leader_top, .5), leader_top], [radii[-1], radii[-1] * .5, .03], 0, sides=6)
    count = max(6, round(cards * (1, .6, .3)[lod]))
    size_scale = (1, 1.25, 1.7)[lod]
    for p in points:
        line = min(lines, key=lambda l: (l[-1] - p).length)
        start = on_trunk(p.z - crown_h * rng.uniform(.45, .8), line)
        limb(mesh, start, p * .88 + start * .12, girth * .34, .04, rng, bend=.45, sides=5)
        size = clump_r * rng.uniform(.8, 1.15)
        clump(mesh, p, size, size * .75, count, card_size * size_scale, rng, 1, squash_bottom=.6)
    for i in range(stubs):
        s = trunk[1 + i % 3]
        limb(mesh, s, s + radial(rng.uniform(0, TAU), rng.uniform(1.2, 2.2), rng.uniform(.2, .9)), girth * .18, .02, rng, bend=.3, sides=4)
    return mesh.object(), leader_top * .82


def frond(mesh, c, direction, length, width, droop, slot):
    """A flat spray with a blunt, rounded tip rather than a spike."""
    along = radial(direction, 1, 0)
    side = radial(direction + math.pi / 2, 1, 0)
    down = Vector((0, 0, -droop))
    mesh.face([c, c + along * length * .35 - side * width * .5 + down * .35, c + along * length * .92 - side * width * .22 + down,
               c + along * length * .92 + side * width * .22 + down, c + along * length * .35 + side * width * .5 + down * .35], slot)


def hemlock(name, seed, lod=0, *, h=14.0, reach=4.2, tiers=13, bare=0.0, lean=0.0, lopsided=0.0, density=1.0):
    rng = random.Random(seed)
    mesh = Mesh(name, [material(name + '-bark', (.16, .105, .075)), material(name + '-needle', (.065, .16, .075), True)], lod)
    wind = rng.uniform(0, TAU)
    trunk = [vec(0, 0, 0), vec(.05, 0, h * .3), vec(-.03, .03, h * .6), vec(.02, 0, h * .83), vec(.2, 0, h)]
    for p in trunk:
        t = p.z / h
        p.x += lean * t * t * h * math.cos(wind)
        p.y += lean * t * t * h * math.sin(wind)
    ridged_trunk(mesh, trunk, [.55 * h / 14, .45 * h / 14, .32 * h / 14, .17 * h / 14, .02], (8, 7, 6)[lod], rng, ridges=.05)
    buttress(mesh, .45 * h / 14, 5, rng)
    def at(z):
        for a, b in zip(trunk, trunk[1:]):
            if a.z <= z <= b.z:
                return a.lerp(b, (z - a.z) / max(1e-6, b.z - a.z))
        return trunk[-1]
    start = max(1.2, h * bare)
    sprays = (3, 3, 2)[lod]
    for t in range(tiers):
        z = start + t * (h - .6 - start) / tiers
        frac = (z - start) / (h - start)
        tier_reach = reach * (1 - frac) ** .85 + .45
        count = max(3, round((6 if t < tiers - 3 else 4) * density))
        for j in range(count):
            a = j * TAU / count + t * .61 + rng.uniform(-.2, .2)
            L = tier_reach * rng.uniform(.85, 1.1) * (1 + lopsided * math.cos(a - wind))
            o = at(z)
            mid = o + radial(a, L * .5, -.05)
            tip = o + radial(a + .05, L, -.5 - L * .08)
            mesh.tube([o, mid, tip], [.08 * (1 - frac) + .02, .04, .01], 0, sides=4)
            grow = (1, 1.1, 1.45)[lod]
            for k in range(sprays):
                s = (k + 1) / (sprays + .2)
                c = mid.lerp(tip, s) if s > .5 else o.lerp(mid, s * 2)
                frond(mesh, c, a + rng.uniform(-.15, .15), L * (.55 - .1 * k) * grow, L * (.42 - .08 * k) * grow, .18 + .1 * k, 1)
                if lod == 0:
                    frond(mesh, c + vec(0, 0, .05), a + .5 + rng.uniform(-.2, .2), L * .3, L * .22, .1, 1)
    if bare > .2:
        for i in range(6):
            z = 1.4 + i * (start - 1.6) / 6
            mesh.tube([at(z), at(z) + radial(rng.uniform(0, TAU), rng.uniform(.5, 1.1), -.2)], [.05, .01], 0, sides=3)
    mesh.tube([trunk[-2], trunk[-1], trunk[-1] + vec(.5, 0, -.35)], [.06, .02, .005], 0, sides=4)
    frond(mesh, trunk[-1] + vec(.1, 0, -.05), 0, .7, .3, .3, 1)
    return mesh.object(), vec(.1, 0, h * .72)


TREES = {
    'oak-broad': (broadleaf, dict(seed=101, h=11.5, girth=.7, spread=3.7, crown_h=5.2, clumps=13, clump_r=2.0, cards=66, card_size=1.02)),
    'oak-tall': (broadleaf, dict(seed=102, h=14.0, girth=.62, spread=2.5, crown_h=6.8, clumps=13, clump_r=1.7, cards=60, card_size=.98)),
    'oak-old': (broadleaf, dict(seed=103, h=10.5, girth=.95, spread=4.2, crown_h=4.6, lean=.28, clumps=14, clump_r=2.0, cards=62, card_size=1.05, stubs=3)),
    'birch-single': (broadleaf, dict(seed=201, h=12.5, girth=.32, spread=2.1, crown_h=6.0, clumps=16, clump_r=1.05, cards=40, card_size=.72,
                                     bark=(.55, .43, .26), leaf=(.25, .37, .10), peel=True)),
    'birch-twin': (broadleaf, dict(seed=202, h=12.0, girth=.3, spread=2.6, crown_h=5.4, twin=True, clumps=18, clump_r=1.0, cards=38, card_size=.72,
                                   bark=(.55, .43, .26), leaf=(.25, .37, .10), peel=True)),
    'birch-leaning': (broadleaf, dict(seed=203, h=11.0, girth=.28, spread=2.0, crown_h=5.0, lean=.4, clumps=15, clump_r=1.0, cards=40, card_size=.72,
                                      bark=(.55, .43, .26), leaf=(.25, .37, .10), peel=True)),
    'hemlock-full': (hemlock, dict(seed=301, h=14.0, reach=4.2, tiers=13)),
    'hemlock-young': (hemlock, dict(seed=302, h=7.5, reach=2.8, tiers=10, density=1.1)),
    'hemlock-windswept': (hemlock, dict(seed=303, h=15.5, reach=3.6, tiers=10, bare=.4, lean=.06, lopsided=.45, density=.85)),
}


# ---------------------------------------------------------------------------
# Forest floor
# ---------------------------------------------------------------------------

def shelf(mesh, c, out, side, radius, slot):
    """A bracket fungus: a half-disc shelf standing off the wood."""
    pts = [c + out * math.sin(q) * radius + side * math.cos(q) * radius for q in [k * math.pi / 6 for k in range(7)]]
    for k in range(6):
        mesh.face([c + vec(0, 0, .03), pts[k] + vec(0, 0, .02), pts[k + 1] + vec(0, 0, .02)], slot)
        mesh.face([pts[k + 1] + vec(0, 0, -.03), pts[k] + vec(0, 0, -.03), c], slot)


def nurse_log():
    rng = random.Random(5)
    mesh = Mesh('nurse-log', [material('log-bark', (.16, .11, .075)), material('log-moss', MOSS),
                              material('log-heartwood', (.45, .32, .17)), material('shelf-fungus', (.55, .40, .22)),
                              material('seedling-leaf', (.20, .34, .09), True)])
    axis = [vec(-2.8, 0, .5), vec(-1, .1, .52), vec(.8, -.05, .48), vec(2.7, .05, .42)]
    radii = [.46, .5, .47, .38]
    sides = 12
    rings = []
    for i, (p, r) in enumerate(zip(axis, radii)):
        rings.append([p + Vector((0, math.cos(j * TAU / sides) * r * (1 + .08 * math.sin(j * 4.3 + i) + rng.uniform(-.03, .03)),
                                  math.sin(j * TAU / sides) * r)) for j in range(sides)])
    for lo, hi in zip(rings, rings[1:]):
        for j in range(sides):
            k = (j + 1) % sides
            mesh.face([lo[j], lo[k], hi[k], hi[j]], 1 if math.sin(j * TAU / sides) > .25 else 0)
    for ring in (rings[0], rings[-1]):
        mesh.face(ring, 2)
    for s in range(26):
        p = vec(rng.uniform(-2.5, 2.4), rng.uniform(-.2, .2), .95)
        mesh.face([p + vec(-.22, -.18, 0), p + vec(.2, -.2, .03), p + vec(.24, .19, .02), p + vec(-.18, .22, .04)], 1)
    for i in range(5):
        c = vec(-1.8 + i * .45 + rng.uniform(-.1, .1), -.5, .35 + (i % 2) * .18)
        shelf(mesh, c, vec(0, -1, 0), vec(1, 0, 0), .22, 3)
    for x in (-1.4, .3, 1.7):
        base = vec(x, .05, .95)
        mesh.tube([base, base + vec(.02, 0, .42)], [.02, .006], 4, sides=3)
        for k in range(5):
            a = k * TAU / 5
            card(mesh, base + vec(0, 0, .3 + k * .03) + radial(a, .12, 0), radial(a, 1, .9), .22, 4, rng)
    return mesh.object()


def broken_log():
    rng = random.Random(51)
    mesh = Mesh('broken-log', [material('bare-bark', (.19, .13, .085)), material('bare-heartwood', (.47, .34, .18)),
                               material('small-fungus', (.62, .5, .3))])
    sides = 11
    axis = [vec(-2.2, 0, .4), vec(-.6, .05, .42), vec(1.2, -.05, .38), vec(2.3, 0, .36)]
    rings = []
    for i, p in enumerate(axis):
        r = [.38, .41, .38, .34][i]
        rings.append([p + Vector((0, math.cos(j * TAU / sides) * r * (1 + .1 * math.sin(j * 3.3 + i)), math.sin(j * TAU / sides) * r))
                      for j in range(sides)])
    for lo, hi in zip(rings, rings[1:]):
        for j in range(sides):
            k = (j + 1) % sides
            mesh.face([lo[j], lo[k], hi[k], hi[j]], 0)
    mesh.face(rings[0], 1)
    end, tip = rings[-1], axis[-1] + vec(.35, 0, 0)
    for j in range(sides):
        k = (j + 1) % sides
        mesh.face([end[j], end[k], tip + vec(rng.uniform(0, .45), 0, 0) + (end[j] - axis[-1]) * .4], 1)
    for i in range(8):
        c = axis[0].lerp(axis[-1], rng.random()) + vec(0, -.38, rng.uniform(-.1, .1))
        mesh.face([c, c + vec(.07, -.08, .02), c + vec(-.07, -.08, .02)], 2)
    return mesh.object()


def mossy_stump():
    rng = random.Random(8)
    mesh = Mesh('mossy-stump', [material('stump-bark', (.17, .12, .08)), material('stump-moss', MOSS),
                                material('stump-heart', (.44, .31, .16)), material('shelf-fungus', (.58, .43, .24))])
    sides, h = 11, 1.25
    rings = []
    for z, r in [(0, .95), (.2, .78), (.7, .7), (h, .66)]:
        wob = [1 + .08 * math.sin(j * 3.1) for j in range(sides)]
        rings.append([vec(math.cos(j * TAU / sides) * r * wob[j], math.sin(j * TAU / sides) * r * wob[j],
                          z + (rng.uniform(-.12, .12) if z == h else 0)) for j in range(sides)])
    for i, (lo, hi) in enumerate(zip(rings, rings[1:])):
        for j in range(sides):
            k = (j + 1) % sides
            mesh.face([lo[j], lo[k], hi[k], hi[j]], 1 if i == 0 or (j in (2, 3, 4) and i == 1) else 0)
    top, centre = rings[-1], vec(0, 0, h - .05)
    for j in range(sides):
        k = (j + 1) % sides
        mid_j, mid_k = top[j].lerp(centre, .25), top[k].lerp(centre, .25)
        mesh.face([top[j], top[k], mid_k, mid_j], 1)
        mesh.face([mid_j, mid_k, centre], 2)
    buttress(mesh, .75, 5, rng, slot=1)
    for i in range(3):
        a = 1.9 + i * .35
        shelf(mesh, radial(a, .72, .5 + i * .22), radial(a, 1, 0), radial(a + math.pi / 2, 1, 0), .26, 3)
    return mesh.object()


def broken_snag():
    rng = random.Random(53)
    mesh = Mesh('broken-snag', [material('snag-bark', (.18, .125, .085)), material('snag-heart', (.46, .33, .17)),
                                material('snag-moss', MOSS), material('shelf-fungus', (.6, .45, .25))])
    sides, h = 10, 2.4
    rings = []
    for z, r in [(0, .8), (.3, .62), (1.2, .55), (h, .5)]:
        rings.append([vec(math.cos(j * TAU / sides) * r, math.sin(j * TAU / sides) * r, z + (rng.uniform(-.1, .5) if z == h else 0))
                      for j in range(sides)])
    for i, (lo, hi) in enumerate(zip(rings, rings[1:])):
        for j in range(sides):
            k = (j + 1) % sides
            mesh.face([lo[j], lo[k], hi[k], hi[j]], 2 if i == 0 and j % 2 else 0)
    top = rings[-1]
    for j in range(sides):
        k = (j + 1) % sides
        mesh.face([top[j], top[k], top[j].lerp(top[k], .5) + vec(0, 0, rng.uniform(.1, .6))], 1)
    mesh.face([p + vec(0, 0, -.3) for p in top], 1)
    buttress(mesh, .6, 5, rng)
    for i in range(4):
        a = 2.4 + i * .4
        shelf(mesh, radial(a, .56, .7 + i * .35), radial(a, 1, 0), radial(a + math.pi / 2, 1, 0), .3, 3)
    return mesh.object()


def bracken():
    rng = random.Random(13)
    mesh = Mesh('bracken', [material('bracken-stem', (.22, .24, .09)), material('bracken-foliage', (.21, .36, .09), True)])
    for f in range(5):
        a = f * TAU / 5 + rng.uniform(-.3, .3)
        hgt = rng.uniform(.9, 1.3)
        base = radial(a, .12, 0)
        top = base + vec(0, 0, hgt)
        arm = top + radial(a, .75, -.05)
        mesh.tube([base, top, arm], [.018, .012, .004], 0, sides=3)
        for k in range(8):
            t = (k + .5) / 8
            c = top.lerp(arm, t) + vec(0, 0, -.08 * t)
            L = .42 * (1 - t) + .06
            for sgn in (-1, 1):
                d = radial(a + sgn * 1.25, L, -.05 * L)
                s = radial(a, L * .18, 0)
                mesh.face([c, c + d * .5 + s, c + d, c + d * .5 - s], 1)
    return mesh.object()


def lady_fern():
    rng = random.Random(57)
    mesh = Mesh('lady-fern', [material('fern-stem', (.2, .23, .08)), material('lady-fern-foliage', (.18, .34, .09), True)])
    for f in range(9):
        a = f * TAU / 9 + rng.uniform(-.2, .2)
        L = rng.uniform(.9, 1.2)
        base = radial(a, .06, 0)
        rise = base + radial(a, L * .3, L * .75)
        tip = base + radial(a, L * .85, L * .55)
        mesh.tube([base, rise, tip], [.012, .008, .002], 0, sides=3)
        for k in range(9):
            t = (k + 1) / 10
            c = base.lerp(rise, t * 2) if t < .5 else rise.lerp(tip, (t - .5) * 2)
            pl = .22 * math.sin(t * math.pi) + .04
            for sgn in (-1, 1):
                d = radial(a + sgn * 1.35, pl, -.02)
                mesh.face([c, c + d * .5 + vec(0, 0, .03), c + d, c + d * .5 - vec(0, 0, .02)], 1)
    return mesh.object()


def berry_shrub():
    rng = random.Random(29)
    mesh = Mesh('berry-shrub', [material('shrub-twig', (.25, .15, .09)), material('shrub-leaf', (.17, .30, .08), True),
                                material('berry', (.10, .12, .32))])
    for t in range(9):
        a = t * TAU / 9 + rng.uniform(-.3, .3)
        base = radial(a, .1, 0)
        mesh.tube([base, base + radial(a, rng.uniform(.3, .6), rng.uniform(.45, .75))], [.02, .006], 0, sides=3)
    for c in [vec(0, 0, .45), vec(.35, .15, .35), vec(-.3, .2, .38), vec(.05, -.35, .33), vec(-.15, -.1, .6)]:
        clump(mesh, c, .38, .28, 34, .16, rng, 1, squash_bottom=.9)
    for i in range(14):
        c = vec(rng.uniform(-.45, .45), rng.uniform(-.45, .45), rng.uniform(.25, .6))
        pts = [c + vec(math.cos(k * TAU / 5) * .035, math.sin(k * TAU / 5) * .035, 0) for k in range(5)]
        for k in range(5):
            mesh.face([pts[k], pts[(k + 1) % 5], c + vec(0, 0, .035)], 2)
            mesh.face([pts[(k + 1) % 5], pts[k], c - vec(0, 0, .035)], 2)
    return mesh.object()


def hobblebush():
    rng = random.Random(59)
    mesh = Mesh('hobblebush', [material('hobble-twig', (.24, .16, .1)), material('hobble-leaf', (.19, .32, .08), True),
                               material('hobble-flower', (.9, .9, .85), True)])
    for t in range(7):
        a = t * TAU / 7 + rng.uniform(-.3, .3)
        base = radial(a, .1, 0)
        mid = base + radial(a, .5, .55)
        tip = mid + radial(a + .3, .45, .15)
        mesh.tube([base, mid, tip], [.03, .02, .008], 0, sides=3)
        for k in range(4):
            c = mid.lerp(tip, k / 3) + vec(0, 0, .05)
            for sgn in (-1, 1):
                card(mesh, c + radial(a + sgn * 1.4, .16, 0), Vector((rng.uniform(-.2, .2), rng.uniform(-.2, .2), 1)), .34, 1, rng, aspect=.9, fold=.05)
        c = tip + vec(0, 0, .08)
        for k in range(6):
            q = k * TAU / 6
            mesh.face([c, c + radial(q, .09, .01), c + radial(q + .5, .09, .01)], 2)
    return mesh.object()


def boulder(seed, stretch=(1, .82, 1)):
    rng = random.Random(seed)
    mesh = Mesh(f'boulder-{seed}', [material('granite', (.30, .30, .27)), material('boulder-moss', MOSS),
                                    material('lichen', (.55, .55, .36))])
    sides = 9
    rings = []
    for z, r in [(0, .95), (.25, 1.15), (.65, 1.05), (1.0, .72), (1.18, .25)]:
        rings.append([vec(math.cos(j * TAU / sides) * r * rng.uniform(.85, 1.12) * stretch[0],
                          math.sin(j * TAU / sides) * r * stretch[1] * rng.uniform(.85, 1.12), z * stretch[2] * rng.uniform(.92, 1.08))
                      for j in range(sides)])
    for i, (lo, hi) in enumerate(zip(rings, rings[1:])):
        for j in range(sides):
            k = (j + 1) % sides
            mesh.face([lo[j], lo[k], hi[k], hi[j]], 1 if i >= 2 and j not in (6, 7) else (2 if (i == 1 and j in (2, 5)) else 0))
    mesh.face(rings[-1], 1)
    return mesh.object()


def litter(name, seed, colours):
    rng = random.Random(seed)
    mesh = Mesh(name, [material(f'{name}-{i}', c) for i, c in enumerate(colours)])
    for i in range(160):
        r = 1.7 * math.sqrt(rng.random())
        a = rng.uniform(0, TAU)
        c = vec(math.cos(a) * r, math.sin(a) * r, .01 + rng.uniform(0, .05))
        card(mesh, c, Vector((rng.uniform(-.35, .35), rng.uniform(-.35, .35), 1)), rng.uniform(.13, .22), rng.randrange(len(colours)), rng, aspect=.6, fold=.18)
    for i in range(6):
        a = rng.uniform(0, TAU)
        c = radial(a, rng.uniform(0, 1.2), .03)
        mesh.tube([c, c + radial(a + 1.3, rng.uniform(.4, .8), .02)], [.018, .008], 0, sides=3)
    return mesh.object()


def trillium():
    rng = random.Random(17)
    mesh = Mesh('trillium', [material('trillium-stem', (.2, .3, .1)), material('trillium-leaf', (.18, .33, .09), True),
                             material('trillium-petal', (.9, .88, .82), True)])
    for p in [vec(0, 0, 0), vec(.35, .2, 0), vec(-.3, .25, 0), vec(.1, -.35, 0)]:
        top = p + vec(0, 0, .32)
        mesh.tube([p, top], [.012, .008], 0, sides=3)
        for k in range(3):
            a = k * TAU / 3 + rng.uniform(-.2, .2)
            mesh.face([top, top + radial(a - .45, .14, -.02), top + radial(a, .24, -.04), top + radial(a + .45, .14, -.02)], 1)
            b = a + math.pi / 3
            f = top + vec(0, 0, .06)
            mesh.face([f, f + radial(b - .4, .07, .02), f + radial(b, .13, .05), f + radial(b + .4, .07, .02)], 2)
    return mesh.object()


def fallen_branch():
    rng = random.Random(19)
    mesh = Mesh('fallen-branch', [material('branch-bark', (.19, .13, .085)), material('branch-lichen', (.5, .52, .35))])
    main = [vec(-1.6, 0, .08), vec(-.4, .15, .1), vec(.9, -.1, .08), vec(1.7, .1, .06)]
    mesh.tube(main, [.09, .08, .06, .02], 0, sides=5)
    for i in range(4):
        s = main[1 + i % 2].lerp(main[2], rng.random())
        mesh.tube([s, s + radial(rng.uniform(0, TAU), rng.uniform(.4, .7), rng.uniform(.05, .3))], [.035, .006], 0, sides=3)
    for i in range(5):
        c = main[0].lerp(main[-1], rng.random()) + vec(0, 0, .085)
        mesh.face([c + vec(-.05, -.04, 0), c + vec(.06, -.03, .005), c + vec(.05, .05, .005), c + vec(-.04, .04, 0)], 1)
    return mesh.object()


FLOOR = {
    'prop.nurse-log': ('props/nurse-log', nurse_log),
    'prop.broken-log': ('props/broken-log', broken_log),
    'prop.mossy-stump': ('props/mossy-stump', mossy_stump),
    'prop.broken-snag': ('props/broken-snag', broken_snag),
    'prop.fallen-branch': ('props/fallen-branch', fallen_branch),
    'prop.boulder-round': ('props/boulder-round', lambda: boulder(61)),
    'prop.boulder-slab': ('props/boulder-slab', lambda: boulder(62, (1.4, 1.0, .55))),
    'prop.boulder-tall': ('props/boulder-tall', lambda: boulder(63, (.8, .75, 1.5))),
    'understory.bracken': ('understory/bracken', bracken),
    'understory.lady-fern': ('understory/lady-fern', lady_fern),
    'understory.berry-shrub': ('understory/berry-shrub', berry_shrub),
    'understory.hobblebush': ('understory/hobblebush', hobblebush),
    'understory.trillium': ('understory/trillium', trillium),
    'understory.litter-autumn': ('understory/litter-autumn', lambda: litter('litter-autumn', 71, [(.25, .14, .06), (.45, .30, .09), (.38, .12, .05)])),
    'understory.litter-summer': ('understory/litter-summer', lambda: litter('litter-summer', 72, [(.22, .17, .09), (.30, .24, .12), (.18, .2, .08)])),
}


def smooth(obj):
    """Smooth the round things (bark, stems, stone); keep leaves and cards faceted."""
    for f in obj.data.polygons:
        name = obj.data.materials[f.material_index].name
        f.use_smooth = any(k in name for k in ('bark', 'stem', 'twig', 'granite'))


def generate(out):
    entries = []
    for name, (fn, params) in TREES.items():
        asset_id = f'tree.{name}'
        bpy.ops.wm.read_factory_settings(use_empty=True)
        source, anchor = fn(name, lod=0, **params)
        pack.ground(source)
        smooth(source)
        entry = {'id': asset_id, 'variant': 'living', 'species': name.split('-')[0], 'form': name.split('-', 1)[1],
                 'generator': 'tools/make-forest-v3-assets.py', 'lods': []}
        # The anchor sits at the crown, expressed in exported (Y-up) axes.
        entry['anchorCrown'] = [round(anchor.x, 5), round(anchor.z, 5), round(-anchor.y, 5)]
        for level in range(3):
            obj = pack.make_lod(source, level, lambda lod, f=fn, p=params, n=name: f(n, lod=lod, **p))
            if level:
                pack.ground(obj)
                smooth(obj)
            path = out / 'trees' / (name + (f'-lod{level}' if level else '') + '.glb')
            record = pack.export_asset(obj, anchor, path, asset_id, level, TREE_BUDGET[level])
            record['file'] = path.relative_to(out).as_posix()
            entry['lods'].append(record)
            bpy.data.objects.remove(obj, do_unlink=True)
        entries.append(entry)
    for asset_id, (stem, fn) in FLOOR.items():
        bpy.ops.wm.read_factory_settings(use_empty=True)
        obj = fn()
        pack.ground(obj)
        smooth(obj)
        height = max(v.co.z for v in obj.data.vertices)
        path = out / (stem + '.glb')
        record = pack.export_asset(obj, None, path, asset_id, 0, FLOOR_BUDGET)
        record['file'] = path.relative_to(out).as_posix()
        entries.append({'id': asset_id, 'generator': 'tools/make-forest-v3-assets.py', 'height': round(height, 4), 'lods': [record]})
        print(f'HEIGHT {asset_id} {height:.3f}')
    return entries


if __name__ == '__main__':
    out = ROOT / 'public/assets'
    entries = generate(out)
    path = out / 'forest-manifest.json'
    manifest = json.loads(path.read_text(encoding='utf-8'))
    ids = {e['id'] for e in entries}
    manifest['assets'] = [e for e in manifest['assets'] if e['id'] not in ids] + entries
    path.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(f'MANIFEST {len(manifest["assets"])} assets')
