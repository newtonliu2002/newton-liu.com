#!/usr/bin/env python3
"""Build data/birdmap.json, the About essay's bird map: Newton's eBird life
list on a map, the world by country, and every country he has birded in
opening into its states, provinces or other first-level regions.

    python3 -I tools/birdmap.py [path/to/MyEBirdData.csv]

The counts come from his eBird export (My eBird → Download my data), by
default the copy in his Portfolio Website folder. The export holds every
checklist's place and coordinates; none of that leaves this Mac. The
coordinates are used here only to tell which region outline a checklist
falls in where eBird's region codes and Natural Earth's differ, and only
the counts per country and region are written. Never commit the export.

A sighting counts as eBird counts it, by the eBird taxonomy (downloaded
once, public): a species, or a subspecies group or form of one, counted as
its species; Feral Pigeon counts as Rock Pigeon; other domestic types,
"sp.", slashes and hybrids don't. On 2026-10-16 this matched his profile's
world total (1,373) and every country but Malaysia (see PROFILE).

The outlines are Natural Earth (public domain): world-atlas's 50m countries,
us-atlas's Albers USA states (Alaska and Hawaii inset, like eBird's) and its
counties for Puerto Rico's municipalities and the Virgin Islands, and Natural Earth's admin-1
provinces for the rest. They are downloaded once into _arrange/geo-src/
(git-ignored; the 10m provinces are 40 MB), projected, simplified to about a
third of a pixel and written as SVG paths. The page's data-src stamp is
refreshed in about.html so the new file is fetched.

A new country: add it to COUNTRIES (its world-atlas id, eBird's name for it,
and what it opens into) and run this again.
"""
import csv, hashlib, json, math, os, re, sys, urllib.request
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "_arrange", "geo-src")
OUT = os.path.join(ROOT, "data", "birdmap.json")
EXPORT = os.path.expanduser("~/Desktop/Photography/Portfolio Website/MyEBirdData.csv")
SOURCES = {
    "countries-50m.json": "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json",
    "states-albers-10m.json": "https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/states-albers-10m.json",
    "counties-10m.json": "https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/counties-10m.json",
    "adm1-50m.geojson": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces.geojson",
    "adm1-10m.geojson": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson",
    "ebird-taxonomy.csv": "https://api.ebird.org/v2/ref/taxonomy/ebird?fmt=csv",
}

# eBird's country code: its world-atlas id, eBird's name for it, and what it
# opens into (None: it doesn't open; Singapore's export has no regions).
COUNTRIES = {
    "US": ("840", "United States", "states"),
    "CA": ("124", "Canada", "provinces and territories"),
    "MX": ("484", "Mexico", "states"),
    "CN": ("156", "China", "provinces"),
    "MA": ("504", "Morocco", "regions"),
    "JP": ("392", "Japan", "prefectures"),
    "LK": ("144", "Sri Lanka", "districts"),
    "EC": ("218", "Ecuador", "provinces"),
    "MY": ("458", "Malaysia", "states"),
    "PE": ("604", "Peru", "regions"),
    "CO": ("170", "Colombia", "departments"),
    "PR": ("630", "Puerto Rico", "municipalities"),
    "NZ": ("554", "New Zealand", "regions"),
    "VI": ("850", "Virgin Islands (U.S.)", "islands"),
    "SG": ("702", "Singapore", None),
    "BS": ("044", "Bahamas", "districts"),
    "KH": ("116", "Cambodia", "provinces"),
}
# Where his eBird profile counts differently from the export (2026-10-16:
# Malaysia shows 117 there, 118 here, all of them in Sabah).
PROFILE = {"MY": 117, "MY-12": 117}
# Outlines left off a country's map: Morocco's two regions in Western Sahara,
# which eBird and the world map keep apart.
SKIP = {"MA-15", "MA-16"}
COUNTY_FIPS = {"PR": "72", "VI": "78"}   # us-atlas's counties: municipalities, islands
NE50 = {"CA", "CN"}       # Natural Earth's coarser provinces are enough here
# Albers (lon0, lat1, lat2) for the big countries; the rest are drawn plain,
# longitude scaled by the cosine of their middle latitude.
ALBERS = {"CA": (-96, 49, 77), "MX": (-102, 17.5, 29.5), "CN": (105, 25, 47)}
NAME_FIELD = {"MA": "name"}      # Morocco's own spelling ("Souss - Massa - Draâ")
# eBird regions whose checklists sit on a border or a coast, where the
# outlines can't tell (Guajataca is on the Quebradillas–Isabela line; the
# Maricao forest spans Maricao and San Germán).
MATCH = {"PR-QB": "Quebradillas", "PR-SG": "San Germán"}
EBIRD_NAME = {"Yukon": "Yukon Territory", "Saint John": "St. John", "Saint Thomas": "St. Thomas",
              "Saint Croix": "St. Croix"}   # where eBird's name differs
