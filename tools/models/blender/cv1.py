# Концепт «Калашников CV-1» (2018) — модель целиком построена здесь, без чужих исходников. Образец — пять фото с показа.
#
# Кузов — две поверхности, заданные формулами, и скругление между ними:
#   «верх»  — профиль по оси машины (подбородок → нос → капот → лобовое → крыша → пятая дверь → корма), протянутый
#             поперёк; карта (x, s), s — длина вдоль профиля;
#   «борт»  — x = xside(y, z): подворот порога, плоскость борта, скос к подоконной линии, полка, завал стёкол; карта (z, y).
# Всё остальное (стёкла, маска, фонари, ниша порта, щели дверей, расширители арок) — области на этих картах: контур
# врезается в триангуляцию (Делоне с ограничениями), вершины внутри утапливаются по нормали. Поэтому крыша, окна и
# линии дверей лежат на одной гладкой поверхности и не могут разойтись.
#
# Запуск в открытом Blender (дополнение MCP):  python3 tools/models/blender/bl.py tools/models/blender/cv1.py
# без окна: Blender -b --factory-startup --python tools/models/blender/cv1.py
# Итог — 3d-models/cv1/cv1.gltf; из него tools/models/cv1.mjs собирает public/models/cv1.glb.
# Материалы названы «роль:#цвет» (paint, detail, lights, wheel). Координаты — игровые (x поперёк, y вверх, z вперёд);
# в Blender это (x, −z, y). Строится правая половина, левая — зеркало.
import bpy, bmesh, math, os, json
from mathutils import Vector
from mathutils.geometry import delaunay_2d_cdt

ROOT = '/Users/vorgoron/Projects/personal/izhevsk-nfs/'
VIEW = {'paint': '#9fc6de'}  # цвет кузова в окне Blender (в glb кузов белый — красит игра)

for c in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.collections):
    for x in list(c): c.remove(x)

def mat(role, color):
    name = f'{role}:{color}'
    m = bpy.data.materials.get(name)
    if not m:
        m = bpy.data.materials.new(name)
        v = VIEW.get(role, color)
        m.diffuse_color = [int(v[i:i + 2], 16) / 255 for i in (1, 3, 5)] + [1]
        if color == '#c8ccd0': m.diffuse_color = (0.92, 0.93, 0.95, 1)
        m.roughness = 0.5
    return m
def slot(me, m):
    i = me.materials.find(m.name)
    if i < 0: me.materials.append(m); i = len(me.materials) - 1
    return i
G = lambda x, y, z: Vector((x, -z, y))          # игра → Blender

PAINT, CHROME, BLACK = ('paint', '#ffffff'), ('detail', '#c8ccd0'), ('detail', '#0b0c0e')
MESH, RUBBER, GLASS, GAP = ('detail', '#1b1e22'), ('detail', '#151618'), ('detail', '#0d1014'), ('detail', '#3a4046')
LED, TAIL = ('lights', '#f4f8ff'), ('lights', '#c0160f')

class Build:
    """Грани в игровых координатах; обход разворачивается наружу по подсказке out. sym — добавлять зеркальную копию."""
    def __init__(s, name): s.name, s.v, s.f, s.m, s.y, s.sym = name, [], [], [], [], True
    def face(s, pts, m, out):
        pts = [Vector(p) for p in pts]
        c = sum(pts, Vector()) / len(pts)
        n = Vector()
        for i in range(1, len(pts) - 1): n += (pts[i] - pts[0]).cross(pts[i + 1] - pts[0])
        if n.length < 1e-12: return
        o = Vector(out(c) if callable(out) else out)
        if n.dot(o) < 0: pts.reverse()
        k = len(s.v); s.v += [G(*p) for p in pts]; s.f.append(list(range(k, k + len(pts)))); s.m.append(m); s.y.append(s.sym)
    def make(s):
        V, F, M = list(s.v), list(s.f), list(s.m)
        for f, m, y in zip(s.f, s.m, s.y):
            if not y: continue
            k = len(V); V += [Vector((-s.v[i].x, s.v[i].y, s.v[i].z)) for i in reversed(f)]
            F.append(list(range(k, k + len(f)))); M.append(m)
        me = bpy.data.meshes.new(s.name); me.from_pydata(V, [], F)
        for p, m in zip(me.polygons, M): p.material_index = slot(me, mat(*m))
        bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0002)
        bm.to_mesh(me); bm.free()
        o = bpy.data.objects.new(s.name, me); bpy.context.scene.collection.objects.link(o); return o

