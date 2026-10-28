# Осмотр собранных glb в открытом Blender (через tools/models/blender/bl.py). Запуск:
#   python3 tools/models/blender/bl.py -c "CARS = ['largus', 'elargus']; LO = False; exec(open('<путь>/blender_view.py').read())"
# Машины ставятся рядом по x через 2,6 м (первая — левее), смотрят в −y, верх — z. LO = True — облегчённый набор вместо
# полного. Как в игре: сглаживание 30°, вершинные цвета, без изнанки. Колесо в glb одно, в начале координат, — ставится и
# копируется на четыре места по wheels из extras сцены (z осей игры: +вперёд, в Blender это −y). Печатает x каждой машины — для blender_shots.py.
import bpy, math, json

ROOT = '/Users/vorgoron/Projects/personal/izhevsk-nfs/public/models/'
FILE = {'m412': 'moskvich'}
LO = globals().get('LO', False)
for c in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.collections):
    for x in list(c): c.remove(x)
placed = {}
for i, car in enumerate(CARS):
    dx = (i - (len(CARS) - 1) / 2) * 2.6
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=ROOT + FILE.get(car, car) + '.glb')
    new = [o for o in bpy.data.objects if o not in before]
    col = bpy.data.collections.new(car); bpy.context.scene.collection.children.link(col)
    for o in new:
        for c in o.users_collection: c.objects.unlink(o)
        col.objects.link(o)
    w = bpy.context.scene.get('wheels'); w = w.to_dict() if w else None
    for o in new:
        if o.parent is None: o.location.x += dx
    meshes = [o for o in new if o.type == 'MESH']
    for o in meshes:
        name = o.name.removeprefix('lo-')  # сменные детали «Оды» (o-слот-вариант-часть) — только штатные
        hide = o.name.startswith('lo-') != LO or name.startswith('o-') and '-stock-' not in name
        o.hide_set(hide); o.hide_render = hide
        if hide: continue
        for s in bpy.context.selected_objects: s.select_set(False)
        bpy.context.view_layer.objects.active = o; o.select_set(True)
        bpy.ops.object.shade_auto_smooth(angle=math.radians(30))
    wh = next((o for o in meshes if o.name.split('.')[0] == ('lo-wheel' if LO else 'wheel')), None)
    if wh and w:  # переднее правое; остальные — копии, левые отражены по x
        wh.parent = None
        for k, (sx, z) in enumerate(((1, w['front']), (1, w['rear']), (-1, w['front']), (-1, w['rear']))):
            c = wh if k == 0 else wh.copy()
            if k: col.objects.link(c)
            c.location = (dx + sx * w['track'], -z, w['r'])
            if sx < 0: c.scale.x = -abs(c.scale.x)
    placed[car] = dx
for a in (bpy.context.screen.areas if bpy.context.screen else ()):  # без окна (-b) экрана нет
    if a.type == 'VIEW_3D':
        sh = a.spaces.active.shading
        sh.type = 'SOLID'; sh.color_type = 'VERTEX'; sh.show_backface_culling = True; sh.light = 'STUDIO'
        a.spaces.active.overlay.show_overlays = False
print(json.dumps(placed))
