# Чистка исходника готовой модели перед сборщиком в Node: убрать грани, которых не видно снаружи (салон, изнанка
# панелей, детали под бамперами). Сборщик упрощает модель долями от числа треугольников, и невидимые грани съедали
# бюджет наравне с видимыми: у Весты (без колёс) не видно 24 тыс. из 55 тыс., у пластика — 20 тыс. из 33 (салон).
#
# Грань видна, если хоть один из 512 лучей (в полусфере перед гранью) уходит наружу — из центра или из точек у вершин:
# узкую грань у фары центр может закрывать соседняя деталь, а край — торчать. Как в игре: машины
# рисуются только лицевой стороной (FrontSide), так что грань, повёрнутая к лучу изнанкой, его не задерживает —
# сквозь неё в игре видно, что лежит позади (иначе пропадала рамка в корпусе фары: её закрывали изнанкой детали
# решётки, и в игре на месте рамки была гребёнка). Препятствия — только то, что останется в игре: материалы, которые
# сборщик выбрасывает (--drop), не загораживают (стёкла фар — иначе фары «невидимы»). Колёса (узлы wheel*) не трогаем
# и не считаем препятствиями — у сборщика они отдельно.
#
#   Blender -b --factory-startup --python tools/models/blender/clean.py -- src.gltf out.gltf [--drop 'регэксп']
#       [--wheels 'регэксп'] [--pick 'x < 0'] [--orient]
#
# --drop — регэксп по «узел/материал» (узел — объект Blender, как в исходнике). Вывод — glTF с отдельным .bin,
# имена узлов и материалов как в исходнике: сборщик читает его так же (readGltf в lib.mjs).
# --wheels — регэксп по «узел/материал» для колёс, если узлы не названы wheel*.
# --pick — условие на центр объекта (x, y, z — координаты Blender: x вбок, y назад, z вверх); что не подходит, удаляется
# (в исходниках Ларгусов рядом стоит вторая машина с открытыми дверями — иначе она загораживает борт).
# --orient — обход граней каждого объекта по геометрии: площадь граней, смотрящих от продольной оси машины, должна
# перевешивать. У Ларгусов зеркальные узлы непоследовательны (одним обход по glTF разворачивать, другим нет), и без
# этого проверка видимости смотрела бы внутрь кузова (как в largus.mjs, где после чистки обход правится так же).
import argparse, collections, math, re, sys
import bmesh, bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ap = argparse.ArgumentParser()
ap.add_argument('src'); ap.add_argument('out'); ap.add_argument('--drop', default='$^')
ap.add_argument('--wheels', default='$^'); ap.add_argument('--pick'); ap.add_argument('--orient', action='store_true')
args = ap.parse_args(sys.argv[sys.argv.index('--') + 1:])
drop, wheels = re.compile(args.drop), re.compile(args.wheels)

for c in (bpy.data.objects, bpy.data.meshes, bpy.data.materials):  # с чистого листа: иначе имена получат «.001»
    for x in list(c): c.remove(x)
bpy.ops.import_scene.gltf(filepath=args.src)

mat = lambda o: o.data.materials[0].name if o.data.materials else ''

def wheel(o):
    if wheels.search(f'{o.name}/{mat(o)}'): return True
    while o:
        if o.name.startswith('wheel'): return True
        o = o.parent
    return False

if args.pick:
    for o in [o for o in bpy.data.objects if o.type == 'MESH']:
        x, y, z = sum((o.matrix_world @ Vector(c) for c in o.bound_box), Vector()) / 8
        if not eval(args.pick): bpy.data.objects.remove(o)
meshes = [o for o in bpy.data.objects if o.type == 'MESH' and not wheel(o)]
for o in meshes:
    assert len(o.data.materials) <= 1, f'{o.name}: несколько материалов — --drop по материалу неточен'
kept = [o for o in meshes if not drop.search(f'{o.name}/{mat(o)}')]

def inward(o):  # обход объекта смотрит внутрь машины (с учётом зеркальности узла)
    mw, out = o.matrix_world, 0.0
    for p in o.data.polygons:
        c = mw @ p.center; n = (mw.to_3x3().inverted().transposed() @ p.normal) * p.area
        a = Vector((0, max(ax[0], min(ax[1], c.y)), axz))  # ближайшая точка продольной оси
        out += n.dot(c - a)
    return out < 0

if args.orient:  # ось: вдоль y по середине машины, на 0,45 высоты, концы — на 0,6 полудлины
    lo = Vector([min((o.matrix_world @ Vector(c))[k] for o in meshes for c in o.bound_box) for k in range(3)])
    hi = Vector([max((o.matrix_world @ Vector(c))[k] for o in meshes for c in o.bound_box) for k in range(3)])
    my, hy, axz = (lo.y + hi.y) / 2, (hi.y - lo.y) / 2 * 0.6, lo.z + (hi.z - lo.z) * 0.45
    ax = (my - hy, my + hy)
    flipped = [o for o in meshes if inward(o)]
    for o in flipped:
        if o.data.users > 1: o.data = o.data.copy()
        o.data.flip_normals()
    print('развёрнуты:', ' '.join(sorted({mat(o) for o in flipped})))

verts, polys, owner = [], [], []
for o in kept:
    base, flip = len(verts), o.matrix_world.determinant() < 0  # зеркальный узел: лицевая сторона — по обратному обходу
    verts += [o.matrix_world @ v.co for v in o.data.vertices]
    for p in o.data.polygons:
        ids = [base + i for i in p.vertices]
        polys.append(ids[::-1] if flip else ids); owner.append((o, p.index))
bvh = BVHTree.FromPolygons(verts, polys, epsilon=0.0)

N, ga = 512, math.pi * (3 - math.sqrt(5))  # равномерно по сфере (спираль Фибоначчи)
dirs = []
for i in range(N):
    y = 1 - 2 * (i + 0.5) / N; r = math.sqrt(1 - y * y)
    dirs.append(Vector((math.cos(ga * i) * r, y, math.sin(ga * i) * r)))

def escapes(c, d):
    for _ in range(100):
        hit, nrm, _, _ = bvh.ray_cast(c + d * 2e-4, d, 20.0)
        if hit is None: return True
        if nrm.dot(d) > 0: return False  # к смотрящему снаружи — лицом: загораживает
        c = hit  # изнанкой: в игре не рисуется, луч идёт дальше
    return False

visible = lambda c, n: any(d.dot(n) > 0.05 and escapes(c, d) for d in dirs)

hidden, tot, hid = collections.defaultdict(list), collections.Counter(), collections.Counter()
for o, pi in owner:
    p, mw = o.data.polygons[pi], o.matrix_world
    tri = len(p.vertices) - 2; tot[mat(o)] += tri
    n, c = (mw.to_3x3().inverted().transposed() @ p.normal).normalized(), mw @ p.center
    if not any(visible(q, n) for q in [c] + [c.lerp(mw @ o.data.vertices[v].co, 0.9) for v in p.vertices]):
        hidden[o.name].append(pi); hid[mat(o)] += tri

for name, ids in hidden.items():
    o = bpy.data.objects[name]; bm = bmesh.new(); bm.from_mesh(o.data); bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.faces[i] for i in ids], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(o.data); bm.free()

for m, t in tot.most_common(): print(f'{m:16} {t:7} → {t - hid[m]:7}')
print(f'всего {sum(tot.values())} → {sum(tot.values()) - sum(hid.values())}')
bpy.ops.export_scene.gltf(filepath=args.out, export_format='GLTF_SEPARATE', export_materials='EXPORT',
                          export_image_format='NONE', export_texcoords=False, export_normals=False, export_animations=False)