# ---------------------------------------------------------------- плоская геометрия карт
def interp(tab, v):  # tab: [(ключ, значение)] по возрастанию ключа
    if v <= tab[0][0]: return tab[0][1]
    for (a, x), (b, y) in zip(tab, tab[1:]):
        if v <= b: return x + (y - x) * (v - a) / (b - a) if b > a else y
    return tab[-1][1]
lerp = lambda a, b, t: a + (b - a) * t
sm = lambda t: (lambda t: t * t * (3 - 2 * t))(min(1, max(0, t)))
def lin(a, b, n): return [a + (b - a) * i / n for i in range(n + 1)]

def rounded(P, closed=True, da=math.radians(15)):
    """Ломаная со скруглёнными углами. P: [(u, v, радиус)] → [(u, v, номер исходной точки)]."""
    out, n = [], len(P)
    for k, p in enumerate(P):
        u, v, rad = p if len(p) > 2 else (*p, 0)
        if rad <= 0 or (not closed and k in (0, n - 1)): out.append((u, v, k)); continue
        b = Vector((u, v)); d0 = Vector(P[k - 1][:2]) - b; d1 = Vector(P[(k + 1) % n][:2]) - b
        l0, l1 = d0.length, d1.length; d0.normalize(); d1.normalize()
        ang = math.pi - d0.angle(d1)
        if ang < 1e-4: out.append((u, v, k)); continue
        t = min(rad * math.tan(ang / 2), 0.45 * l0, 0.45 * l1); rr = t / math.tan(ang / 2)
        ctr = b + (d0 + d1).normalized() * (rr / math.cos(ang / 2))
        v0, v1 = b + d0 * t - ctr, b + d1 * t - ctr
        sg = 1 if v0.x * v1.y - v0.y * v1.x > 0 else -1
        m = max(2, math.ceil(ang / da))
        for i in range(m + 1):
            a = sg * ang * i / m; ca, sa = math.cos(a), math.sin(a)
            out.append((ctr.x + v0.x * ca - v0.y * sa, ctr.y + v0.x * sa + v0.y * ca, k))
    return out
def rect(u0, u1, v0, v1, rad=0):
    u0, u1 = sorted((u0, u1)); v0, v1 = sorted((v0, v1))
    return [p[:2] for p in rounded([(u0, v0, rad), (u1, v0, rad), (u1, v1, rad), (u0, v1, rad)])]
def inset(P, d):
    n = len(P); A = sum(P[i][0] * P[(i + 1) % n][1] - P[(i + 1) % n][0] * P[i][1] for i in range(n))
    sg, L = (1 if A > 0 else -1), []
    for i in range(n):
        a, b = Vector(P[i]), Vector(P[(i + 1) % n]); t = (b - a).normalized()
        L.append((a + Vector((-t.y, t.x)) * (sg * d), t))
    out = []
    for i in range(n):
        (p0, t0), (p1, t1) = L[i - 1], L[i]
        cr = t0.x * t1.y - t0.y * t1.x
        if abs(cr) < 1e-6: out.append(tuple(p1)); continue
        q = p1 - p0; out.append(tuple(p0 + t0 * ((q.x * t1.y - q.y * t1.x) / cr)))
    return out
def clip0(P):  # часть многоугольника при u ≥ 0
    out = []
    for i in range(len(P)):
        a, b = P[i - 1], P[i]
        if (a[0] >= 0) != (b[0] >= 0): t = a[0] / (a[0] - b[0]); out.append((0.0, a[1] + (b[1] - a[1]) * t))
        if b[0] >= 0: out.append((b[0], b[1]))
    return out
def stroke(path, w):  # ломаная → полоска шириной w
    L, R = [], []
    for i, p in enumerate(path):
        t = (Vector(path[min(i + 1, len(path) - 1)]) - Vector(path[max(i - 1, 0)])).normalized()
        L.append((p[0] - t.y * w / 2, p[1] + t.x * w / 2)); R.append((p[0] + t.y * w / 2, p[1] - t.x * w / 2))
    return L, R
def pip(p, P):
    x, y = p; r = False
    for i in range(len(P)):
        (a, b), (c, d) = P[i - 1], P[i]
        if (b > y) != (d > y) and x < a + (c - a) * (y - b) / (d - b): r = not r
    return r
def near(p, P, eps):
    x, y = p
    for i in range(len(P)):
        (a, b), (c, d) = P[i - 1], P[i]
        ux, uy = c - a, d - b; L = ux * ux + uy * uy
        t = 0 if L == 0 else min(1, max(0, ((x - a) * ux + (y - b) * uy) / L))
        if (x - a - ux * t) ** 2 + (y - b - uy * t) ** 2 < eps * eps: return True
    return False
