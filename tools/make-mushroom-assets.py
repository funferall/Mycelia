"""Original low-poly ectomycorrhizal specimens; Blender 4.2 --background --python this.py.

Run with -- --render for a comparison sheet. Photographs are reference only;
no source photographs, textures or downloaded geometry are distributed.
"""
import importlib.util
import json
import math
import sys
from pathlib import Path
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('forest_assets', Path(__file__).with_name('make-forest-assets.py'))
pack = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pack)
KINDS = ('porcini-button', 'porcini-opening', 'porcini-mature', 'chanterelle', 'amethyst-deceiver')
SOURCES = {
    'porcini': ('Boletus edulis', 'https://explore.beatymuseum.ubc.ca/mushroomsup/B_edulis.html', 'https://www.first-nature.com/fungi/boletus-edulis.php'),
    'chanterelle': ('Cantharellus cibarius', 'https://www.first-nature.com/fungi/cantharellus-cibarius.php'),
    'amethyst-deceiver': ('Laccaria amethystina', 'https://www.first-nature.com/fungi/laccaria-amethystina.php'),
}


def skin(mesh, profile, slot, sides=16, wave=0):
    """Closed lathed profile with a slight organic, deterministic cap margin."""
    rings = []
    for r, z in profile:
        rings.append([Vector((r * math.cos(a) * (1 + .025 * math.sin(3*a)),
                              r * math.sin(a), z + wave * r * math.sin(5*a + .4)))
                      for a in (j * math.tau / sides for j in range(sides))])
    for lo, hi in zip(rings, rings[1:]):
        for j in range(sides):
            k = (j + 1) % sides
            mesh.face([lo[j], lo[k], hi[k], hi[j]], slot)


def mushroom(kind):
    porcini = kind.startswith('porcini')
    colors = ((.66,.51,.32), (.24,.085,.025), (.68,.65,.32)) if porcini else (
        ((.72,.36,.035), (.95,.48,.045), (.82,.49,.10)) if kind == 'chanterelle' else
        ((.23,.095,.32), (.30,.10,.43), (.42,.21,.51)))
    names = ('stem', 'cap', 'pores' if porcini else 'ridges' if kind == 'chanterelle' else 'gills')
    mesh = pack.Mesh(kind, [pack.material(kind+'-'+n, c) for n,c in zip(names,colors)])
    if porcini:
        young = kind.endswith('button')
        mature = kind.endswith('mature')
        h = .075 if young else .14
        r = .040 if young else .098 if mature else .075
        skin(mesh, [(0,0),(.023,0),(.032,h*.26),(.028,h*.65),(.019,h),(0,h)], 0, 12)
        # Pore-bearing sponge surface: deliberately no radial gills.
        skin(mesh, [(0,h), (r*.55,h-.005),(r*.96,h+.002),(r,h+.007),
                    (r*.92,h+.025),(r*.60,h+.047),(0,h+.054)], 1)
        skin(mesh, [(0,h-.002),(r*.55,h-.009),(r*.96,h+.002)], 2)
        # A pale lip and an understated net pattern on the upper stem.
        skin(mesh, [(r*.96,h+.002),(r,h+.007)], 2)
        for j in range(8):
            a=j*math.tau/8
            p=lambda t,z: Vector((.021*math.cos(t),.021*math.sin(t),z))
            mesh.tube([p(a-.20,h*.76),p(a,h*.88),p(a+.20,h*.98)], [.0006]*3, 2, sides=3)
    elif kind == 'chanterelle':
        skin(mesh, [(0,0),(.012,0),(.014,.035),(.02,.07),(.048,.105),(.08,.123),
                    (.084,.132),(.065,.128),(.035,.106),(.012,.082),(0,.080)], 1, sides=12, wave=.12)
        # Blunt descending folds and forked outer branches, not blade gills.
        for j in range(12):
            a=j*math.tau/12
            def p(r,z,t=a): return Vector((r*math.cos(t),r*math.sin(t),z+.12*r*math.sin(5*t+.4)))
            mesh.tube([p(.015,.045),p(.026,.079),p(.075,.117)], [.0015,.002,.001], 2, sides=3)
            mesh.tube([p(.045,.094),p(.075,.117,a+.11)], [.0015,.0008], 2, sides=3)
    else:
        skin(mesh, [(0,0),(.007,0),(.006,.045),(.008,.1),(0,.105)], 0, 12)
        skin(mesh, [(0,.105),(.019,.105),(.042,.104),(.043,.11),(.031,.115),(.012,.115),(0,.111)], 1, wave=.025)
        # Widely spaced, thick violet gills; alternate shorter blades.
        for j in range(16):
            a=j*math.tau/16
            p=lambda r,z,t: Vector((r*math.cos(t),r*math.sin(t),z))
            inner=.010 if j%2 else .022
            mesh.face([p(inner,.104,a),p(.041,.105,a),p(.025,.096,a+.023)],2)
            mesh.face([p(inner,.104,a),p(.025,.096,a+.023),p(.041,.105,a+.046)],2)
    obj=mesh.object()
    for face in obj.data.polygons: face.use_smooth=True
    obj['scientific_name']=SOURCES['porcini' if porcini else kind][0]
    obj['ecology']='ectomycorrhizal; visual specimen, not species-specific gameplay'
    return obj, None


