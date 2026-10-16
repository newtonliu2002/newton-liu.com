#!/usr/bin/env python3
"""Build data/birdmap.json, the About essay's 图2: Newton's eBird life list on
a map, the world by country and the United States, Canada, Mexico and China
by state/province.

    python3 -I tools/birdmap.py

The counts are typed in below from his eBird profile (My eBird → Profile,
"Species by country" and each country's "Species by state/province"); his
profile is not public, so nothing here fetches them. When they change, edit
COUNTS and run this again. To let another country open into its states, add
it to DRILL and COUNTS and name its Natural Earth file in PROVINCES.

The outlines are Natural Earth (public domain): world-atlas's 50m countries,
us-atlas's Albers USA states (Alaska and Hawaii inset, like eBird's), and
Natural Earth's admin-1 provinces. They are downloaded once into _arrange/
geo-src/ (git-ignored; the 10m provinces are 40 MB), projected, simplified
to about a third of a pixel and written as SVG paths. The page's data-src
stamp is refreshed in about.html so the new file is fetched.
"""
import hashlib, json, math, os, re, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "_arrange", "geo-src")
OUT = os.path.join(ROOT, "data", "birdmap.json")
SOURCES = {
    "countries-50m.json": "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json",
    "states-albers-10m.json": "https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/states-albers-10m.json",
    "adm1-50m.geojson": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces.geojson",
    "adm1-10m.geojson": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson",
}

TOTAL = 1373   # his world life list (not the sum of the countries)
COUNTS = {     # 2026-10-16
  "world": {"124": ("Canada", 91), "840": ("United States", 435), "504": ("Morocco", 91),
            "484": ("Mexico", 150), "156": ("China", 260), "392": ("Japan", 1),
            "144": ("Sri Lanka", 176), "218": ("Ecuador", 152), "458": ("Malaysia", 117),
            "604": ("Peru", 114), "170": ("Colombia", 93), "630": ("Puerto Rico", 84),
            "554": ("New Zealand", 39), "850": ("Virgin Islands (U.S.)", 19),
            "702": ("Singapore", 16), "044": ("Bahamas", 3), "116": ("Cambodia", 1)},
  "US": {"Alaska": 124, "Texas": 130, "Colorado": 56, "New Mexico": 64, "Florida": 96,
         "Idaho": 12, "North Carolina": 12, "Virginia": 32, "New York": 5, "Montana": 8,
         "District of Columbia": 3, "Louisiana": 2, "Massachusetts": 77, "Utah": 19,
         "Alabama": 1, "California": 130, "Arizona": 106, "Maine": 34, "Hawaii": 28,
         "New Jersey": 24, "Wyoming": 20, "Nebraska": 19, "Washington": 10,
         "New Hampshire": 6, "Oregon": 2},
  "CA": {"Quebec": 62, "Alberta": 19, "Yukon": 23, "British Columbia": 15},
  "MX": {"Nuevo León": 80, "Yucatán": 87},
  "CN": {"Guangdong": 47, "Shanghai": 3, "Zhejiang": 1, "Yunnan": 106, "Sichuan": 67,
         "Qinghai": 65, "Guangxi": 25, "Hebei": 7, "Ningxia": 4, "Hainan": 3, "Jiangxi": 1},
}
DRILL = {"840": "US", "124": "CA", "484": "MX", "156": "CN"}
NAMES = {"world": "World", "US": "United States", "CA": "Canada", "MX": "Mexico", "CN": "China"}
# What a country opens into, for the hint under its count.
PARTS = {"US": "states", "CA": "provinces and territories", "MX": "states", "CN": "provinces"}
# Country: (Natural Earth file, its adm0_a3, name field, Albers lon0, lat1, lat2)
PROVINCES = {
    "CA": ("adm1-50m.geojson", "CAN", "name_en", -96, 49, 77),
    "MX": ("adm1-10m.geojson", "MEX", "name", -102, 17.5, 29.5),
    "CN": ("adm1-50m.geojson", "CHN", "name_en", 105, 25, 47),
}
EBIRD_NAME = {"Yukon": "Yukon Territory"}   # where eBird's name differs
TOL = 0.35          # simplification, in output pixels
MIN_AREA = 0.6      # rings smaller than this (px²) are dropped
DOT_AREA = 14       # a counted shape smaller than this also gets a dot


def fetch():
    os.makedirs(SRC, exist_ok=True)
    for name, url in SOURCES.items():
        p = os.path.join(SRC, name)
        if not os.path.exists(p):
            print("downloading", name)
            urllib.request.urlretrieve(url, p)


# ---- projections -------------------------------------------------------
def natural_earth(lon, lat):
    l, p = math.radians(lon), math.radians(lat)
    p2 = p * p; p4 = p2 * p2
    x = l * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4)))
    y = p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4)))
    return x, -y

