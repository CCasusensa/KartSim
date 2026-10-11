# 卡丁城 v3 — built in Blender (headless), exported as kartcity.glb +
# kartcity-design.json + kartcity.blend. Run through blender-city.mjs:
#
#   Blender -b --python kartcity.py -- --props DIR --tripo DIR --out DIR [--assets FILE]
#
# Design coordinates here are Blender's: x east, y north, z up, metres,
# origin at the plaza centre (the game's design z is -y; the importer maps
# glTF/Blender axes to the client's). Layout: a round plaza, six radial
# avenues, a ring expressway (the route) at r=620 and six themed sectors
# between them — 城市 N, 冰河 NE, 海滩 SE, 城镇 S, 沙漠 SW, 森林 NW — each with
# an arc street, a landmark, a tunnel or gate on the arc and props from the
# Tripo library (KartRider-style, low-poly). Materials carry custom
# properties the importer reads: kr_texture/kr_theme (official texture by
# name), kr_road (collision attributes as JSON), kr_alpha, kr_cull,
# kr_collider (invisible solid), kr_source (track folder of a texture).
import bpy
import json
import math
import os
import random
import sys

from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def opt(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


PROPS_DIR = opt("--props")
TRIPO_DIR = opt("--tripo")
OUT_DIR = opt("--out", ".")
ASSETS_FILE = opt("--assets", os.path.join(os.path.dirname(TRIPO_DIR or "."), "assets.json"))
EXTENT = 1200.0
PLAZA_R = 90.0
INNER_R = 125.0
ARC_R = 370.0
RING_R = 620.0
SECTORS = [  # centre angle (degrees, 0 = east, counter-clockwise), theme, names
    (90, "city", "摩天城区", "#9ca3af"),
    (30, "ice", "冰河乐园", "#bfdbfe"),
    (330, "beach", "阳光海滩", "#fde68a"),
    (270, "village", "城镇小屋", "#fecaca"),
    (210, "desert", "金字塔沙漠", "#fdba74"),
    (150, "forest", "森林公园", "#bbf7d0"),
]
R = random.Random(20261011)

# ---------------------------------------------------------------- textures per theme
TEX = {
    "ground": {"village": "tilegrass", "forest": "F_tilegrass03", "ice": "ice_glacial terrain_A", "desert": "sand", "beach": "bc_sand01_j", "city": "cement_12"},
    "street": {"village": "cement04", "forest": "F_road01", "ice": "ice_mr_road01", "desert": "de_road02", "beach": "bc_road05", "city": "cement_12"},
    "fence": {"village": "fence12", "forest": "F_fence01", "ice": "fence_A", "desert": "fence_woodB", "beach": "bc_fence_01", "city": "fence12"},
}
TEX_THEME = {}  # texture name → theme folder it lives in
for _kind, _map in TEX.items():
    for _theme, _name in _map.items():
        TEX_THEME.setdefault(_name, _theme)
TEX_THEME.update({"cement08": "village", "cement_17": "village", "cement_16": "village", "cement_15": "village", "bc_road04": "beach", "b_side": "village", "fence01": "village", "fence00": "village",
                  "F_water00": "forest", "bc_sea03": "beach", "cement_14": "village", "F_grass09": "forest", "tilegrass": "village"})
TILE = {"tilegrass": 12, "F_tilegrass03": 12, "ice_glacial terrain_A": 16, "sand": 16, "bc_sand01_j": 14, "cement_12": 10, "F_water00": 20, "bc_sea03": 24}

# ---------------------------------------------------------------- scene reset
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.unit_settings.scale_length = 1.0


def collection(name, parent=None, hide=False):
    col = bpy.data.collections.new(name)
    (parent or scene.collection).children.link(col)
    if hide:
        col.hide_viewport = True
        col.hide_render = True
    return col


COL = {name: collection(name) for name in ["ground", "roads", "plaza", "props", "colliders", "water", "markers"]}
LIBRARY = collection("library", hide=True)

# ---------------------------------------------------------------- materials
_images = {}
_texture_files = {}
if PROPS_DIR and os.path.exists(os.path.join(PROPS_DIR, "textures.json")):
    for entry in json.load(open(os.path.join(PROPS_DIR, "textures.json"))):
        _texture_files[entry["name"]] = os.path.join(PROPS_DIR, "textures", entry["stem"] + ".png")


def load_image(path):
    if path in _images:
        return _images[path]
    if not os.path.exists(path):
        _images[path] = None
        return None
    image = bpy.data.images.load(path)
    image.colorspace_settings.name = "sRGB"
    _images[path] = image
    return image


def new_material(name, image=None, props=None, alpha=None, viewport=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = 1.0
    bsdf.inputs["Specular IOR Level"].default_value = 0.0
    if image is not None:
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = image
        tex.location = (-400, 200)
        links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        if alpha:
            links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    if viewport is not None:
        mat.diffuse_color = viewport
    if alpha:
        mat.surface_render_method = "BLENDED" if alpha == "blend" else "DITHERED"
    for key, value in (props or {}).items():
        mat[key] = value
    return mat


_theme_materials = {}


def theme_material(texture, road=None, alpha=None, cull=None, theme=None, source=None):
    """A material that the importer resolves to the official texture `texture`."""
    theme = theme or TEX_THEME.get(texture, "village")
    key = (texture, json.dumps(road, sort_keys=True) if road is not None else "", alpha or "", cull if cull is not None else -1, source or "")
    if key in _theme_materials:
        return _theme_materials[key]
    image = load_image(_texture_files.get(texture, os.path.join(PROPS_DIR or ".", "textures", texture + ".png")))
    props = {"kr_texture": texture, "kr_theme": theme, "kr_road": json.dumps(road) if road is not None else "", "kr_alpha": alpha or "", "kr_cull": cull if cull is not None else -1}
    if source:
        props["kr_source"] = source
    mat = new_material(f"{texture}{'#road' if road is not None else ''}{'#' + alpha if alpha else ''}", image, props, alpha)
    _theme_materials[key] = mat
    return mat


COLLIDER_MAT = new_material("kr_collider", None, {"kr_collider": 1}, None, (1.0, 0.0, 1.0, 0.25))
COLLIDER_MAT.surface_render_method = "BLENDED"
COLLIDER_MAT.node_tree.nodes["Principled BSDF"].inputs["Alpha"].default_value = 0.25

# ---------------------------------------------------------------- mesh builder


class Builder:
    def __init__(self):
        self.verts = []
        self.faces = []
        self.uvs = []
        self.colors = []

    def face(self, points, uvs, color=None):
        base = len(self.verts)
        self.verts.extend(points)
        self.faces.append(tuple(range(base, base + len(points))))
        self.uvs.extend(uvs)
        self.colors.extend([color or (1.0, 1.0, 1.0, 1.0)] * len(points))

    def quad(self, a, b, c, d, uv=((0, 0), (1, 0), (1, 1), (0, 1)), color=None):
        self.face([a, b, c, d], list(uv), color)

    def tri(self, a, b, c, uv=((0, 0), (1, 0), (1, 1)), color=None):
        self.face([a, b, c], list(uv), color)

    def build(self, name, material, col, location=(0, 0, 0)):
        if not self.faces:
            return None
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata([Vector(v) for v in self.verts], [], self.faces)
        uv_layer = mesh.uv_layers.new(name="UVMap")
        for loop in mesh.loops:
            uv_layer.data[loop.index].uv = self.uvs[loop.vertex_index]
        if any(c != (1.0, 1.0, 1.0, 1.0) for c in self.colors):
            attr = mesh.color_attributes.new(name="Color", type="FLOAT_COLOR", domain="POINT")
            for i, c in enumerate(self.colors):
                attr.data[i].color = c
        mesh.validate()
        mesh.update()
        mesh.materials.append(material)
        obj = bpy.data.objects.new(name, mesh)
        obj.location = location
        col.objects.link(obj)
        return obj


def strip(builder, pts, width, closed=False, z=0.0, uv_len=None, uv_across=(0.0, 1.0), color=None):
    """A ribbon of quads along a polyline; uv u across the width, v along the length."""
    n = len(pts)
    count = n if closed else n - 1
    uv_len = uv_len or width
    # per-point left offsets from averaged tangents
    left = []
    s = [0.0]
    for i in range(1, n):
        s.append(s[-1] + math.dist(pts[i], pts[i - 1]))
    for i in range(n):
        prev = pts[i - 1] if (closed or i > 0) else pts[i]
        nxt = pts[(i + 1) % n] if (closed or i < n - 1) else pts[i]
        tx, ty = nxt[0] - prev[0], nxt[1] - prev[1]
        length = math.hypot(tx, ty) or 1.0
        left.append((-ty / length, tx / length))
    for i in range(count):
        j = (i + 1) % n
        a = (pts[i][0] + left[i][0] * width / 2, pts[i][1] + left[i][1] * width / 2, z)
        b = (pts[i][0] - left[i][0] * width / 2, pts[i][1] - left[i][1] * width / 2, z)
        c = (pts[j][0] - left[j][0] * width / 2, pts[j][1] - left[j][1] * width / 2, z)
        d = (pts[j][0] + left[j][0] * width / 2, pts[j][1] + left[j][1] * width / 2, z)
        v0, v1 = s[i] / uv_len, (s[j] if j > i else s[-1] + math.dist(pts[i], pts[j])) / uv_len
        builder.quad(a, b, c, d, ((uv_across[0], v0), (uv_across[1], v0), (uv_across[1], v1), (uv_across[0], v1)), color)
    return left


def wall(builder, pts, height, side_offset, closed=False, z=0.0, uv_len=None, skip=None, flip=False, color=None):
    """Vertical quads along a polyline offset to one side (positive = left of travel)."""
    n = len(pts)
    count = n if closed else n - 1
    uv_len = uv_len or height * 2
    left = []
    for i in range(n):
        prev = pts[i - 1] if (closed or i > 0) else pts[i]
        nxt = pts[(i + 1) % n] if (closed or i < n - 1) else pts[i]
        tx, ty = nxt[0] - prev[0], nxt[1] - prev[1]
        length = math.hypot(tx, ty) or 1.0
        left.append((-ty / length, tx / length))
    s = 0.0
    for i in range(count):
        j = (i + 1) % n
        a2 = (pts[i][0] + left[i][0] * side_offset, pts[i][1] + left[i][1] * side_offset)
        b2 = (pts[j][0] + left[j][0] * side_offset, pts[j][1] + left[j][1] * side_offset)
        seg = math.dist(a2, b2)
        if skip and (skip(a2) or skip(b2)):
            s += seg
            continue
        v0, v1 = s / uv_len, (s + seg) / uv_len
        quad = [(a2[0], a2[1], z), (b2[0], b2[1], z), (b2[0], b2[1], z + height), (a2[0], a2[1], z + height)]
        uv = [(v0, 1), (v1, 1), (v1, 0), (v0, 0)]
        if flip:
            quad.reverse()
            uv.reverse()
        builder.face(quad, uv, color)
        s += seg


def disc(builder, cx, cy, r, segments, z=0.0, tile=10.0, r0=0.0):
    for i in range(segments):
        a0, a1 = 2 * math.pi * i / segments, 2 * math.pi * (i + 1) / segments
        p = [(cx + r0 * math.cos(a0), cy + r0 * math.sin(a0), z), (cx + r * math.cos(a0), cy + r * math.sin(a0), z), (cx + r * math.cos(a1), cy + r * math.sin(a1), z), (cx + r0 * math.cos(a1), cy + r0 * math.sin(a1), z)]
        uv = [(q[0] / tile, q[1] / tile) for q in p]
        if r0 > 0:
            builder.face(p, uv)
        else:
            builder.face([p[0], p[1], p[2]], [uv[0], uv[1], uv[2]])


def wedge(builder, r0, r1, a0, a1, z=0.0, tile=12.0, steps=None):
    """A sector of an annulus between angles a0..a1 (degrees), split into tiles."""
    steps = steps or max(2, int((a1 - a0) / 6))
    rings = max(2, int((r1 - r0) / 60))
    for i in range(steps):
        b0 = math.radians(a0 + (a1 - a0) * i / steps)
        b1 = math.radians(a0 + (a1 - a0) * (i + 1) / steps)
        for k in range(rings):
            q0 = r0 + (r1 - r0) * k / rings
            q1 = r0 + (r1 - r0) * (k + 1) / rings
            p = [(q0 * math.cos(b0), q0 * math.sin(b0), z), (q1 * math.cos(b0), q1 * math.sin(b0), z), (q1 * math.cos(b1), q1 * math.sin(b1), z), (q0 * math.cos(b1), q0 * math.sin(b1), z)]
            builder.face(p, [(v[0] / tile, v[1] / tile) for v in p])


def grid_region(builder, x0, y0, x1, y1, cell, z=0.0, tile=12.0, inside=None):
    nx, ny = max(1, int((x1 - x0) / cell)), max(1, int((y1 - y0) / cell))
    for i in range(nx):
        for j in range(ny):
            ax, ay = x0 + (x1 - x0) * i / nx, y0 + (y1 - y0) * j / ny
            bx, by = x0 + (x1 - x0) * (i + 1) / nx, y0 + (y1 - y0) * (j + 1) / ny
            if inside and not inside((ax + bx) / 2, (ay + by) / 2):
                continue
            p = [(ax, ay, z), (bx, ay, z), (bx, by, z), (ax, by, z)]
            builder.face(p, [(v[0] / tile, v[1] / tile) for v in p])


def box_mesh(builder, w, d, h, z0=0.0):
    x, y = w / 2, d / 2
    c = [(-x, -y, z0), (x, -y, z0), (x, y, z0), (-x, y, z0), (-x, -y, z0 + h), (x, -y, z0 + h), (x, y, z0 + h), (-x, y, z0 + h)]
    uv = [(0, 0), (1, 0), (1, 1), (0, 1)]
    for f in [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]:
        builder.face([c[i] for i in f], uv)


def cylinder_mesh(builder, r, h, segments=16):
    for i in range(segments):
        a0, a1 = 2 * math.pi * i / segments, 2 * math.pi * (i + 1) / segments
        p0, p1 = (r * math.cos(a0), r * math.sin(a0)), (r * math.cos(a1), r * math.sin(a1))
        builder.face([(p0[0], p0[1], 0), (p1[0], p1[1], 0), (p1[0], p1[1], h), (p0[0], p0[1], h)], [(0, 0), (1, 0), (1, 1), (0, 1)])
    builder.face([(r * math.cos(2 * math.pi * i / segments), r * math.sin(2 * math.pi * i / segments), h) for i in range(segments)][::-1], [(0, 0)] * segments)


# ---------------------------------------------------------------- geometry helpers
def polar(r, deg):
    return (r * math.cos(math.radians(deg)), r * math.sin(math.radians(deg)))


def arc(r, a0, a1, step_deg=3.0):
    n = max(2, int(abs(a1 - a0) / step_deg))
    return [polar(r, a0 + (a1 - a0) * i / n) for i in range(n + 1)]


def line(p, q, step=10.0):
    n = max(1, int(math.dist(p, q) / step))
    return [(p[0] + (q[0] - p[0]) * i / n, p[1] + (q[1] - p[1]) * i / n) for i in range(n + 1)]


def circle(r, step_deg=3.0):
    return [polar(r, i * step_deg) for i in range(int(360 / step_deg))]


def dist_to_polyline(p, pts, closed=False):
    best = 1e9
    n = len(pts)
    for i in range(n if closed else n - 1):
        a, b = pts[i], pts[(i + 1) % n]
        abx, aby = b[0] - a[0], b[1] - a[1]
        t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / (abx * abx + aby * aby or 1)
        t = max(0.0, min(1.0, t))
        best = min(best, math.dist(p, (a[0] + abx * t, a[1] + aby * t)))
    return best


# ---------------------------------------------------------------- road network (design)
ROADS = []  # dicts: id, name, type, theme, points, closed, width, texture, route


def road(id, name, type_, points, width, texture, theme="village", closed=False, route=False, z=0.04):
    r = {"id": id, "name": name, "type": type_, "points": points, "width": width, "texture": texture, "theme": theme, "closed": closed, "route": route, "z": z}
    ROADS.append(r)
    return r


ROAD_TYPES = {
    "expressway": {"label": "环城高速", "width": 16, "lanes": 4, "speed": "最高速", "color": "#4b5563"},
    "avenue": {"label": "放射大道", "width": 14, "lanes": 4, "speed": "高速", "color": "#6b7280"},
    "street": {"label": "街区道路", "type": "street", "width": 10, "lanes": 2, "speed": "中速", "color": "#9ca3af"},
}

road("ring", "环城高速", "expressway", circle(RING_R, 2.0), 16, "bc_road04", "beach", closed=True, route=True, z=0.05)
AVENUE_ANGLES = [0, 60, 120, 180, 240, 300]
AVENUE_NAMES = {0: "东大道", 60: "东北大道", 120: "西北大道", 180: "西大道", 240: "西南大道", 300: "东南大道"}
for deg in AVENUE_ANGLES:
    road(f"ave-{deg}", AVENUE_NAMES[deg], "avenue", line(polar(PLAZA_R - 6, deg), polar(RING_R, deg), 8.0), 14, "cement08", "village", z=0.045)
for deg, theme, name, color in SECTORS:
    a0, a1 = deg - 30, deg + 30
    road(f"arc-{theme}", f"{name}环街", "street", arc(ARC_R, a0, a1, 2.0), 10, TEX["street"][theme], theme)
    # spur from the arc inward to the landmark forecourt
    road(f"spur-{theme}", f"{name}路", "street", line(polar(ARC_R, deg), polar(INNER_R + 110, deg), 8.0), 10, TEX["street"][theme], theme)

# openings: road ends and crossings (kerbs/fences leave gaps there)
_openings = []
for r in ROADS:
    if not r["closed"]:
        _openings.append((r["points"][0], 14))
        _openings.append((r["points"][-1], 14))


def _seg_intersections(a, b):
    out = []
    pa, pb = a["points"], b["points"]
    na, nb = len(pa) if a["closed"] else len(pa) - 1, len(pb) if b["closed"] else len(pb) - 1
    for i in range(na):
        p, q = pa[i], pa[(i + 1) % len(pa)]
        for j in range(nb):
            r_, s_ = pb[j], pb[(j + 1) % len(pb)]
            d1 = (q[0] - p[0], q[1] - p[1])
            d2 = (s_[0] - r_[0], s_[1] - r_[1])
            den = d1[0] * d2[1] - d1[1] * d2[0]
            if abs(den) < 1e-9:
                continue
            t = ((r_[0] - p[0]) * d2[1] - (r_[1] - p[1]) * d2[0]) / den
            u = ((r_[0] - p[0]) * d1[1] - (r_[1] - p[1]) * d1[0]) / den
            if 0 <= t <= 1 and 0 <= u <= 1:
                out.append((p[0] + d1[0] * t, p[1] + d1[1] * t))
    return out


for i in range(len(ROADS)):
    for j in range(i + 1, len(ROADS)):
        for pt in _seg_intersections(ROADS[i], ROADS[j]):
            _openings.append((pt, (ROADS[i]["width"] + ROADS[j]["width"]) / 2 + 10))


def near_opening(p):
    return any(math.dist(p, o) < rad for o, rad in _openings)


def road_clear(p, margin=4.0):
    """True when p is at least `margin` m from every road edge."""
    for r in ROADS:
        if dist_to_polyline(p, r["points"], r["closed"]) < r["width"] / 2 + margin:
            return False
    return True


# ---------------------------------------------------------------- ground
def build_ground():
    # Plaza disc, inner ring (village grass), six themed wedges, outer grass to the map edge.
    b = Builder()
    disc(b, 0, 0, INNER_R, 48, z=0.0, tile=TILE["tilegrass"])
    b.build("ground_centre", theme_material("tilegrass", road={"surface": "dirt"}), COL["ground"])
    for deg, theme, name, color in SECTORS:
        b = Builder()
        tex = TEX["ground"][theme]
        wedge(b, INNER_R, RING_R + 12, deg - 30, deg + 30, z=0.0, tile=TILE.get(tex, 12))
        b.build(f"ground_{theme}", theme_material(tex, road={"surface": "dirt"}), COL["ground"])
    # outer: square minus the circle r = RING_R+12, in 4 quadrant meshes of cells
    for qx, qy in [(-1, -1), (1, -1), (-1, 1), (1, 1)]:
        b = Builder()
        grid_region(b, 0 if qx > 0 else -EXTENT, 0 if qy > 0 else -EXTENT, EXTENT if qx > 0 else 0, EXTENT if qy > 0 else 0, 60,
                    z=0.0, tile=TILE["tilegrass"], inside=lambda x, y: math.hypot(x, y) > RING_R - 40)
        # fill the ring band between the circle and the cells with a wedge (slight overlap under the ring road)
        b.build(f"ground_outer_{qx}_{qy}", theme_material("tilegrass", road={"surface": "dirt"}), COL["ground"])
    b = Builder()
    wedge(b, RING_R + 11, RING_R + 90, 0, 360, z=0.0, tile=TILE["tilegrass"], steps=72)
    b.build("ground_outer_band", theme_material("tilegrass", road={"surface": "dirt"}), COL["ground"])


def build_roads():
    for r in ROADS:
        b = Builder()
        strip(b, r["points"], r["width"], closed=r["closed"], z=r["z"], uv_len=r["width"] * 2)
        b.build(f"road_{r['id']}", theme_material(r["texture"], road={}), COL["roads"])
        # kerbs on both sides (village style), skipped at openings
        k = Builder()
        for side in (1, -1):
            wall(k, r["points"], 0.3, side * r["width"] / 2, closed=r["closed"], z=0.0, uv_len=1.0, skip=near_opening, flip=(side < 0))
        k.build(f"kerb_{r['id']}", theme_material("b_side", road={}), COL["roads"])
        if r["type"] in ("expressway", "avenue"):
            f = Builder()
            for side in (1, -1):
                wall(f, r["points"], 1.1, side * (r["width"] / 2 + 1.2), closed=r["closed"], z=0.0, uv_len=4.0, skip=near_opening, flip=(side < 0))
            f.build(f"fence_{r['id']}", theme_material("fence12", road={}, cull=1), COL["roads"])
    # junction pads: discs slightly above the roads where roads cross
    b = Builder()
    for o, rad in _openings:
        if rad > 14:
            disc(b, o[0], o[1], rad - 8, 24, z=0.06, tile=8)
    b.build("junction_pads", theme_material("cement08", road={}), COL["roads"])
    # boundary fence around the map
    b = Builder()
    e = EXTENT - 8
    wall(b, [(-e, -e), (e, -e), (e, e), (-e, e)], 2.0, 0.0, closed=True, z=0.0, uv_len=6.0)
    b.build("boundary_fence", theme_material("fence01", road={}, cull=1, alpha="test"), COL["roads"])


def build_plaza():
    b = Builder()
    disc(b, 0, 0, PLAZA_R, 48, z=0.05, tile=8)
    b.build("plaza_floor", theme_material("cement_16", road={}), COL["plaza"])
    # a decorative ring band
    b = Builder()
    disc(b, 0, 0, PLAZA_R + 4, 48, z=0.03, tile=6, r0=PLAZA_R - 2)
    b.build("plaza_rim", theme_material("cement_15", road={}), COL["plaza"])


def build_water():
    # a lake in the forest and a lagoon on the beach
    b = Builder()
    for (deg, theme, name, color) in SECTORS:
        if theme not in ("forest", "beach"):
            continue
        cx, cy = polar(500, deg + (14 if theme == "forest" else -14))
        rad = 70 if theme == "forest" else 85
        tex = "F_water00" if theme == "forest" else "bc_sea03"
        bb = Builder()
        disc(bb, cx, cy, rad, 36, z=0.02, tile=TILE[tex])
        bb.build(f"water_{theme}", theme_material(tex, alpha="blend"), COL["water"])
    return b


# ---------------------------------------------------------------- props (Tripo library)
ASSETS = {}
if ASSETS_FILE and os.path.exists(ASSETS_FILE):
    for a in json.load(open(ASSETS_FILE)):
        ASSETS[a["id"]] = a
_templates = {}
_collider_meshes = {}
PLACED = []


def _import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def template(asset_id):
    """The library object of an asset (imported once, scaled, re-anchored, decimated, textures shrunk)."""
    if asset_id in _templates:
        return _templates[asset_id]
    asset = ASSETS.get(asset_id)
    path = os.path.join(TRIPO_DIR or "", f"{asset_id}.glb")
    obj = None
    if asset and os.path.exists(path):
        objects = _import_glb(path)
        meshes = [o for o in objects if o.type == "MESH"]
        if meshes:
            bpy.ops.object.select_all(action="DESELECT")
            for o in meshes:
                o.select_set(True)
            bpy.context.view_layer.objects.active = meshes[0]
            if len(meshes) > 1:
                bpy.ops.object.join()
            obj = bpy.context.view_layer.objects.active
            bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
            for o in objects:
                if o is not obj and o.name in bpy.data.objects:
                    bpy.data.objects.remove(o, do_unlink=True)
            # scale to the designed size (uniform, fits inside the box) and anchor at the footprint centre, z=0
            xs = [v.co.x for v in obj.data.vertices]
            ys = [v.co.y for v in obj.data.vertices]
            zs = [v.co.z for v in obj.data.vertices]
            size = (max(xs) - min(xs) or 1, max(ys) - min(ys) or 1, max(zs) - min(zs) or 1)
            target = asset["size"]
            if asset.get("fit") == "stretch":
                sx, sy, sz = target[0] / size[0], target[1] / size[1], target[2] / size[2]
            else:
                sx = sy = sz = min(target[0] / size[0], target[1] / size[1], target[2] / size[2])
            cx, cy, z0 = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2, min(zs)
            for v in obj.data.vertices:
                v.co = ((v.co.x - cx) * sx, (v.co.y - cy) * sy, (v.co.z - z0) * sz)
            if asset.get("sink") or asset.get("collider") == "mesh":
                # a structure the road runs through: sink it so the inside floor sits just under the road
                w, d, h = target
                inner = [v.co.z for v in obj.data.vertices if abs(v.co.x) < w * 0.3 and abs(v.co.y) < d * 0.3 and v.co.z < h * 0.35]
                floor_top = (max(inner) if inner else 0.0) + 0.15
                obj["kr_floor"] = floor_top
                for v in obj.data.vertices:
                    v.co.z -= floor_top
            # decimate above the budget
            if len(obj.data.polygons) > asset["faces"] * 1.3:
                mod = obj.modifiers.new("decimate", "DECIMATE")
                mod.ratio = asset["faces"] / len(obj.data.polygons)
                bpy.ops.object.modifier_apply(modifier=mod.name)
            # textures to 512 px, materials marked for the importer
            for slot in obj.material_slots:
                mat = slot.material
                if not mat:
                    continue
                mat["kr_tripo"] = asset_id
                if asset.get("collider") == "mesh":
                    mat["kr_road"] = "{}"
                if mat.use_nodes:
                    for node in mat.node_tree.nodes:
                        if node.type == "TEX_IMAGE" and node.image and max(node.image.size) > 512:
                            node.image.scale(512, 512)
            obj.name = f"lib_{asset_id}"
            obj.data.name = f"lib_{asset_id}"
    if obj is None:
        # placeholder box when the asset has not been generated yet
        size = asset["size"] if asset else [6, 6, 6]
        b = Builder()
        box_mesh(b, size[0], size[1], size[2])
        obj = b.build(f"lib_{asset_id}", theme_material("cement_14", road=None), LIBRARY)
        obj["kr_placeholder"] = 1
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    LIBRARY.objects.link(obj)
    obj.hide_render = True
    _templates[asset_id] = obj
    return obj


def collider_mesh(asset_id):
    if asset_id in _collider_meshes:
        return _collider_meshes[asset_id]
    asset = ASSETS.get(asset_id, {"size": [6, 6, 6], "collider": "box"})
    kind = asset.get("collider", "box")
    tmpl = template(asset_id)
    xs = [v.co.x for v in tmpl.data.vertices]
    ys = [v.co.y for v in tmpl.data.vertices]
    zs = [v.co.z for v in tmpl.data.vertices]
    w, d, h = (max(xs) - min(xs)), (max(ys) - min(ys)), (max(zs) - min(zs))
    b = Builder()
    if kind == "box":
        box_mesh(b, w * 0.92, d * 0.92, h)
    elif kind == "cylinder":
        cylinder_mesh(b, max(w, d) / 2 * 0.9, h, 16)
    elif kind == "post":
        box_mesh(b, min(1.4, w), min(1.4, d), h)
    else:
        _collider_meshes[asset_id] = None
        return None
    mesh = bpy.data.meshes.new(f"col_{asset_id}")
    mesh.from_pydata([Vector(v) for v in b.verts], [], b.faces)
    mesh.validate()
    mesh.update()
    mesh.materials.append(COLLIDER_MAT)
    _collider_meshes[asset_id] = mesh
    return mesh


def place(asset_id, x, y, yaw=0.0, col=None, z=0.0, scale=1.0, record=True):
    tmpl = template(asset_id)
    obj = tmpl.copy()
    obj.name = f"{asset_id}.{len(PLACED):04d}"
    obj.location = (x, y, z)
    obj.rotation_euler = (0, 0, math.radians(yaw))
    obj.scale = (scale, scale, scale)
    obj.hide_render = False
    (col or COL["props"]).objects.link(obj)
    cm = collider_mesh(asset_id)
    if cm is not None:
        c = bpy.data.objects.new(f"col_{obj.name}", cm)
        c.location = (x, y, z)
        c.rotation_euler = (0, 0, math.radians(yaw))
        c.scale = (scale, scale, scale)
        c.display_type = "WIRE"
        COL["colliders"].objects.link(c)
    if record:
        PLACED.append((asset_id, x, y))
    return obj


def footprint_radius(asset_id):
    a = ASSETS.get(asset_id)
    return max(a["size"][0], a["size"][1]) / 2 if a else 4


def free_spot(x, y, radius, margin=2.0):
    if not road_clear((x, y), margin + radius):
        return False
    for aid, px, py in PLACED:
        if math.dist((x, y), (px, py)) < radius + footprint_radius(aid) + margin:
            return False
    return True


def along(pts, spacing, closed=False, start=0.0):
    """Points every `spacing` m along a polyline with the tangent angle (degrees)."""
    out = []
    n = len(pts)
    count = n if closed else n - 1
    s_next = start
    s = 0.0
    for i in range(count):
        a, b = pts[i], pts[(i + 1) % n]
        seg = math.dist(a, b)
        while s_next <= s + seg and seg > 0:
            t = (s_next - s) / seg
            out.append(((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t), math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))))
            s_next += spacing
        s += seg
    return out