def generate(out):
    entries=[]
    for kind in KINDS:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        obj,_=mushroom(kind)
        pack.ground(obj)
        path=out/'fungi'/f'{kind}.glb'
        record=pack.export_asset(obj,None,path,'fungus.'+kind,0,500)
        record['file']=path.relative_to(out).as_posix()
        source=SOURCES['porcini' if kind.startswith('porcini') else kind]
        entries.append({'id':'fungus.'+kind,'species':source[0], 'referenceUrls':list(source[1:]),
                        'generator':'tools/make-mushroom-assets.py','lods':[record]})
    return entries


def render(out, entries):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    labels=['Porcini / button','Porcini / opening','Porcini / mature','Golden chanterelle','Amethyst deceiver']
    for i,entry in enumerate(entries):
        bpy.ops.object.select_all(action='DESELECT')
        bpy.ops.import_scene.gltf(filepath=str(out/entry['lods'][0]['file']))
        for obj in bpy.context.selected_objects:
            if obj.parent is None:
                obj.scale *= 10
                obj.location.x += (i-2)*2.5
        font=bpy.data.curves.new('label','FONT'); font.body=labels[i]; font.size=.18; font.align_x='CENTER'
        label=bpy.data.objects.new('label',font); bpy.context.collection.objects.link(label)
        label.location=((i-2)*2.5,-1.25,.015)
        font.materials.append(pack.material('ink',(.7,.62,.44)))
    bpy.ops.mesh.primitive_plane_add(size=200)
    bpy.context.object.location.z=-.02
    bpy.context.object.data.materials.append(pack.material('soil',(.025,.021,.014)))
    target=Vector((0,0,.6))
    bpy.ops.object.camera_add(location=(0,-13,9))
    camera=bpy.context.object; camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
    camera.data.type='ORTHO'; camera.data.ortho_scale=13.5
    scene=bpy.context.scene; scene.camera=camera
    for loc,power,size in [((-3,-4,8),1800,7),((4,3,6),1200,5)]:
        bpy.ops.object.light_add(type='AREA',location=loc)
        lamp=bpy.context.object; lamp.data.energy=power; lamp.data.shape='DISK'; lamp.data.size=size
        lamp.rotation_euler=(target-lamp.location).to_track_quat('-Z','Y').to_euler()
    scene.world=bpy.data.worlds.new('studio'); scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs[1].default_value=.3
    scene.render.engine='CYCLES'; scene.cycles.samples=32
    scene.render.threads_mode='FIXED'; scene.render.threads=4
    scene.cycles.use_denoising=True
    scene.render.resolution_x=1800; scene.render.resolution_y=700; scene.render.resolution_percentage=100
    target=ROOT/'design/shots/mushroom-specimens.png'; target.parent.mkdir(parents=True,exist_ok=True)
    scene.render.filepath=str(target); bpy.ops.render.render(write_still=True)


if __name__=='__main__':
    out=ROOT/'public/assets'
    entries=generate(out)
    path=out/'forest-manifest.json'; manifest=json.loads(path.read_text())
    ids={e['id'] for e in entries}
    manifest['assets']=[e for e in manifest['assets'] if e['id'] not in ids]+entries
    path.write_text(json.dumps(manifest,indent=2)+'\n')
    if '--render' in sys.argv: render(out,entries)