def albers(lon0, lat1, lat2):
    f1, f2 = math.radians(lat1), math.radians(lat2)
    n = (math.sin(f1) + math.sin(f2)) / 2
    C = math.cos(f1) ** 2 + 2 * n * math.sin(f1)
    def proj(lon, lat):
        rho = math.sqrt(C - 2 * n * math.sin(math.radians(lat))) / n
        th = n * math.radians(lon - lon0)
        return rho * math.sin(th), rho * math.cos(th)   # y grows southward
    return proj


# ---- geometry ----------------------------------------------------------
def dp(pts, tol):
    """Douglas–Peucker; the ends are kept, so arcs shared by two shapes
    still meet."""
    if len(pts) < 3: return pts[:]
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]; t2 = tol * tol
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]; bx, by = pts[b]; dx, dy = bx - ax, by - ay; L = dx * dx + dy * dy
        best, bi = -1, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            if L == 0: d = (px - ax) ** 2 + (py - ay) ** 2
            else:
                t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L))
                d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
            if d > best: best, bi = d, i
        if best > t2:
            keep[bi] = True; stack += [(a, bi), (bi, b)]
    return [p for p, k in zip(pts, keep) if k]

def area(r):
    return abs(sum(r[i][0] * r[i - 1][1] - r[i - 1][0] * r[i][1] for i in range(len(r)))) / 2

def centroid(rings):
    big = max(rings, key=area); a = 0; cx = cy = 0
    for i in range(len(big)):
        x0, y0 = big[i - 1]; x1, y1 = big[i]; c = x0 * y1 - x1 * y0
        a += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c
    if a == 0: return big[0]
    return cx / (3 * a), cy / (3 * a)

def path(rings):
    out = []
    for r in rings:
        q = [(round(x * 10), round(y * 10)) for x, y in r]
        seg = ["%g %g" % ((x1 - x0) / 10, (y1 - y0) / 10)
               for (x0, y0), (x1, y1) in zip(q, q[1:]) if (x1, y1) != (x0, y0)]
        out.append("M%g %gl%sz" % (q[0][0] / 10, q[0][1] / 10, " ".join(seg)))
    return "".join(out).replace(" -", "-")

# A ring that crosses the antimeridian (Chukotka, Fiji) is cut there: its
# longitudes unwrapped, then clipped either side of 180°.
def clip(ring, x0, keep_left):
    out = []
    for i in range(len(ring)):
        a, b = ring[i - 1], ring[i]
        ina = a[0] <= x0 if keep_left else a[0] >= x0
        inb = b[0] <= x0 if keep_left else b[0] >= x0
        if ina != inb: out.append((x0, a[1] + (b[1] - a[1]) * (x0 - a[0]) / (b[0] - a[0])))
        if inb: out.append(b)
    return out

def cut(ring):
    if all(abs(ring[i][0] - ring[i - 1][0]) <= 180 for i in range(1, len(ring))): return None
    u, off = [ring[0]], 0
    for i in range(1, len(ring)):
        d = ring[i][0] - ring[i - 1][0]
        if d > 180: off -= 360
        elif d < -180: off += 360
        u.append((ring[i][0] + off, ring[i][1]))
    if abs(u[-1][0] - u[0][0]) > 1: return None       # round a pole (Antarctica): leave it
    if max(p[0] for p in u) > 180: parts = [clip(u, 180, True), [(x - 360, y) for x, y in clip(u, 180, False)]]
    else: parts = [clip(u, -180, False), [(x + 360, y) for x, y in clip(u, -180, True)]]
    return [p for p in parts if len(p) > 2]

def topo_arcs(topo, project):
    tr = topo.get("transform"); arcs = []
    for arc in topo["arcs"]:
        x = y = 0; pts = []
        for p in arc:
            if tr:
                x += p[0]; y += p[1]
                pts.append((x * tr["scale"][0] + tr["translate"][0], y * tr["scale"][1] + tr["translate"][1]))
            else: pts.append((p[0], p[1]))
        arcs.append([project(*p) for p in pts])
    return arcs

def topo_rings(geom, arcs):
    polys = {"MultiPolygon": geom.get("arcs"), "Polygon": [geom.get("arcs")]}.get(geom["type"]) or []
    rings = []
    for poly in polys:
        for ring in poly:
            pts = []
            for i in ring:
                a = arcs[i] if i >= 0 else arcs[~i][::-1]
                pts += a if not pts else a[1:]
            rings.append(pts)
    return rings

def fit(rings_by_key, width, pad=4):
    xs = [x for rs in rings_by_key.values() for r in rs for x, _ in r]
    ys = [y for rs in rings_by_key.values() for r in rs for _, y in r]
    x0, y0 = min(xs), min(ys); s = (width - 2 * pad) / (max(xs) - x0)
    return (lambda p: ((p[0] - x0) * s + pad, (p[1] - y0) * s + pad)), round((max(ys) - y0) * s + 2 * pad, 1)