def box(P): return (min(p[0] for p in P), min(p[1] for p in P), max(p[0] for p in P), max(p[1] for p in P))

class Chart:
    """Карта поверхности: fn(u, v, d) → точка (d — утопление по нормали), hint(u, v) → направление наружу."""
    def __init__(s, fn, hint, half=False): s.fn, s.hint, s.half, s.reg, s.lines, s.pts = fn, hint, half, [], [], []
    def region(s, poly, m, depth=0, bevel=0, wall=None):
        """Область: внутри inner (контур, отступивший на bevel) — материал m и утопление depth, на откосе — wall."""
        inner = inset(poly, bevel) if bevel else poly
        if s.half: poly, inner = clip0(poly), (clip0(inner) if bevel else None)
        if not bevel: inner = poly
        s.reg.append((poly, inner, m, depth, wall, box(poly), box(inner)))
    def line(s, path, w, m=GAP):
        L, R = stroke(path, w); s.region(L + R[::-1], m)
    def depth(s, p):
        d = 0
        for poly, inner, m, dep, wall, bo, bi in s.reg:
            if dep and bi[0] - 1e-4 <= p[0] <= bi[2] + 1e-4 and bi[1] - 1e-4 <= p[1] <= bi[3] + 1e-4 and (near(p, inner, 2e-5) or pip(p, inner)): d += dep
        return d
    def at(s, u, v, lift=0): return s.fn(u, v, s.depth((u, v)) - lift)
    def build(s, B, outline, base):
        V, E = [], []
        def loop(P, closed=True):
            k = len(V); V.extend(P)
            E.extend((k + i, k + i + 1) for i in range(len(P) - 1))
            if closed: E.append((k + len(P) - 1, k))
        loop(outline)
        for r in s.reg:
            loop(r[0])
            if r[1] is not r[0]: loop(r[1])
        ok = lambda p: pip(p, outline) and not near(p, outline, 0.012)
        for l in s.lines:
            run = []
            for p in l + [None]:
                if p is not None and ok(p): run.append(p); continue
                if len(run) > 1: loop(run, False)
                run = []
        V.extend(p for p in s.pts if ok(p))
        ov, oe, of = delaunay_2d_cdt([Vector(p) for p in V], E, [], 0, 1e-7)[:3]
        P3 = [s.at(v.x, v.y) for v in ov]
        for f in of:
            c = sum((ov[i] for i in f), Vector((0, 0))) / 3; c = (c.x, c.y)
            if not pip(c, outline): continue
            m = base
            for poly, inner, rm, dep, wall, bo, bi in s.reg:
                if not (bo[0] <= c[0] <= bo[2] and bo[1] <= c[1] <= bo[3]): continue
                if pip(c, inner): m = rm
                elif inner is not poly and pip(c, poly): m = wall or m
            B.face([P3[i] for i in f], m, s.hint(*c))
    def ribbon(s, B, path, w, h, m, wall=None, caps=(True, True)):
        """Накладка вдоль ломаной: ширина w, высота h (число или список по точкам) над поверхностью."""
        L, R = stroke(path, w); H = h if isinstance(h, list) else [h] * len(path)
        bl, br = [s.at(*p) for p in L], [s.at(*p) for p in R]
        tl, tr = [s.at(*p, lift=H[i]) for i, p in enumerate(L)], [s.at(*p, lift=H[i]) for i, p in enumerate(R)]
        wall = wall or m
        for i in range(len(path) - 1):
            j = i + 1; side = Vector(tl[i]) - Vector(tr[i])
            B.face([tl[i], tr[i], tr[j], tl[j]], m, s.hint(*path[i]))
            B.face([bl[i], tl[i], tl[j], bl[j]], wall, side); B.face([br[i], tr[i], tr[j], br[j]], wall, -side)
        for k, j in ((0, 1), (len(path) - 1, len(path) - 2)):
            if caps[0 if k == 0 else 1]: B.face([bl[k], br[k], tr[k], tl[k]], wall, Vector(tl[k]) - Vector(tl[j]))

# ---------------------------------------------------------------- размеры
R_W, ZF_W, ZR_W, TRACK = 0.32, 1.408, -1.032, 0.683     # колёса: радиус, оси, полуколея
RA, YSILL, XL = 0.375, 0.24, 0.42                         # радиус арки, низ порога, глубина ниши колеса
LH, TUMBLE = 0.02, 0.25                                  # высота полки под окнами, завал стёкол (x на метр высоты)

