# Снимки окна Blender после blender_view.py — 6 ракурсов на машину, PNG в OUT. Запуск:
#   python3 tools/models/blender/bl.py -c "OUT = '<папка>'; CARS = {'largus': -1.3, 'elargus': 1.3}; D = 3.2; \
#       exec(open('<путь>/blender_shots.py').read())"
# CARS — x машин из вывода blender_view.py; D — дистанция (3,2 — вся машина, 1,5 — деталь); FOCUS = (x, y, z) и
# VIEWS = [(имя, (dx, dy, dz))] — свой ракурс. Камера — точкой и направлением, не углами Эйлера (те промахиваются внутрь
# кузова); машина смотрит в −y. Снимки делаются таймером: кадр должен перерисоваться. Подождать ~0,6 с на снимок, потом
# склеить: python3 <путь>/montage.py <папка> out.png имена…
import bpy
from mathutils import Vector

w = bpy.context.window_manager.windows[0]
a = next(a for a in w.screen.areas if a.type == 'VIEW_3D')
r3 = a.spaces.active.region_3d
D = globals().get('D', 3.2)
# направление от машины к камере: спереди справа, спереди слева, сзади справа, сзади слева, перед, зад
dirs = globals().get('VIEWS') or [('fr', (1, -1.3, .45)), ('fl', (-1, -1.3, .45)), ('rr', (1, 1.3, .45)),
                                  ('rl', (-1, 1.3, .45)), ('front', (0, -1, .25)), ('rear', (0, 1, .25))]
views = [(f'{car}-{tag}', Vector(globals().get('FOCUS') or (x, 0, .75)), Vector(d).normalized())
         for car, x in CARS.items() for tag, d in dirs]

def step(i=[0], phase=[0]):
    if i[0] >= len(views): return None
    name, focus, d = views[i[0]]
    if phase[0] == 0:
        r3.view_perspective = 'PERSP'; r3.view_location = focus; r3.view_distance = D
        r3.view_rotation = (-d).to_track_quat('-Z', 'Y'); a.tag_redraw()
        phase[0] = 1; return 0.4
    with bpy.context.temp_override(window=w, area=a):
        bpy.ops.screen.screenshot_area(filepath=f'{OUT}/{name}.png')
    phase[0] = 0; i[0] += 1; return 0.1

bpy.app.timers.register(step, first_interval=0.2)
print(len(views), 'снимков')