def clean(rings, keep_one=False):
    out = [r for r in rings if len(r) > 3 and area(r) >= MIN_AREA]
    if not out and keep_one and rings: out = [max(rings, key=area)]
    return out

def view(shapes, w, h, counts, names, extra=None):
    """Counted shapes get a path each; the rest of the land is one path."""
    rest, items = [], []
    for k, rings in shapes.items():
        if k in counts:
            rs = clean(rings, True)
            it = {"k": k, "name": names.get(k, k), "n": counts[k], "d": path(rs)}
            if k in DRILL: it["drill"] = DRILL[k]; it["parts"] = PARTS[DRILL[k]]
            if sum(area(r) for r in rs) < DOT_AREA:
                cx, cy = centroid(rings); it["dot"] = [round(cx, 1), round(cy, 1)]
            items.append(it)
        else: rest += clean(rings)
    missing = set(counts) - {it["k"] for it in items}
    assert not missing, missing
    v = {"w": w, "h": h, "rest": path(rest), "shapes": items}
    v.update(extra or {})
    return v


def build():
    fetch()
    load = lambda n: json.load(open(os.path.join(SRC, n), encoding="utf-8"))
    data = {"names": NAMES, "total": TOTAL}

    # The world: Natural Earth projection, 960 wide, simplified arc by arc.
    w = load("countries-50m.json")
    S = 960 / (2 * 0.8707 * math.pi)
    oy = -natural_earth(0, 90)[1] * S
    proj = lambda lon, lat: (natural_earth(lon, lat)[0] * S + 480, natural_earth(lon, lat)[1] * S + oy)
    ll = topo_arcs(w, lambda x, y: (x, y))
    arcs = [dp([proj(*p) for p in a], TOL) for a in ll]
    shapes = {}
    for g in w["objects"]["countries"]["geometries"]:
        rs = []
        for raw, px in zip(topo_rings(g, ll), topo_rings(g, arcs)):
            parts = cut(raw)
            rs += [px] if parts is None else [dp([proj(*p) for p in part], TOL) for part in parts]
        if rs: shapes.setdefault(g.get("id") or g["properties"]["name"], []).extend(rs)
    sphere = [proj(-180, lat) for lat in range(-90, 91)] + [proj(180, lat) for lat in range(90, -91, -1)]
    data["world"] = view(shapes, 960, round(2 * oy, 1), {k: v[1] for k, v in COUNTS["world"].items()},
                         {k: v[0] for k, v in COUNTS["world"].items()}, {"outline": path([sphere])})

    # The United States, already in Albers USA at 975 x 610.
    u = load("states-albers-10m.json")
    arcs = [dp(a, TOL) for a in topo_arcs(u, lambda x, y: (x, y))]
    shapes = {g["properties"]["name"]: topo_rings(g, arcs) for g in u["objects"]["states"]["geometries"]}
    data["US"] = view(shapes, 975, 610, COUNTS["US"], {})

    # The rest: Natural Earth provinces, Albers, simplified ring by ring.
    files = {}
    for code, (fname, a3, field, lon0, lat1, lat2) in PROVINCES.items():
        src = files.get(fname) or files.setdefault(fname, load(fname))
        pr, raw = albers(lon0, lat1, lat2), {}
        for f in src["features"]:
            p = f["properties"]
            if p.get("adm0_a3") != a3 or not p.get(field): continue
            g = f["geometry"]; polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
            raw.setdefault(p[field], []).extend([pr(lon, lat) for lon, lat in ring] for poly in polys for ring in poly)
        tf, h = fit(raw, 900)
        shapes = {k: [dp([tf(p) for p in r], TOL) for r in rs] for k, rs in raw.items()}
        data[code] = view(shapes, 900, h, COUNTS[code], {k: EBIRD_NAME.get(k, k) for k in shapes})

    blob = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    open(OUT, "w", encoding="utf-8").write(blob)
    stamp = hashlib.sha1(blob.encode("utf-8")).hexdigest()[:8]
    page = os.path.join(ROOT, "about.html")
    html = open(page, encoding="utf-8").read()
    html2 = re.sub(r'data/birdmap\.json(\?v=[0-9a-f]+)?', "data/birdmap.json?v=" + stamp, html)
    if html2 != html: open(page, "w", encoding="utf-8").write(html2)
    for k in ["world", "US"] + list(PROVINCES):
        v = data[k]
        print("%-5s %4s x %-6s %3d KB  dots: %s" % (k, v["w"], v["h"], len(json.dumps(v)) // 1024,
              [s["name"] for s in v["shapes"] if "dot" in s]))
    print("data/birdmap.json", len(blob) // 1024, "KB, stamp", stamp)


if __name__ == "__main__":
    sys.exit(build())