# профиль по оси машины: (z, y, радиус скругления), затем по тем же точкам — радиус кромки «верх/борт» и выпуклость
PROF = [(1.79, 0.225, 0), (1.89, 0.225, 0.09), (1.975, 0.50, 0.30), (2.07, 0.925, 0.06), (0.95, 0.968, 0.06), (0.47, 1.392, 0.13),
        (-0.45, 1.402, 6), (-1.30, 1.38, 0.13), (-1.70, 1.02, 0.10), (-2.025, 0.905, 0.05), (-1.965, 0.31, 0.07), (-1.82, 0.31, 0)]
R_K = [0.02, 0.02, 0.02, 0.02, 0.03, 0.05, 0.05, 0.05, 0.03, 0.02, 0.02, 0.02]
C_K = [0.02, 0.03, 0.03, 0.03, 0.015, 0.022, 0.022, 0.022, 0.02, 0.02, 0.03, 0.02]

pr, st = rounded(PROF, closed=False), []
for a, b in zip(pr, pr[1:]):
    st.append(a); n = int(math.hypot(b[0] - a[0], b[1] - a[1]) // 0.085)
    st += [(lerp(a[0], b[0], j / (n + 1)), lerp(a[1], b[1], j / (n + 1)), None) for j in range(1, n + 1)]
st.append(pr[-1])
N = len(st)
GZ, GY = [p[0] for p in st], [p[1] for p in st]
S_ = [0.0]
for i in range(1, N): S_.append(S_[-1] + math.hypot(GZ[i] - GZ[i - 1], GY[i] - GY[i - 1]))
LM = []                                                  # станция в середине скругления каждой контрольной точки
for k in range(len(PROF)):
    ids = [i for i, p in enumerate(st) if p[2] == k]; LM.append(ids[len(ids) // 2])
NZ, NY = [], []                                          # нормаль наружу в плоскости (z, y)
for i in range(N):
    a, b = max(i - 1, 0), min(i + 1, N - 1); d = Vector((GZ[b] - GZ[a], GY[b] - GY[a])).normalized()
    NZ.append(d.y); NY.append(-d.x)
R_ = [interp([(S_[LM[k]], R_K[k]) for k in range(len(PROF))], s) for s in S_]
C_ = [interp([(S_[LM[k]], C_K[k]) for k in range(len(PROF))], s) for s in S_]
QZ = [GZ[i] - NZ[i] * (C_[i] + R_[i]) for i in range(N)]  # верхняя граница борта (кромка, отступившая внутрь)
QY = [GY[i] - NY[i] * (C_[i] + R_[i]) for i in range(N)]

def s_at(arr, val, k0, k1):  # s, где arr = val, между контрольными точками k0 и k1
    for i in range(LM[k0], LM[k1]):
        a, b = arr[i], arr[i + 1]
        if a != b and (a - val) * (b - val) <= 0: return lerp(S_[i], S_[i + 1], (val - a) / (b - a))
    raise ValueError((val, k0, k1))
def q_at(src, dst, val, k0, k1):
    for i in range(LM[k0], LM[k1]):
        a, b = src[i], src[i + 1]
        if a != b and (a - val) * (b - val) <= 0: return lerp(dst[i], dst[i + 1], (val - a) / (b - a))
    raise ValueError((val, k0, k1))
sA = lambda y: s_at(GY, y, 1, 2)       # фартук под маской (сильнее уходит назад)
sN = lambda y: s_at(GY, y, 2, 3)       # нос по высоте: маска, верх вынесен вперёд
sH = lambda z: s_at(GZ, z, 3, 4)       # капот по z
sW = lambda z: s_at(GZ, z, 4, 5)       # лобовое
sR = lambda z: s_at(GZ, z, 5, 7)       # крыша
sT = lambda z: s_at(GZ, z, 7, 8)       # стекло пятой двери
sD = lambda z: s_at(GZ, z, 8, 9)       # пологая панель под стеклом
sB = lambda y: s_at(GY, y, 9, 10)      # корма по высоте (скошена вперёд книзу)

# подоконная линия: спереди — кромка крыла, за лобовым почти ровно, к корме опускается под скат пятой двери
iC = next(i for i in range(LM[3], LM[4] + 1) if st[i][2] == 4)       # начало скругления у основания лобового
ZC, YM = QZ[iC], QY[iC]
Z_T = -1.93
Y_T = q_at(QZ, QY, Z_T, 8, 9) - LH - 0.02
HOOD = sorted((QZ[i], QY[i]) for i in range(LM[3], iC + 1))
def YB(z):
    if z >= ZC: return interp(HOOD, z)
    return YM - (YM - Y_T) * min(1.05, (ZC - z) / (ZC - Z_T)) ** 3
ledge = lambda z: interp([(-1.95, 0.06), (-0.85, 0.022), (ZC - 0.10, 0.022), (ZC, 0)], z)
def W(z): return 0.785 - (0.05 * (z / 2.04) ** 2.5 if z > 0 else 0.035 * (-z / 2.03) ** 2.5)
def xside(y, z):
    yb = YB(z)
    x = W(z) - 0.03 * sm((0.36 - y) / 0.14) - 0.014 * min(1.2, abs(y - 0.58) / 0.3) ** 2
    if y > yb - 0.10: x -= 0.03 * min(1, (y - yb + 0.10) / 0.10)
    if y > yb: x -= ledge(z) * min(1, (y - yb) / LH)
    if y > yb + LH: x -= TUMBLE * (y - yb - LH)
    return x
XE = [xside(QY[i], QZ[i]) for i in range(N)]
XT = [XE[i] - R_[i] for i in range(N)]
xt = lambda s: interp(list(zip(S_, XT)), s)

def top_fn(x, s, d=0):
    i = max(1, min(N - 1, next((j for j in range(1, N) if S_[j] >= s), N - 1))); f = (s - S_[i - 1]) / (S_[i] - S_[i - 1])
    L = lambda a: lerp(a[i - 1], a[i], f)
    k = L(C_) * (x / L(XE)) ** 2 + d
    return (x, L(GY) - L(NY) * k, L(GZ) - L(NZ) * k)
def top_hint(x, s):
    i = min(range(N), key=lambda j: abs(S_[j] - s)); return (0, NY[i], NZ[i])
side_fn = lambda z, y, d=0: (xside(y, z) - d, y, z)

body = Build('body')
top, side = Chart(top_fn, top_hint, half=True), Chart(side_fn, lambda z, y: (1, 0, 0))

# ---------------------------------------------------------------- «верх»: нос
MX, MY = 0.668, (0.51, 0.855)                            # маска: полуширина и высоты
top.region(rect(-MX, MX, sN(MY[0]), sN(MY[1]), 0.02), MESH, 0.028, 0.006, BLACK)
top.region(rect(-0.52, 0.52, sA(0.40), sA(0.462), 0.012), BLACK, 0.02, 0.005, BLACK)   # щель под маской
top.region(rect(-0.16, 0.16, sA(0.292), sA(0.337), 0.018), BLACK, 0.025, 0.006, BLACK)  # малый воздухозаборник
# «верх»: капот — щели и решётка у лобового
xh = lambda s: xt(s) - 0.075
hs = lin(sH(1.975), sH(1.03), 10)
top.line([(xh(s), s) for s in hs], 0.006)
top.line([(-xh(hs[0]), hs[0]), (xh(hs[0]), hs[0])], 0.006)
top.region(rect(-0.42, 0.42, sH(1.065), sH(1.005), 0.01), MESH, 0.004, 0.004, RUBBER)
# лобовое и заднее стёкла: резиновый кант и стекло чуть в глубине
def glass(s0, s1, off, rad):
    P = [(xt(s0) - off, s0, rad), (xt(s1) - off, s1, rad), (-xt(s1) + off, s1, rad), (-xt(s0) + off, s0, rad)]
    top.region([p[:2] for p in rounded(P)], GLASS, 0.006, 0.014, RUBBER)
glass(sW(0.905), sW(0.535), 0.018, 0.03)
glass(sT(-1.37), sT(-1.655), 0.07, 0.045)
# пятая дверь: щели по бокам и у крыши
i0, i1 = next(i for i in range(N) if GZ[i] < -1.20), next(i for i in range(N) if GZ[i] < -1.985 and i > LM[7])
top.line([(XT[i] - 0.028, S_[i]) for i in range(i0, i1)], 0.006)
top.line([(-XT[i0] + 0.028, S_[i0]), (XT[i0] - 0.028, S_[i0])], 0.006)
# корма: фонари в хромированных рамках, ниша зарядного порта
top.region(rect(0.36, 0.675, sB(0.67), sB(0.515), 0.012), CHROME)
top.region(rect(0.371, 0.664, sB(0.659), sB(0.526), 0.008), PAINT, 0.04, 0.012, PAINT)
top.region(rect(0.43, 0.645, sB(0.64), sB(0.552), 0.005), TAIL, 0.004, 0.004)
top.region(rect(-0.20, 0.20, sB(0.69), sB(0.49), 0.022), PAINT, 0.012, 0.012, PAINT)
top.region(rect(-0.15, 0.15, sB(0.665), sB(0.515), 0.016), PAINT, 0.04, 0.01, PAINT)

top.pts = [(f * XT[i], S_[i]) for i in range(1, N - 1) for f in (0.25, 0.5, 0.7, 0.87)]
top.build(body, [(0, S_[0])] + [(XT[i], S_[i]) for i in range(N)] + [(0, S_[i]) for i in range(N - 1, 0, -1)], PAINT)

# накладки на «верхе»
for y in (0.525, 0.62, 0.715, 0.81):                   # хромированные планки маски и светодиодные блоки между ними
    top.ribbon(body, [(x, sN(y)) for x in lin(0, 0.645, 6)], 0.009, 0.016, CHROME, caps=(False, True))
top.ribbon(body, [(0.645, sN(0.519)), (0.645, sN(0.816))], 0.009, 0.016, CHROME)
for y in (0.5725, 0.6675, 0.7625):
    top.ribbon(body, [(0.513, sN(y)), (0.625, sN(y))], 0.05, 0.016, LED, BLACK)
top.ribbon(body, [(0.06, sW(0.878)), (0.28, sW(0.87)), (0.50, sW(0.868))], 0.014, 0.016, RUBBER)   # дворник
top.ribbon(body, [(0.36, sR(-1.07)), (0.36, sR(-1.14)), (0.36, sR(-1.235))], 0.04, [0.0, 0.02, 0.03], PAINT, caps=(False, True))
body.sym = False                                         # по оси: личинка замка и крышка зарядного порта
lk = sD(-1.93)
top.ribbon(body, [(0, lk - 0.016), (0, lk + 0.016)], 0.032, 0.006, CHROME)
top.ribbon(body, [(0, lk - 0.009), (0, lk + 0.009)], 0.018, 0.009, BLACK)
cx, cy, cz = top.at(0, sB(0.59))
P = [(0.045 * math.cos(2 * math.pi * i / 16), cy + 0.045 * math.sin(2 * math.pi * i / 16)) for i in range(16)]
for (a, b), (c, d) in zip(P, P[1:] + P[:1]):
    body.face([(a, b, cz + 0.005), (c, d, cz + 0.005), (c, d, cz - 0.022), (a, b, cz - 0.022)], BLACK, (a + c, b + d - 2 * cy, 0))
    body.face([(0, cy, cz - 0.022), (a, b, cz - 0.022), (c, d, cz - 0.022)], BLACK, (0, 0, -1))
body.sym = True

# ---------------------------------------------------------------- скругление между «верхом» и бортом
NA = 4
def arc(i, k):
    a = math.pi / 2 * k / NA; T = top_fn(XT[i], S_[i]); x1 = xside(QY[i], QZ[i])
    f = 1 - math.cos(a)
    return (T[0] + (x1 - T[0]) * math.sin(a), T[1] + (QY[i] - T[1]) * f, T[2] + (QZ[i] - T[2]) * f)
for i in range(N - 1):
    for k in range(NA):
        body.face([arc(i, k), arc(i, k + 1), arc(i + 1, k + 1), arc(i + 1, k)], PAINT, (1, NY[i], NZ[i]))

# ---------------------------------------------------------------- борт
def arch(zc, y_r, y_f, rad=RA, n=28):  # дуга арки от задней пяты (высота y_r) к передней (y_f)
    a1, a0 = math.pi - math.asin((y_r - R_W) / rad), math.asin((y_f - R_W) / rad)
    return [(zc + rad * math.cos(a), R_W + rad * math.sin(a)) for a in lin(a1, a0, n)]
ARCH_R, ARCH_F = arch(ZR_W, QY[-1], YSILL), arch(ZF_W, YSILL, QY[0])
outline = list(zip(QZ, QY)) + ARCH_R + ARCH_F
circle = lambda zc, rad, n=40: [(zc + rad * math.cos(2 * math.pi * i / n), R_W + rad * math.sin(2 * math.pi * i / n)) for i in range(n)]
FL = 0.024                                               # вынос расширителя арки
for zc in (ZF_W, ZR_W):
    side.lines.append(circle(zc, RA + 0.09) + [circle(zc, RA + 0.09)[0]])
    side.region(circle(zc, RA + 0.062), PAINT, -0.3 * FL)
    side.region(circle(zc, RA + 0.034), PAINT, -0.7 * FL)
# окна: низ идёт по подоконной линии, верх — по крыше; передняя кромка вдоль стойки лобового, задняя — вдоль пятой двери
Y_R = QY[LM[6]]; YT_W = Y_R - 0.04
ybw = lambda z: YB(z) + LH + 0.028
zA = lambda y: q_at(QY, QZ, y, 4, 5) - 0.028
def window(P): side.region([p[:2] for p in rounded([(z, y, 0.02) for z, y in P])], GLASS, 0.006, 0.012, RUBBER)
window([(zA(ybw(0.86)), ybw(0.86)), (zA(YT_W), YT_W), (-0.02, YT_W), (-0.02, ybw(-0.02))])
window([(-0.07, ybw(-0.07)), (-0.07, YT_W), (-0.80, YT_W), (-0.80, ybw(-0.80))])
window([(-0.86, ybw(-0.86)), (-0.86, YT_W), (-1.24, YT_W), (-1.50, ybw(-1.50))])
# щели дверей
YD, RD = 0.275, RA + 0.10
aD = lin(math.asin((YD - R_W) / RD), math.acos((-0.83 - ZR_W) / RD), 8)
side.line([(0.90, YB(0.90) - 0.004), (0.90, YD), (-0.045, YD)], 0.006)
side.line([(-0.045, YT_W + 0.036), (-0.045, YD)] + [(ZR_W + RD * math.cos(a), R_W + RD * math.sin(a)) for a in aD] + [(-0.83, YT_W + 0.036)], 0.006)

zs = lin(-2.0, 2.05, 45)
side.lines.append([(z, YB(z) - 0.10) for z in zs])
bz = [z for z in lin(Z_T, ZC - 0.03, 32)]
side.lines += [[(z, YB(z)) for z in bz], [(z, YB(z) + LH) for z in bz]]
side.pts = [(z, y) for z in zs for y in (0.30, 0.37, 0.48, 0.60, 0.71) if min(math.hypot(z - c, y - R_W) for c in (ZF_W, ZR_W)) > RA + 0.12]
side.pts += [(z, YB(z) + LH + d) for z in zs for d in (0.16, 0.30)]
side.build(body, outline, PAINT)

for z0, z1 in ((0.0, 0.11), (-0.79, -0.68)):             # ручки дверей
    y = YB(z0) - 0.055
    side.ribbon(body, [(z0, y), (z1, y)], 0.022, 0.02, CHROME)

# арки: отбортовка внутрь, чёрная ниша колеса
for zc, A in ((ZR_W, ARCH_R), (ZF_W, ARCH_F)):
    O = [side.at(*p) for p in A]; I = [(x - 0.03, y, z) for x, y, z in O]; D = [(XL, y, z) for x, y, z in O]
    ctr = lambda q: (0, R_W - q.y, zc - q.z)
    for j in range(len(A) - 1):
        body.face([O[j], O[j + 1], I[j + 1], I[j]], PAINT, ctr)
        body.face([I[j], I[j + 1], D[j + 1], D[j]], BLACK, ctr)
        body.face([(XL, R_W, zc), D[j], D[j + 1]], BLACK, (1, 0, 0))
# днище
YF, YR = QY[0] + 0.012, QY[-1] + 0.012
for z0, z1, x1, y in ((QZ[-1], ZR_W - RA, 0.72, YR), (ZR_W - RA, ZR_W + RA, XL, YR), (ZR_W + RA, ZF_W - RA, 0.74, YSILL + 0.012),
                      (ZF_W - RA, ZF_W + RA, XL, YSILL + 0.012), (ZF_W + RA, QZ[0], 0.70, YF)):
    body.face([(0, y, z0), (x1, y, z0), (x1, y, z1), (0, y, z1)], BLACK, (0, -1, 0))
body.face([(0, YR, ZR_W + RA), (0.74, YR, ZR_W + RA), (0.74, YSILL + 0.012, ZR_W + RA), (0, YSILL + 0.012, ZR_W + RA)], BLACK, (0, 0, -1))
body = body.make()

# ---------------------------------------------------------------- колесо: низкий профиль, белый диск в 20 спиц
K = R_W / 0.30
TW, RIM = 0.105, 0.215 * K
WHITE, DARK = ('wheel', '#f2f2ee'), ('wheel', '#1b1c1f')
wheel = Build('wheel'); wheel.sym = False
def revolve(prof, m, out, n=32):
    for j in range(n):
        a, b = 2 * math.pi * j / n, 2 * math.pi * (j + 1) / n
        for (x0, r0), (x1, r1) in zip(prof, prof[1:]):
            P = [(x0, r0 * math.cos(a), r0 * math.sin(a)), (x1, r1 * math.cos(a), r1 * math.sin(a)),
                 (x1, r1 * math.cos(b), r1 * math.sin(b)), (x0, r0 * math.cos(b), r0 * math.sin(b))]
            if r0 == 0: P = P[:3]
            if r1 == 0: P = [P[0], P[1], P[3]]
            wheel.face(P, m, out)
rad = lambda c: Vector((0, c.y, c.z)).normalized()
revolve([(-TW, RIM), (-TW, 0.262 * K), (-0.092, 0.291 * K), (-0.07, R_W), (0.07, R_W), (0.092, 0.291 * K), (TW, 0.262 * K), (TW, RIM + 0.003)],
        ('wheel', '#151618'), lambda c: Vector(c) - rad(c) * 0.25)
revolve([(TW, RIM + 0.003), (0.097, RIM - 0.004), (0.084, RIM - 0.01)], WHITE, lambda c: Vector((1, 0, 0)) - rad(c) * 0.4)
revolve([(0.084, RIM - 0.01), (0.0, RIM - 0.02)], ('wheel', '#c9cbcc'), lambda c: -rad(c))
revolve([(0.0, RIM - 0.02), (0.0, 0)], DARK, (1, 0, 0))
revolve([(-TW, RIM), (-TW, 0)], DARK, (-1, 0, 0))
revolve([(0.02, 0.058), (0.078, 0.058)], WHITE, rad, 16)
revolve([(0.078, 0.058), (0.085, 0.05), (0.085, 0.034)], WHITE, (1, 0, 0), 16)
revolve([(0.085, 0.034), (0.085, 0)], ('wheel', '#111214'), (1, 0, 0), 16)
for k in range(20):
    a = 2 * math.pi * k / 20; c, s_ = math.cos(a), math.sin(a)
    P = lambda x, r, t: (x, r * c - t * s_, r * s_ + t * c)
    r0, r1, t0, t1, x0, x1 = 0.052, RIM - 0.012, 0.0065, 0.011, 0.078, 0.062
    wheel.face([P(x0, r0, -t0), P(x0, r0, t0), P(x1, r1, t1), P(x1, r1, -t1)], WHITE, (1, 0, 0))
    for d in (-1, 1):
        wheel.face([P(x0, r0, d * t0), P(x1, r1, d * t1), P(0.015, r1, d * t1), P(0.03, r0, d * t0)], WHITE, (0, -s_ * d, c * d))
wheel = wheel.make()
WHEELS = {'r': R_W, 'front': ZF_W, 'rear': ZR_W, 'track': TRACK}
show = bpy.data.collections.new('preview'); bpy.context.scene.collection.children.link(show)  # колёса на местах — только для вида
for sx in (1, -1):
    for z in (ZF_W, ZR_W):
        c = bpy.data.objects.new('wheel-view', wheel.data); show.objects.link(c)
        c.location = G(sx * TRACK, R_W, z); c.scale.x = sx

# ---------------------------------------------------------------- выгрузка для tools/models/cv1.mjs
OUT = ROOT + '3d-models/cv1/'
os.makedirs(OUT, exist_ok=True)
for o in bpy.data.objects: o.select_set(o in (body, wheel))
bpy.ops.export_scene.gltf(filepath=OUT + 'cv1.gltf', export_format='GLTF_SEPARATE', use_selection=True, export_yup=True,
                          export_apply=False, export_normals=False, export_texcoords=False, export_animations=False)
json.dump({'wheels': WHEELS}, open(OUT + 'cv1.json', 'w'))
wheel.hide_set(True)
print('номера: перед', top.at(0, sA(0.43)), 'зад', top.at(0, sB(0.425)))
print('треугольников:', sum(len(p.vertices) - 2 for p in body.data.polygons))

# ---------------------------------------------------------------- вид
for o in bpy.data.objects:
    if o.type == 'MESH':
        m = o.modifiers.new('ns', 'EDGE_SPLIT'); m.split_angle = math.radians(30)
        for p in o.data.polygons: p.use_smooth = True
if bpy.context.screen:
    for a in bpy.context.screen.areas:
        if a.type == 'VIEW_3D':
            sh = a.spaces.active.shading
            sh.type = 'SOLID'; sh.color_type = 'MATERIAL'; sh.show_backface_culling = True; sh.light = 'STUDIO'
            a.spaces.active.overlay.show_overlays = False