def line_props(pts, ids, spacing, offset, closed=False, start=0.0, face_road=True, col=None, scale=1.0):
    """Props along a road: `offset` m to the left (+) or right (-) of travel, facing the road."""
    placed = 0
    for (p, ang), k in zip(along(pts, spacing, closed, start), range(10000)):
        lx, ly = -math.sin(math.radians(ang)), math.cos(math.radians(ang))
        x, y = p[0] + lx * offset, p[1] + ly * offset
        aid = ids[k % len(ids)] if isinstance(ids, list) else ids
        yaw = ang + (90 if offset < 0 else -90) if face_road else ang
        if math.hypot(x, y) > EXTENT - 30 or not free_spot(x, y, footprint_radius(aid), 1.0):
            continue
        place(aid, x, y, yaw, col, scale=scale)
        placed += 1
    return placed


def scatter(ids, count, inside, tries=60, col=None, scale_range=(0.9, 1.1), margin=3.0):
    placed = 0
    for _ in range(count):
        for _t in range(tries):
            x, y = R.uniform(-EXTENT, EXTENT), R.uniform(-EXTENT, EXTENT)
            if not inside(x, y):
                continue
            aid = R.choice(ids)
            if free_spot(x, y, footprint_radius(aid), margin):
                place(aid, x, y, R.uniform(0, 360), col, scale=R.uniform(*scale_range))
                placed += 1
                break
    return placed


