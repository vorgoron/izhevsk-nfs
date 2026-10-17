#!/usr/bin/env python3
"""COLLADA (.dae, экспорт SketchUp) → glTF для сборщиков моделей (lib.mjs → readGltf).

Blender 3.1 такие файлы читает, но детали из library_nodes по сцене не расставляет, поэтому свой разбор:
обходит visual_scene с instance_node / instance_geometry, переносит вершины в мир (матрицы узлов, единицы
из <unit>, Z_UP → Y_UP) и пишет один узел на экземпляр геометрии, примитив — на материал (имя материала
сохраняется). Нормали, UV и линии (<lines>) отбрасываются.

Запуск: python3 -I tools/models/dae2gltf.py модель.dae модель.gltf
"""
import base64
import json
import struct
import sys
import xml.etree.ElementTree as ET


def strip(tag):
    return tag.split('}', 1)[-1]


def main(src, out):
    root = ET.parse(src).getroot()
    for el in root.iter():
        el.tag = strip(el.tag)
    by_id = {el.get('id'): el for el in root.iter() if el.get('id')}
    unit = root.find('asset/unit')
    scale = float(unit.get('meter')) if unit is not None else 1.0
    up = (root.findtext('asset/up_axis') or 'Y_UP').strip()

    def floats(text):
        return [float(v) for v in text.split()]

    def mat_mul(a, b):  # 4×4 построчно
        return [sum(a[r * 4 + k] * b[k * 4 + c] for k in range(4)) for r in range(4) for c in range(4)]

    def local(node):
        m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
        for el in node:
            if el.tag == 'matrix':
                m = mat_mul(m, floats(el.text))
            elif el.tag == 'translate':
                x, y, z = floats(el.text)
                m = mat_mul(m, [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1])
            elif el.tag == 'scale':
                x, y, z = floats(el.text)
                m = mat_mul(m, [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1])
            elif el.tag == 'rotate':
                raise SystemExit('rotate в узлах не поддержан')
        return m

    def material_names(inst):
        names = {}
        for im in inst.iter('instance_material'):
            mat = by_id.get(im.get('target', '').lstrip('#'))
            names[im.get('symbol')] = (mat.get('name') if mat is not None else None) or im.get('target').lstrip('#')
        return names

    nodes = []  # { name, prims: { материал: (позиции, индексы) } }

    def add_geometry(inst, world, name):
        geo = by_id[inst.get('url').lstrip('#')]
        mesh = geo.find('mesh')
        names = material_names(inst)
        prims = {}
        for tri in mesh.findall('triangles') + mesh.findall('polylist'):
            inputs = tri.findall('input')
            stride = max(int(i.get('offset', 0)) for i in inputs) + 1
            vin = next(i for i in inputs if i.get('semantic') == 'VERTEX')
            verts = by_id[vin.get('source').lstrip('#')]
            pos_src = by_id[next(i for i in verts.findall('input') if i.get('semantic') == 'POSITION').get('source').lstrip('#')]
            pts = floats(pos_src.find('float_array').text)
            p = [int(v) for v in (tri.findtext('p') or '').split()]
            if tri.tag == 'polylist' and any(int(c) != 3 for c in tri.findtext('vcount').split()):
                raise SystemExit('polylist не из треугольников')
            idx = p[int(vin.get('offset', 0))::stride]
            mat = names.get(tri.get('material'), tri.get('material') or 'default')
            pos, ind = prims.setdefault(mat, ([], []))
            remap = {}
            for i in idx:
                if i not in remap:
                    x, y, z = pts[i * 3:i * 3 + 3]
                    w = world
                    v = [w[0] * x + w[1] * y + w[2] * z + w[3], w[4] * x + w[5] * y + w[6] * z + w[7], w[8] * x + w[9] * y + w[10] * z + w[11]]
                    v = [c * scale for c in v]
                    if up == 'Z_UP':
                        v = [v[0], v[2], -v[1]]
                    remap[i] = len(pos) // 3
                    pos.extend(v)
                ind.append(remap[i])
        if prims:
            nodes.append({'name': name, 'prims': prims})

    def walk(node, parent, path):
        world = mat_mul(parent, local(node))
        name = node.get('name') or path
        for el in node:
            if el.tag == 'node':
                walk(el, world, name)
            elif el.tag == 'instance_node':
                walk(by_id[el.get('url').lstrip('#')], world, name)
            elif el.tag == 'instance_geometry':
                add_geometry(el, world, name)

    scene = by_id[root.find('scene/instance_visual_scene').get('url').lstrip('#')]
    ident = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    for n in scene.findall('node'):
        walk(n, ident, n.get('name') or '')

    # ---- запись glTF с встроенным буфером
    blob = bytearray()
    views, accessors, meshes, gnodes, materials = [], [], [], [], {}

    def view(data, target):
        while len(blob) % 4:
            blob.append(0)
        views.append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(data), 'target': target})
        blob.extend(data)
        return len(views) - 1

    for n in nodes:
        prims = []
        for mat, (pos, ind) in n['prims'].items():
            if not ind:
                continue
            lo = [min(pos[k::3]) for k in range(3)]
            hi = [max(pos[k::3]) for k in range(3)]
            accessors.append({'bufferView': view(struct.pack(f'<{len(pos)}f', *pos), 34962), 'componentType': 5126,
                              'count': len(pos) // 3, 'type': 'VEC3', 'min': lo, 'max': hi})
            accessors.append({'bufferView': view(struct.pack(f'<{len(ind)}I', *ind), 34963), 'componentType': 5125,
                              'count': len(ind), 'type': 'SCALAR'})
            m = materials.setdefault(mat, len(materials))
            prims.append({'attributes': {'POSITION': len(accessors) - 2}, 'indices': len(accessors) - 1, 'material': m})
        if prims:
            meshes.append({'name': n['name'], 'primitives': prims})
            gnodes.append({'name': n['name'], 'mesh': len(meshes) - 1})

    doc = {
        'asset': {'version': '2.0', 'generator': 'tools/models/dae2gltf.py'},
        'scene': 0, 'scenes': [{'nodes': list(range(len(gnodes)))}],
        'nodes': gnodes, 'meshes': meshes,
        'materials': [{'name': k} for k, _ in sorted(materials.items(), key=lambda kv: kv[1])],
        'accessors': accessors, 'bufferViews': views,
        'buffers': [{'byteLength': len(blob), 'uri': 'data:application/octet-stream;base64,' + base64.b64encode(bytes(blob)).decode()}],
    }
    with open(out, 'w') as f:
        json.dump(doc, f)
    tris = sum(len(ind) // 3 for n in nodes for _, ind in n['prims'].values())
    print(f'{len(gnodes)} узлов, {len(materials)} материалов, {tris} треугольников → {out}')


if __name__ == '__main__':
    main(*sys.argv[1:3])
