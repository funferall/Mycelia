"""Wildfire v2 assets: what a fire leaves behind, and what grows back.

Blender 4.2: blender --background --factory-startup --python tools/make-fire-assets.py

Builds, with the same Mesh/material helpers and trunk, limb and root-flare
blocks as tools/make-forest-v3-assets.py:

- charred trees, one per species, three tiers each, variant `charred` (no
  foliage): oak with broken crown stubs and a split ember seam, birch with
  its peeled bark burned to black and pale scorch streaks, hemlock as a spike
  with scorched whorls of branch stubs;
- charred remains: two fallen logs (straight, and snapped with a stub), a
  charred stump and an ember bed of coals on ash;
- the aftermath: a fireweed clump and a pale ash bed.

Exports under public/assets/ and merges its entries into forest-manifest.json,
replacing only its own ids. Materials stay opaque and non-emissive, as the
pack contract requires: the ember orange is a colour here, and any glow is the
renderer's job during the fire. Budgets are set for the art, generously.
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
_spec = importlib.util.spec_from_file_location('forest_v3', Path(__file__).with_name('make-forest-v3-assets.py'))
v3 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(v3)
pack, vec, radial, material, Mesh = v3.pack, v3.vec, v3.radial, v3.material, v3.Mesh
card, limb, ridged_trunk, buttress = v3.card, v3.limb, v3.ridged_trunk, v3.buttress
TAU = math.tau
TREE_BUDGET = (4000, 2400, 1200)
FLOOR_BUDGET = 2000

# The fire's palette: never pure black, so form still reads under the forest light.
CHAR = (.028, .024, .021)
CHARCOAL = (.062, .056, .05)
EMBER = (.46, .11, .02)
SCORCH = (.26, .23, .2)
ASH = (.26, .25, .235)
ASH_DARK = (.12, .115, .105)


# ---------------------------------------------------------------------------
# Charred trees
# ---------------------------------------------------------------------------

def check(i, j, seed, share):
    """A stable pick for alligator checks: true on about `share` of the faces."""
    h = (i * 73856093) ^ (j * 19349663) ^ (seed * 83492791)
    h = (h ^ (h >> 13)) * 1274126177 & 0xffffffff
    return ((h ^ (h >> 16)) & 0xffff) / 65536 < share


def char_trunk(mesh, points, radii, sides, rng, seed, highlight=1, share=.28, crack=.16):
    """A trunk burned into alligator checks: every vertex jittered outward or in,
    so the bark reads as cracked blocks, and a share of the blocks catching
    the light in a paler charcoal (or, for birch, the pale scorched paper)."""
    rings = []
    for i, (p, r) in enumerate(zip(points, radii)):
        ring = []
        for j in range(sides):
            a = j * TAU / sides
            bump = 1 + crack * (rng.random() - .35) + .05 * math.sin(j * 3.7 + i * 1.9)
            ring.append(p + radial(a, r * bump, 0))
        rings.append(ring)
    for i, (lo, hi) in enumerate(zip(rings, rings[1:])):
        for j in range(sides):
            k = (j + 1) % sides
            mesh.face([lo[j], lo[k], hi[k], hi[j]], highlight if check(i, j, seed, share) else 0)
    return rings


def broken_limb(mesh, start, end, r0, rng, sides, slot=0, tip_slot=1):
    """A limb burned and snapped: it tapers, kinks, and ends in splinters
    rather than a cap."""
    mid = start.lerp(end, .55) + Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(0, .6))) * (start - end).length * .12
    mesh.tube([start, mid, end], [r0, r0 * .7, r0 * .45], slot, sides=sides, cap=False)
    # Splinters at the break.
    ring = [end + radial(j * TAU / sides, r0 * .45, 0) for j in range(sides)]
    axis = (end - mid).normalized()
    for j in range(sides):
        k = (j + 1) % sides
        tip = ring[j].lerp(ring[k], .5) + axis * r0 * rng.uniform(.6, 2.2)
        mesh.face([ring[j], ring[k], tip], tip_slot if j % 2 else slot)


def ragged_top(mesh, centre, radius, sides, rng, slot, height=.9):
    """A snapped crown: jagged spikes of charred wood around the break."""
    ring = [centre + radial(j * TAU / sides, radius, 0) for j in range(sides)]
    for j in range(sides):
        k = (j + 1) % sides
        tip = ring[j].lerp(ring[k], .5) * .7 + centre * .3 + vec(0, 0, rng.uniform(.15, height))
        mesh.face([ring[j], ring[k], tip], slot)
    mesh.face(list(reversed(ring)), slot)


def ember_seam(mesh, base, top, girth, angle, width, slot):
    """A split in the trunk still glowing: a narrow strip set just proud of the bark."""
    steps = 6
    for i in range(steps):
        z0 = base + (top - base) * i / steps
        z1 = base + (top - base) * (i + 1) / steps
        wiggle0 = math.sin(i * 1.7) * .05
        wiggle1 = math.sin((i + 1) * 1.7) * .05
        r0 = girth * (1 - .35 * z0 / max(top, 1e-3)) * 1.02
        r1 = girth * (1 - .35 * z1 / max(top, 1e-3)) * 1.02
        a0, a1 = angle + wiggle0, angle + wiggle1
        w0, w1 = width * (1 - i / steps * .6), width * (1 - (i + 1) / steps * .6)
        mesh.face([radial(a0 - w0, r0, z0), radial(a0 + w0, r0, z0), radial(a1 + w1, r1, z1), radial(a1 - w1, r1, z1)], slot)


def charred_broadleaf(name, seed, lod=0, *, h, girth, lean=0.0, stubs=6, stub_reach=(1.2, 3.2), scorch=False,
                      twin=False, crown=.55):
    """A broadleaf the fire killed standing: the trunk and main limbs keep the
    living tree's shape, burned to cracked black and snapped short; nothing
    fine is left. `crown` is where the main limbs leave the trunk, as a share
    of its height (an oak branches low and wide, a birch high and narrow)."""
    rng = random.Random(seed)
    highlight = SCORCH if scorch else CHARCOAL
    mats = [material(name + '-char-bark', CHAR), material(name + ('-scorch' if scorch else '-charcoal'), highlight),
            material(name + '-ember', EMBER)]
    mesh = Mesh(name, mats, lod)
    sides = (14, 14, 10)[lod]
    rings_n = (10, 10, 7)[lod]
    lean_dir = rng.uniform(0, TAU)
    trunk = []
    for k in range(rings_n):
        t = k / (rings_n - 1)
        sway = Vector((math.sin(t * 2.1 + seed) * .12, math.cos(t * 1.6 + seed) * .1, 0))
        trunk.append(Vector((lean * t * t * h * math.cos(lean_dir), lean * t * t * h * math.sin(lean_dir), t * h)) + sway * t)
    radii = [girth * (1.12 - .72 * (k / (rings_n - 1)) ** .8) for k in range(rings_n)]
    char_trunk(mesh, trunk, radii, sides, rng, seed, share=.4 if scorch else .26, crack=.1 if scorch else .18)
    ragged_top(mesh, trunk[-1], radii[-1], sides, rng, 1, height=girth * 1.6)
    if twin:
        split = trunk[rings_n // 2]
        d = lean_dir + math.pi * .7
        second = [split + Vector((math.cos(d) * .45 * k, math.sin(d) * .45 * k, k * (h * .82 - split.z) / 4)) for k in range(5)]
        char_trunk(mesh, second, [radii[rings_n // 2] * f for f in (.8, .72, .64, .56, .48)], max(6, sides - 4), rng, seed + 7,
                   share=.4, crack=.1)
        ragged_top(mesh, second[-1], radii[rings_n // 2] * .48, max(6, sides - 4), rng, 1, height=girth)
    buttress(mesh, girth * .9, (6, 5, 4)[lod], rng)

    def on_trunk(z):
        for a, b in zip(trunk, trunk[1:]):
            if a.z <= z <= b.z:
                return a.lerp(b, (z - a.z) / max(1e-6, b.z - a.z))
        return trunk[-1]

    # Main limbs, snapped; the larger ones keep one or two broken side limbs.
    count = max(3, stubs - (lod // 2))
    for i in range(count):
        z = h * (crown + (1 - crown) * .85 * (i + rng.random() * .6) / count)
        start = on_trunk(z)
        a = i * 2.39996 + rng.uniform(-.3, .3)
        reach = rng.uniform(*stub_reach) * (1.15 - .4 * (z / h))
        end = start + radial(a, reach, reach * rng.uniform(.35, .8))
        r0 = girth * rng.uniform(.26, .36) * (1.1 - .5 * z / h)
        broken_limb(mesh, start, end, r0, rng, (7, 6, 5)[lod])
        if reach > stub_reach[0] * 1.2:
            for b in range(2 if lod == 0 else 1):
                at = start.lerp(end, rng.uniform(.45, .8))
                side = end + radial(a + rng.choice((-1, 1)) * rng.uniform(.7, 1.2), reach * rng.uniform(.3, .5), reach * .35)
                broken_limb(mesh, at, side, r0 * .45, rng, 4)
    # The seam still glows where the heartwood split.
    if lod < 2:
        ember_seam(mesh, .25, h * .36, girth * 1.05, lean_dir + math.pi, .09, 2)
    return mesh.object(), trunk[-1] * .9


def charred_hemlock(name, seed, lod=0, *, h=13.0, tiers=11):
    """A burned conifer: a black spike with whorls of scorched branch stubs."""
    rng = random.Random(seed)
    mesh = Mesh(name, [material(name + '-char-bark', CHAR), material(name + '-charcoal', CHARCOAL), material(name + '-ember', EMBER)], lod)
    trunk = [vec(0, 0, 0), vec(.05, 0, h * .3), vec(-.03, .03, h * .6), vec(.02, 0, h * .85), vec(.08, 0, h)]
    radii = [.52 * h / 13, .42 * h / 13, .3 * h / 13, .15 * h / 13, .03]
    # More rings than the living tree: the spike's cracked bark is the model.
    spine = []
    spine_r = []
    for k in range(9):
        z = h * k / 8
        for a, b, ra, rb in zip(trunk, trunk[1:], radii, radii[1:]):
            if a.z <= z <= b.z:
                t = (z - a.z) / max(1e-6, b.z - a.z)
                spine.append(a.lerp(b, t))
                spine_r.append(ra + (rb - ra) * t)
                break
    char_trunk(mesh, spine, spine_r, (11, 11, 8)[lod], rng, seed, share=.24, crack=.16)
    buttress(mesh, .42 * h / 13, 5, rng)

    def at(z):
        for a, b in zip(trunk, trunk[1:]):
            if a.z <= z <= b.z:
                return a.lerp(b, (z - a.z) / max(1e-6, b.z - a.z))
        return trunk[-1]

    per_tier = (6, 6, 4)[lod]
    for t in range(tiers - lod):
        z = 1.6 + t * (h - 2.2) / tiers
        frac = z / h
        reach = (3.2 * (1 - frac) ** .9 + .35) * rng.uniform(.45, .8)  # burned back to stubs
        for j in range(per_tier):
            # Fire takes whole whorls unevenly: some stubs are gone to the trunk.
            if rng.random() < .22:
                continue
            a = j * TAU / per_tier + t * .7 + rng.uniform(-.25, .25)
            o = at(z)
            length = reach * rng.uniform(.5, 1.1)
            tip = o + radial(a, length, -.3 - length * .15)
            mesh.tube([o, o.lerp(tip, .5) + vec(0, 0, .05), tip], [.07 * (1 - frac) + .025, .035, .012], 1 if j % 3 else 0, sides=(4, 3, 3)[lod])
    if lod < 2:
        ember_seam(mesh, .2, h * .22, radii[0], rng.uniform(0, TAU), .07, 2)
    return mesh.object(), vec(0, 0, h * .7)


TREES = {
    'oak-charred': (charred_broadleaf, dict(seed=401, h=9.0, girth=.78, lean=.06, stubs=7, stub_reach=(2.0, 4.2), crown=.38)),
    'birch-charred': (charred_broadleaf, dict(seed=402, h=10.5, girth=.33, lean=.16, stubs=6, stub_reach=(.9, 2.1), scorch=True,
                                              twin=True, crown=.55)),
    'hemlock-charred': (charred_hemlock, dict(seed=403, h=13.0, tiers=11)),
}


# ---------------------------------------------------------------------------
# Remains and aftermath
# ---------------------------------------------------------------------------

def alligator_log(mesh, axis, radii, rng, sides=16, seed=1):
    """A log whose char has cracked into alligator-skin checks: every vertex
    jittered so the blocks stand proud or sink, and a scattered share of them
    catching the light in paler charcoal."""
    rings = []
    for i, (p, r) in enumerate(zip(axis, radii)):
        rings.append([p + Vector((0, math.cos(j * TAU / sides) * r * (1 + .14 * (rng.random() - .4)),
                                  math.sin(j * TAU / sides) * r * (1 + .1 * (rng.random() - .4)))) for j in range(sides)])
    for i, (lo, hi) in enumerate(zip(rings, rings[1:])):
        for j in range(sides):
            k = (j + 1) % sides
            mesh.face([lo[j], lo[k], hi[k], hi[j]], 1 if check(i, j, seed, .28) else 0)
    return rings


def glowing_end(mesh, ring, centre, rng, depth=.18):
    """A burned-through end: a charcoal rim around a recessed ember core."""
    inner = [p.lerp(centre, .45) for p in ring]
    n = len(ring)
    for j in range(n):
        k = (j + 1) % n
        mesh.face([ring[j], ring[k], inner[k], inner[j]], 1)
    core = centre + (centre - ring[0].lerp(ring[n // 2], .5)) * 0 + vec(0, 0, 0)
    for j in range(n):
        k = (j + 1) % n
        mesh.face([inner[j], inner[k], core + (inner[j] - core) * .05], 2)


def charred_log(seed, length=4.2, radius=.42, snapped=False):
    rng = random.Random(seed)
    mesh = Mesh(f'charred-log-{seed}', [material('log-char', CHAR), material('log-charcoal', CHARCOAL), material('log-ember', EMBER)])
    n = 11
    axis = [vec(-length / 2 + length * i / (n - 1), .06 * math.sin(i * .9 + seed), radius + .04 * math.sin(i * 1.3)) for i in range(n)]
    if snapped:
        axis[-1] = axis[-1] + vec(-.25, .3, -.04)
        axis[-2] = axis[-2] + vec(0, .12, 0)
    radii = [radius * (1.06 - .24 * i / (n - 1)) for i in range(n)]
    rings = alligator_log(mesh, axis, radii, rng, seed=seed)
    glowing_end(mesh, rings[0], axis[0], rng)
    if snapped:
        # A jagged break at the far end, and the stub of a limb.
        # A jagged break at the far end, and the stub of a limb.
        end = axis[-1]
        ring = rings[-1]
        for j in range(len(ring)):
            k = (j + 1) % len(ring)
            tip = ring[j].lerp(ring[k], .5) * .6 + end * .4 + vec(rng.uniform(.1, .55), 0, rng.uniform(-.05, .1))
            mesh.face([ring[j], ring[k], tip], 1 if j % 2 else 0)
        s = axis[3] + vec(0, .1, radii[3] * .75)
        broken_limb(mesh, s, s + radial(rng.uniform(.8, 2.2), .9, .5), radius * .32, rng, 6)
    else:
        glowing_end(mesh, list(reversed(rings[-1])), axis[-1], rng)
    return mesh.object()


def charred_stump():
    rng = random.Random(411)
    mesh = Mesh('charred-stump', [material('stump-char', CHAR), material('stump-charcoal', CHARCOAL), material('stump-ember', EMBER)])
    sides, h = 12, 1.0
    rings = []
    for z, r in [(0, .92), (.18, .76), (.55, .68), (h, .62)]:
        rings.append([vec(math.cos(j * TAU / sides) * r * (1 + .1 * math.sin(j * 3.3)), math.sin(j * TAU / sides) * r * (1 + .1 * math.sin(j * 3.3)),
                          z + (rng.uniform(-.1, .25) if z == h else 0)) for j in range(sides)])
    for i, (lo, hi) in enumerate(zip(rings, rings[1:])):
        for j in range(sides):
            k = (j + 1) % sides
            mesh.face([lo[j], lo[k], hi[k], hi[j]], 1 if check(i, j, 411, .3) else 0)
    # The top burned into a bowl: charcoal rim, ember heart.
    top = rings[-1]
    centre = vec(0, 0, h - .22)
    mid = [p.lerp(centre, .45) for p in top]
    for j in range(sides):
        k = (j + 1) % sides
        mesh.face([top[j], top[k], mid[k], mid[j]], 1)
        mesh.face([mid[j], mid[k], centre], 2)
    buttress(mesh, .72, 5, rng)
    ember_seam(mesh, .15, .75, .7, 1.1, .08, 2)
    return mesh.object()


def lump(mesh, c, size, rng, slot):
    """One coal: a squashed, faceted lump."""
    sides = 5
    top = c + vec(0, 0, size * rng.uniform(.5, .8))
    ring = [c + radial(j * TAU / sides + rng.uniform(-.2, .2), size * rng.uniform(.7, 1.1), size * .15) for j in range(sides)]
    for j in range(sides):
        k = (j + 1) % sides
        mesh.face([ring[j], ring[k], top], slot)


def ember_bed():
    rng = random.Random(421)
    mesh = Mesh('ember-bed', [material('bed-ash', ASH), material('bed-coal', CHAR), material('bed-ember', EMBER), material('bed-ash-dark', ASH_DARK)])
    # A low mound of ash, darker at the rim.
    sides, rings = 16, 4
    prev = None
    for r in range(rings + 1):
        rad = 1.5 * (1 - r / rings) + .001
        z = .12 * math.sin(math.pi / 2 * r / rings)
        ring = [vec(math.cos(j * TAU / sides) * rad * (1 + .12 * math.sin(j * 2.3 + r)), math.sin(j * TAU / sides) * rad, z) for j in range(sides)]
        if prev:
            for j in range(sides):
                k = (j + 1) % sides
                mesh.face([prev[j], prev[k], ring[k], ring[j]], 3 if r == 1 else 0)
        prev = ring
    # Coals heap toward the middle, glowing mostly where they are deepest.
    for i in range(70):
        a = rng.uniform(0, TAU)
        rad = 1.1 * rng.random() ** 1.4
        c = vec(math.cos(a) * rad, math.sin(a) * rad, .12 * (1 - rad / 1.5))
        glowing = rng.random() < .55 * (1 - rad / 1.1) + .08
        lump(mesh, c, rng.uniform(.07, .19), rng, 2 if glowing else 1)
    # Two burned-through sticks lying across the bed.
    for i in range(2):
        a = rng.uniform(0, TAU)
        c = radial(a, rng.uniform(.1, .4), .12)
        d = radial(a + 1.4 + i, rng.uniform(.9, 1.3), .02)
        mesh.tube([c - d * .5, c + d * .5], [.06, .045], 1, sides=6)
    return mesh.object()


def fireweed():
    """Chamerion angustifolium: the first colour back on burned ground."""
    rng = random.Random(431)
    mesh = Mesh('fireweed', [material('fireweed-stem', (.24, .12, .1)), material('fireweed-foliage', (.2, .33, .1), True),
                             material('fireweed-flower', (.78, .22, .5), True)])
    for s in range(12):
        a = s * TAU / 12 + rng.uniform(-.3, .3)
        base = radial(a, rng.uniform(.05, .45), 0)
        hgt = rng.uniform(.85, 1.4)
        top = base + radial(a, .08, hgt)
        mesh.tube([base, base.lerp(top, .5) + radial(a, .03, 0), top], [.012, .009, .005], 0, sides=3)
        # Narrow willow-like leaves up the stem.
        for k in range(6):
            t = .12 + k * .09
            c = base.lerp(top, t)
            d = radial(a + k * 2.4, .17, .06)
            side = radial(a + k * 2.4 + math.pi / 2, .025, 0)
            mesh.face([c, c + d * .5 + side, c + d, c + d * .5 - side], 1)
        # The flower spike: small pink cards spiralling up the last third.
        for k in range(12):
            t = .6 + k * .033
            c = base.lerp(top, t)
            card(mesh, c + radial(k * 2.1, .045 * (1 - k / 14), 0), radial(k * 2.1, 1, .5), .085 * (1 - k / 20), 2, rng, aspect=.9, fold=.05)
    return mesh.object()


def ash_bed():
    rng = random.Random(441)
    mesh = Mesh('ash-bed', [material('ashbed-ash', ASH), material('ashbed-char', CHAR), material('ashbed-ash-dark', ASH_DARK)])
    sides = 18
    centre = vec(0, 0, .035)
    ring = [vec(math.cos(j * TAU / sides) * 1.8 * (1 + .2 * math.sin(j * 1.9)), math.sin(j * TAU / sides) * 1.6 * (1 + .15 * math.cos(j * 2.7)), .005)
            for j in range(sides)]
    mid = [p.lerp(centre, .45) + vec(0, 0, .01) for p in ring]
    for j in range(sides):
        k = (j + 1) % sides
        mesh.face([ring[j], ring[k], mid[k], mid[j]], 2)
        mesh.face([mid[j], mid[k], centre], 0)
    # Flecks of charcoal and a few twig ghosts in the ash.
    for i in range(40):
        a = rng.uniform(0, TAU)
        r = 1.4 * math.sqrt(rng.random())
        c = vec(math.cos(a) * r, math.sin(a) * r, .04)
        d = radial(rng.uniform(0, TAU), rng.uniform(.04, .1), 0)
        e = radial(rng.uniform(0, TAU), rng.uniform(.03, .06), 0)
        mesh.face([c - d, c + e, c + d, c - e], 1)
    for i in range(5):
        a = rng.uniform(0, TAU)
        c = radial(a, rng.uniform(0, 1), .045)
        mesh.tube([c, c + radial(a + 1.1, rng.uniform(.4, .7), .01)], [.02, .008], 1, sides=3)
    return mesh.object()


FLOOR = {
    'prop.charred-log-a': ('props/charred-log-a', lambda: charred_log(451, 4.2, .42)),
    'prop.charred-log-b': ('props/charred-log-b', lambda: charred_log(452, 3.4, .36, snapped=True)),
    'prop.charred-stump': ('props/charred-stump', charred_stump),
    'prop.ember-bed': ('props/ember-bed', ember_bed),
    'understory.fireweed': ('understory/fireweed', fireweed),
    'understory.ash-bed': ('understory/ash-bed', ash_bed),
}


def smooth(obj):
    """Smooth the round wood and stems; keep char checks, coals and cards faceted."""
    for f in obj.data.polygons:
        name = obj.data.materials[f.material_index].name
        f.use_smooth = name.endswith('-stem')


def generate(out):
    entries = []
    for name, (fn, params) in TREES.items():
        asset_id = f'tree.{name}'
        bpy.ops.wm.read_factory_settings(use_empty=True)
        source, anchor = fn(name, lod=0, **params)
        pack.ground(source)
        smooth(source)
        entry = {'id': asset_id, 'variant': 'charred', 'species': name.split('-')[0], 'form': 'charred',
                 'generator': 'tools/make-fire-assets.py', 'lods': []}
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
        entries.append({'id': asset_id, 'generator': 'tools/make-fire-assets.py', 'height': round(height, 4), 'lods': [record]})
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