def in_sector(deg, r0, r1):
    def f(x, y):
        r = math.hypot(x, y)
        a = (math.degrees(math.atan2(y, x)) - deg + 180) % 360 - 180
        return r0 < r < r1 and abs(a) < 28
    return f


def sector_roads(theme):
    return [r for r in ROADS if r["id"] in (f"arc-{theme}", f"spur-{theme}")]


# ---------------------------------------------------------------- the city
def build_city():
    build_ground()
    build_roads()
    build_plaza()
    build_water()
    # --- plaza: fountain, lamps, benches, flower beds, gates on the avenues
    place("v_fountain", 0, 0, 0, COL["plaza"])
    for i in range(12):
        a = 15 + i * 30
        x, y = polar(PLAZA_R - 14, a)
        place("v_lamp" if i % 2 == 0 else "v_flowerbed", x, y, a + 90, COL["plaza"])
        if i % 2 == 1:
            bx, by = polar(PLAZA_R - 26, a)
            place("v_bench", bx, by, a + 180, COL["plaza"])
    for deg in AVENUE_ANGLES:
        gx, gy = polar(PLAZA_R + 26, deg)
        place("v_gate", gx, gy, deg + 90, COL["plaza"])
    # --- avenues: lamps and street trees in the inner band (village look)
    for deg in AVENUE_ANGLES:
        pts = line(polar(PLAZA_R + 50, deg), polar(ARC_R - 40, deg), 8.0)
        line_props(pts, "v_lamp", 45, 10.5, start=5)
        line_props(pts, "v_lamp", 45, -10.5, start=27)
        line_props(pts, ["v_tree", "v_tree_pink"], 38, 15.0, start=12, face_road=False)
        line_props(pts, ["v_tree_pink", "v_tree"], 38, -15.0, start=30, face_road=False)
    # --- sectors
    for deg, theme, name, color in SECTORS:
        arc_road = next(r for r in ROADS if r["id"] == f"arc-{theme}")
        spur = next(r for r in ROADS if r["id"] == f"spur-{theme}")
        lx, ly = polar(INNER_R + 70, deg)   # landmark at the inner end of the spur
        inside_sector = in_sector(deg, INNER_R + 10, RING_R - 14)
        if theme == "village":
            line_props(arc_road["points"], ["v_house_a", "v_house_b", "v_house_c", "v_shop", "v_house_d", "v_cafe"], 22, 14.5)
            line_props(arc_road["points"], ["v_house_c", "v_house_a", "v_house_d", "v_house_b"], 24, -14.5, start=11)
            line_props(spur["points"], ["v_house_b", "v_house_a"], 24, 13.5, start=20)
            line_props(spur["points"], ["v_house_c", "v_shop"], 24, -13.5, start=32)
            line_props(arc_road["points"], "v_lamp", 44, 7.0, start=3)
            line_props(arc_road["points"], "v_busstop", 160, -7.0, start=60)
            place("v_windmill", lx, ly, deg + 180)
            scatter(["v_tree", "v_tree_pink", "v_flowerbed", "v_mailbox"], 40, inside_sector)
        elif theme == "city":
            line_props(arc_road["points"], ["c_tower_a", "c_tower_b", "c_tower_c", "c_tower_d"], 34, 22.0)
            line_props(arc_road["points"], ["c_tower_d", "c_tower_b", "c_tower_a", "c_tower_c"], 34, -22.0, start=17)
            line_props(spur["points"], ["c_tower_b", "c_tower_c"], 36, 20.0, start=18)
            line_props(spur["points"], ["c_tower_d", "c_tower_a"], 36, -20.0, start=36)
            line_props(arc_road["points"], "c_tree", 26, 7.5, start=5)
            line_props(arc_road["points"], "c_tree", 26, -7.5, start=18)
            line_props(arc_road["points"], "c_bench_bus", 150, -8.0, start=70)
            line_props(arc_road["points"], "c_billboard", 180, 10.0, start=100)
            place("c_mall", lx, ly, deg + 180)
            sx, sy = polar(ARC_R + 70, deg + 20)
            place("c_station", sx, sy, deg + 20 + 180)
            gx, gy = polar(ARC_R + 70, deg - 20)
            place("c_gasstation", gx, gy, deg - 20 + 180)
            scatter(["c_tree"], 20, inside_sector)
        elif theme == "forest":
            line_props(arc_road["points"], ["f_pine_a", "f_pine_b", "f_oak"], 16, 10.0, face_road=False)
            line_props(arc_road["points"], ["f_pine_b", "f_pine_a"], 16, -10.0, start=8, face_road=False)
            line_props(spur["points"], ["f_cabin"], 48, 16.0, start=14)
            line_props(spur["points"], ["f_mushroom", "f_rock"], 30, -13.0, start=10)
            place("f_tower", lx, ly, deg + 180)
            scatter(["f_pine_a", "f_pine_b", "f_oak", "f_mushroom", "f_rock", "f_stump", "f_totem", "f_cabin"], 90, inside_sector, margin=2.0)
        elif theme == "ice":
            line_props(arc_road["points"], ["i_igloo", "i_pine", "i_lodge", "i_snowman", "i_pine"], 20, 12.0)
            line_props(arc_road["points"], ["i_pine", "i_crystal", "i_pine", "i_penguin"], 18, -11.0, start=9)
            line_props(spur["points"], ["i_lodge", "i_igloo"], 40, 14.0, start=12)
            line_props(spur["points"], ["i_pine", "i_iceblock"], 22, -12.0, start=8)
            place("i_castle", lx, ly, deg + 180)
            scatter(["i_pine", "i_crystal", "i_snowman", "i_iceblock", "i_igloo", "i_penguin"], 70, inside_sector)
        elif theme == "desert":
            line_props(arc_road["points"], ["d_house", "d_palm", "d_market", "d_cactus_a", "d_house"], 22, 12.0)
            line_props(arc_road["points"], ["d_palm", "d_cactus_a", "d_obelisk", "d_cactus_b"], 18, -10.5, start=9)
            line_props(spur["points"], ["d_house", "d_market"], 30, 13.0, start=12)
            line_props(spur["points"], ["d_palm", "d_cactus_a"], 24, -11.0, start=6)
            place("d_pyramid", lx, ly, deg + 180)
            sx, sy = polar(INNER_R + 70, deg + 16)
            place("d_sphinx", sx, sy, deg + 16 + 180)
            scatter(["d_cactus_a", "d_cactus_b", "d_palm", "d_rock", "d_obelisk", "d_house"], 70, inside_sector)
        elif theme == "beach":
            line_props(arc_road["points"], ["b_hut", "b_palm", "b_surfshop", "b_palm", "b_lifeguard"], 22, 12.0)
            line_props(arc_road["points"], ["b_palm", "b_umbrella", "b_palm", "b_boat"], 18, -10.5, start=9)
            line_props(spur["points"], ["b_hut", "b_palm"], 26, 12.0, start=10)
            line_props(spur["points"], ["b_umbrella", "b_palm"], 20, -11.0, start=5)
            place("b_lighthouse", lx, ly, deg + 180)
            scatter(["b_palm", "b_umbrella", "b_rock", "b_boat", "b_hut"], 60, inside_sector)
        # tunnel on the arc at the sector centre (hollow Tripo structure; the road runs through)
        tunnel = {"city": "c_tunnel", "forest": "f_tunnel", "ice": "i_tunnel", "desert": "d_tunnel"}.get(theme)
        if tunnel:
            tx, ty = polar(ARC_R, deg)
            place(tunnel, tx, ty, deg + 90, record=False)   # its long axis along the arc tangent
    # --- outskirts: official billboard trees and hills beyond the ring (cheap, far away)
    outside = lambda x, y: RING_R + 40 < math.hypot(x, y) and abs(x) < EXTENT - 40 and abs(y) < EXTENT - 40
    scatter(["v_tree", "v_tree_pink", "f_pine_a", "f_oak"], 160, outside, margin=6.0, scale_range=(1.0, 1.4))