USPS = {"AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
        "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia",
        "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois",
        "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana",
        "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota",
        "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
        "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
        "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon",
        "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota",
        "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia",
        "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming"}
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

def view(shapes, w, h, counts, names, drills=None, extra=None):
    """Counted shapes get a path each; the rest of the land is one path."""
    rest, items, drills = [], [], drills or {}
    for k, rings in shapes.items():
        if k in counts:
            rs = clean(rings, True)
            it = {"k": k, "name": names.get(k, k), "n": counts[k], "d": path(rs)}
            if k in drills: it["drill"], it["parts"] = drills[k]
            if sum(area(r) for r in rs) < DOT_AREA:
                cx, cy = centroid(rings); it["dot"] = [round(cx, 1), round(cy, 1)]
            items.append(it)
        else: rest += clean(rings)
    missing = set(counts) - {it["k"] for it in items}
    assert not missing, missing
    v = {"w": w, "h": h, "rest": path(rest), "shapes": items}
    v.update(extra or {})
    return v


# ---- the counts --------------------------------------------------------
def counts(export):
    """Species per country and per region, and each region's checklist
    positions (for matching outlines only; never written)."""
    tax = {t["SCIENTIFIC_NAME"]: t for t in csv.DictReader(open(os.path.join(SRC, "ebird-taxonomy.csv"), encoding="utf-8"))}
    world, country, region, where = set(), defaultdict(set), defaultdict(set), defaultdict(set)
    for r in csv.DictReader(open(export, encoding="utf-8")):
        code = r["State/Province"]; cc = code.split("-")[0]
        try: where[code].add((float(r["Longitude"]), float(r["Latitude"])))
        except ValueError: pass
        t = tax.get(r["Scientific Name"])
        if t is None: raise SystemExit("not in the eBird taxonomy: %s (%s)" % (r["Scientific Name"], r["Common Name"]))
        if t["CATEGORY"] == "species": sp = t["SPECIES_CODE"]
        elif t["CATEGORY"] in ("issf", "form", "intergrade") or r["Common Name"] == "Rock Pigeon (Feral Pigeon)": sp = t["REPORT_AS"]
        else: continue
        if not sp: continue
        world.add(sp); country[cc].add(sp)
        if code.split("-", 1)[-1] and "-" in code: region[code].add(sp)
    n = lambda k, v: PROFILE.get(k, len(v))
    return len(world), {k: n(k, v) for k, v in country.items()}, {k: n(k, v) for k, v in region.items()}, where


# ---- regions -----------------------------------------------------------
def inside(rings, x, y):
    hit = False
    for r in rings:
        for i in range(len(r)):
            (x0, y0), (x1, y1) = r[i - 1], r[i]
            if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0) + x0: hit = not hit
    return hit

def label(p, field):
    name = p.get(field) or p.get("name") or p.get("name_en") or p.get("iso_3166_2") or ""
    name = re.sub(r"\s+(Department|Departament|Prefecture|Province)$", "", name).replace(" - ", "-")
    return EBIRD_NAME.get(name, name)

def outlines(cc, load):
    """A country's regions in longitude and latitude, keyed by ISO code
    (Natural Earth's) or name; Peru's Lima and Lima Province share PE-LIM
    and so become one, as eBird has them."""
    groups = {}
    if cc in COUNTY_FIPS:      # finer than Natural Earth's for these islands
        t = load("counties-10m.json"); ll = topo_arcs(t, lambda x, y: (x, y))
        for g in t["objects"]["counties"]["geometries"]:
            if str(g.get("id", "")).startswith(COUNTY_FIPS[cc]):
                groups.setdefault(g["properties"]["name"], {"name": g["properties"]["name"], "rings": []})["rings"] += topo_rings(g, ll)
        return groups
    field = NAME_FIELD.get(cc, "name_en")
    for f in load("adm1-50m.geojson" if cc in NE50 else "adm1-10m.geojson")["features"]:
        p = f["properties"]
        if p.get("iso_a2") != cc: continue
        iso = p.get("iso_3166_2") or ""
        if iso in SKIP: continue
        key = iso if iso and not iso.endswith("~") else label(p, field)
        geom = f["geometry"]; polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        g = groups.setdefault(key, {"name": label(p, field), "rings": []})
        g["rings"] += [[(lon, lat) for lon, lat in ring] for poly in polys for ring in poly]
    return groups

