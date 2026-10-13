#!/usr/bin/env python3
"""Trace a collection's route along real roads for the globe.

    python3 tools/route.py alberta-bc-yukon     # one collection
    python3 tools/route.py                      # every collection in the file

data/routes.json holds, per collection slug, the `waypoints` you edit by hand
([lat, lng] in driving order: towns, park visitor hubs, a road's end) and the
`path` this tool writes from them: the driving route through those waypoints
from the public OSRM demo router (OpenStreetMap data), simplified to about a
kilometre and rounded to three decimals. The globe draws `path` in place of
the straight arcs between a collection's pins, so the waypoints should pass
through (or very near) every pin in data/places.json, in the same order.

Standard library only. The router is a free shared service: one request per
collection, no keys.
"""

import json
import math
import os
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILE = os.path.join(ROOT, "data", "routes.json")
ROUTER = "https://router.project-osrm.org/route/v1/driving/"
TOLERANCE = 0.01          # degrees of latitude, about 1 km
AGENT = "newton-liu.com route tracer"


def fetch(waypoints):
    coords = ";".join("{:.5f},{:.5f}".format(lng, lat) for lat, lng in waypoints)
    url = ROUTER + coords + "?overview=full&geometries=geojson"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": AGENT})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.load(r)
    except urllib.error.URLError:
        # The Mac's own Python 3.9 can't complete the router's TLS handshake;
        # its curl can.
        out = subprocess.run(["curl", "-sf", "-m", "60", "-A", AGENT, url],
                             check=True, capture_output=True).stdout
        data = json.loads(out)
    if data.get("code") != "Ok":
        raise SystemExit("router said {}: {}".format(data.get("code"), data.get("message", "")))
    route = data["routes"][0]
    return route["geometry"]["coordinates"], route["distance"]


def simplify(pts, tol):
    """Douglas-Peucker on [lng, lat], with longitude scaled by cos(latitude)."""
    if len(pts) < 3:
        return pts
    k = math.cos(math.radians(sum(p[1] for p in pts) / len(pts)))

    def dist(p, a, b):
        ax, ay, bx, by, px, py = a[0] * k, a[1], b[0] * k, b[1], p[0] * k, p[1]
        dx, dy = bx - ax, by - ay
        if not dx and not dy:
            return math.hypot(px - ax, py - ay)
        t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
        return math.hypot(px - ax - t * dx, py - ay - t * dy)

    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        far, at = 0, None
        for m in range(i + 1, j):
            d = dist(pts[m], pts[i], pts[j])
            if d > far:
                far, at = d, m
        if at is not None and far > tol:
            keep[at] = True
            stack += [(i, at), (at, j)]
    return [p for p, kp in zip(pts, keep) if kp]


def dump(doc):
    """The file stays readable: waypoints one per line, the path in rows."""
    out = ['{', '  "_comment": ' + json.dumps(doc["_comment"]) + ',', '  "routes": {']
    slugs = list(doc["routes"])
    for n, slug in enumerate(slugs):
        r = doc["routes"][slug]
        out.append('    ' + json.dumps(slug) + ': {')
        out.append('      "waypoints": [')
        out.append(',\n'.join('        [{:.3f}, {:.3f}]'.format(*w) for w in r["waypoints"]))
        out.append('      ],')
        path = r.get("path", [])
        rows = [path[i:i + 6] for i in range(0, len(path), 6)]
        out.append('      "path": [')
        out.append(',\n'.join('        ' + ', '.join('[{:.3f}, {:.3f}]'.format(*p) for p in row) for row in rows))
        out.append('      ]')
        out.append('    }' + (',' if n < len(slugs) - 1 else ''))
    out += ['  }', '}']
    return '\n'.join(out) + '\n'


def main():
    doc = json.load(open(FILE, encoding="utf-8"))
    slugs = sys.argv[1:] or list(doc["routes"])
    for slug in slugs:
        if slug not in doc["routes"]:
            raise SystemExit("{} has no waypoints in data/routes.json".format(slug))
        wps = doc["routes"][slug]["waypoints"]
        if len(wps) < 2:
            raise SystemExit("{} needs at least two waypoints".format(slug))
        coords, metres = fetch(wps)
        path = [[round(x, 3), round(y, 3)] for x, y in simplify(coords, TOLERANCE)]
        doc["routes"][slug]["path"] = path
        print("{}: {:,.0f} km of road, {} points".format(slug, metres / 1000, len(path)))
    text = dump(doc)
    json.loads(text)
    tmp = FILE + ".tmp"
    open(tmp, "w", encoding="utf-8").write(text)
    os.replace(tmp, FILE)


if __name__ == "__main__":
    main()