build_city()

# ---------------------------------------------------------------- design json (game data)
def to_design(p):
    return [round(p[0], 1), round(-p[1], 1)]


SPAWNS = [{"id": "spawn-main", "name": "广场出生点", "kind": "spawn", "at": to_design(polar(PLAZA_R + 60, 300)), "heading": 330, "desc": "进城默认出生点：东南大道上（城镇小屋与阳光海滩之间），面向广场。"}]
for deg, theme, name, color in SECTORS:
    p = polar(ARC_R, deg - 26)
    # heading: design degrees clockwise from north; travel direction along the arc (counter-clockwise = increasing angle)
    tangent = deg - 26 + 90
    heading = (90 - tangent) % 360
    SPAWNS.append({"id": f"spawn-{theme}", "name": f"{name}出生点", "kind": "spawn", "at": to_design(p), "heading": round(heading), "desc": f"{name}环街起点。", "generated": True})

POIS = [
    {"id": "fountain", "name": "广场喷泉", "kind": "social", "at": [0, 0], "desc": "聊天气泡最密集的地方；全城频道的象征。"},
    *SPAWNS,
    {"id": "portals", "name": "传送门（预留）", "kind": "function", "at": to_design(polar(PLAZA_R + 40, 90)), "desc": "竞速 / 道具 / 计时 / 乱斗四座传送门。"},
    {"id": "garage", "name": "车库（预留）", "kind": "function", "at": to_design(polar(PLAZA_R + 40, 150)), "desc": "开进车库门 = 打开车库界面。"},
    {"id": "shop", "name": "商城（预留）", "kind": "function", "at": to_design(polar(PLAZA_R + 40, 30)), "desc": "开进商城 = 打开商店。"},
    {"id": "club", "name": "俱乐部会馆（预留）", "kind": "function", "at": to_design(polar(PLAZA_R + 40, 210)), "desc": "俱乐部界面的实体空间。"},
    {"id": "quest-npc", "name": "每日任务 NPC（预留）", "kind": "function", "at": to_design(polar(PLAZA_R + 40, 330)), "desc": "靠近弹出任务窗口。"},
]
for i, p in enumerate(POIS):
    p["n"] = i + 1