def match(cc, groups, regions, where):
    """eBird's region code → its outline: the same ISO code, else the
    outline most of its checklists fall in (China's codes are numbers,
    Puerto Rico's municipalities and the Virgin Islands have none)."""
    out = {}
    for code in sorted(c for c in regions if c.startswith(cc + "-")):
        if code in groups: out[code] = code; continue
        if MATCH.get(code) in groups: out[code] = MATCH[code]; continue
        votes = Counter(k for x, y in where[code] for k, g in groups.items() if inside(g["rings"], x, y))
        if not votes:   # on a coast the outline is too coarse to hold (Nassau): the nearest
            near = lambda k: min((x - a) ** 2 + (y - b) ** 2 for x, y in where[code] for r in groups[k]["rings"] for a, b in r)
            votes = Counter([min(groups, key=near)])
        out[code] = votes.most_common(1)[0][0]
    taken = Counter(out.values())
    assert all(v == 1 for v in taken.values()), "two eBird regions in one outline: %s" % taken
    return out


def build():
    fetch()
    export = sys.argv[1] if len(sys.argv) > 1 else EXPORT
    total, by_country, by_region, where = counts(export)
    unknown = set(by_country) - set(COUNTRIES)
    assert not unknown, "add to COUNTRIES: %s" % sorted(unknown)
    files = {}
    load = lambda n: files.get(n) or files.setdefault(n, json.load(open(os.path.join(SRC, n), encoding="utf-8")))
    opens = {cc for cc in by_country if COUNTRIES[cc][2] and any(c.startswith(cc + "-") for c in by_region)}
    data = {"names": dict([("world", "World")] + [(cc, COUNTRIES[cc][1]) for cc in sorted(opens)]), "total": total}

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
    data["world"] = view(shapes, 960, round(2 * oy, 1),
                         {COUNTRIES[cc][0]: n for cc, n in by_country.items()},
                         {COUNTRIES[cc][0]: COUNTRIES[cc][1] for cc in by_country},
                         {COUNTRIES[cc][0]: (cc, COUNTRIES[cc][2]) for cc in opens},
                         {"outline": path([sphere])})

    for cc in sorted(opens):
        mine = {c: n for c, n in by_region.items() if c.startswith(cc + "-")}
        if cc == "US":
            # Already in Albers USA at 975 x 610.
            u = load("states-albers-10m.json")
            arcs = [dp(a, TOL) for a in topo_arcs(u, lambda x, y: (x, y))]
            shapes = {g["properties"]["name"]: topo_rings(g, arcs) for g in u["objects"]["states"]["geometries"]}
            data["US"] = view(shapes, 975, 610, {USPS[c[3:]]: n for c, n in mine.items()}, {})
            continue
        groups = outlines(cc, load)
        to = match(cc, groups, mine, where)
        print("%s  %s" % (cc, ", ".join("%s → %s (%d)" % (c, groups[k]["name"], mine[c]) for c, k in sorted(to.items()))))
        raw = {k: g["rings"] for k, g in groups.items()}
        xs = [x for rs in raw.values() for r in rs for x, _ in r]
        if max(xs) - min(xs) > 180:           # across the antimeridian (New Zealand's Chatham Islands)
            raw = {k: [[(x + 360 if x < 0 else x, y) for x, y in r] for r in rs] for k, rs in raw.items()}
        if cc in ALBERS: pr = albers(*ALBERS[cc])
        else:
            ys = [y for rs in raw.values() for r in rs for _, y in r]
            k = math.cos(math.radians((min(ys) + max(ys)) / 2)); pr = lambda lon, lat, k=k: (lon * k, -lat)
        raw = {key: [[pr(x, y) for x, y in r] for r in rs] for key, rs in raw.items()}
        tf, h = fit(raw, 900)
        shapes = {key: [dp([tf(p) for p in r], TOL) for r in rs] for key, rs in raw.items()}
        data[cc] = view(shapes, 900, h, {to[c]: n for c, n in mine.items()}, {key: g["name"] for key, g in groups.items()})

    blob = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    open(OUT, "w", encoding="utf-8").write(blob)
    stamp = hashlib.sha1(blob.encode("utf-8")).hexdigest()[:8]
    page = os.path.join(ROOT, "about.html")
    html = open(page, encoding="utf-8").read()
    html2 = re.sub(r'data/birdmap\.json(\?v=[0-9a-f]+)?', "data/birdmap.json?v=" + stamp, html)
    if html2 != html: open(page, "w", encoding="utf-8").write(html2)
    for k in ["world"] + sorted(opens):
        v = data[k]
        print("%-5s %4s x %-6s %3d KB  dots: %s" % (k, v["w"], v["h"], len(json.dumps(v)) // 1024,
              [s["name"] for s in v["shapes"] if "dot" in s]))
    print("world total", total, "; data/birdmap.json", len(blob) // 1024, "KB, stamp", stamp)


if __name__ == "__main__":
    sys.exit(build())