def sector_polygon(deg):
    # inner corner → outer arc (a0 → a1) → inner arc back (a1 → a0): a simple ring sector, no bow-tie
    pts = arc(RING_R, deg - 30, deg + 30, 6.0) + arc(INNER_R, deg + 30, deg - 30, 10.0)
    return [to_design(p) for p in pts]


DISTRICTS = [{"id": "plaza", "name": "中央广场", "theme": "village", "color": "#fde68a", "polygon": [to_design(p) for p in circle(INNER_R, 10.0)], "desc": "喷泉广场，六条大道在这里汇合。"}]
for deg, theme, name, color in SECTORS:
    DISTRICTS.append({"id": theme, "name": name, "theme": theme, "color": color, "polygon": sector_polygon(deg), "desc": f"{name}：跑跑卡丁车{name}风格的城区。"})


def road_length(pts, closed):
    n = len(pts)
    return round(sum(math.dist(pts[i], pts[(i + 1) % n]) for i in range(n if closed else n - 1)))


DESIGN = {
    "meta": {"name": "卡丁城", "version": 3, "extent": [[-EXTENT, -EXTENT], [EXTENT, EXTENT]], "units": "world meters", "origin": "广场中心", "axes": "x 东, z 南, y 上", "builder": "blender/kartcity.py", "cameraFar": 1000},
    "roadTypes": ROAD_TYPES,
    "roads": [{"id": r["id"], "name": r["name"], "type": r["type"], "theme": r["theme"], "closed": r["closed"], "route": r["route"], "points": [to_design(p) for p in r["points"]], "lengthM": road_length(r["points"], r["closed"])} for r in ROADS],
    "districts": DISTRICTS,
    "pois": POIS,
    "boostPads": [],
    "coins": [],
    "rules": {"instancePlayers": 60, "interestRadius": 160, "chatBubbleRadius": 60, "chatBubbleSeconds": 6, "districtChannel": True, "cityChannel": True, "afkMinutes": 10, "resetToRoad": True, "dayNightMinutes": 48},
}
os.makedirs(OUT_DIR, exist_ok=True)
with open(os.path.join(OUT_DIR, "kartcity-design.json"), "w") as f:
    json.dump(DESIGN, f, ensure_ascii=False, indent=2)
    f.write("\n")

# ---------------------------------------------------------------- export
placeholders = sum(1 for o in bpy.data.objects if o.get("kr_placeholder") and o.name.startswith("lib_"))
print(f"kartcity: {len(ROADS)} roads, {len(PLACED)} props, {len(_templates)} templates ({placeholders} placeholders), {len(bpy.data.objects)} objects")
bpy.ops.object.select_all(action="DESELECT")
bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT_DIR, "kartcity.glb"), export_format="GLB", export_extras=True, export_apply=True, export_yup=True,
    export_image_format="AUTO", export_materials="EXPORT", export_normals=True, export_texcoords=True,
    export_vertex_color="ACTIVE", use_visible=True, export_animations=False, export_skins=False, export_morph=False,
    export_lights=False, export_cameras=False,
)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_DIR, "kartcity.blend"))
print("kartcity: exported kartcity.glb, kartcity-design.json, kartcity.blend")
