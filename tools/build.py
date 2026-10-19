#!/usr/bin/env python3
"""Scan images/ and regenerate data/photos.json + the per-collection pages
(and each travel journal's media.json, the shapes of its media).

Usage
-----
    python3 tools/build.py              # scan, make thumbnails, write manifest
    python3 tools/build.py --no-thumbs  # quick check only: drops every photo's variants; never commit its photos.json
    python3 tools/build.py --force      # allow writing an empty manifest
    python3 tools/build.py --allow-removals  # let photographs whose files are gone leave the manifest

Organising photographs
----------------------
One folder per collection, named to match a `slug` in data/collections.json:

    images/peru/Andean Cock-of-the-rock_Manu NP_2024-07-14.jpg
    images/galapagos/Waved Albatross_Espanola_2023-05-02.jpg

The filename is read as up to three underscore-separated fields —
`Title_Location_YYYY-MM-DD` — and location and date are both optional. A
missing date falls back to the EXIF capture date. Folders starting with "_"
or "." are skipped, which keeps images/_thumbs out of the gallery.

Hand edits win
--------------
Anything you correct in data/photos.json — a species name, a location, a
caption — survives re-runs. Only mechanical fields (dimensions, EXIF,
thumbnail path) are refreshed. Delete a field to have it re-derived.

Standard library only, plus macOS's built-in `sips` for thumbnails (skipped
automatically if unavailable).
"""

import argparse
import csv
import hashlib
import importlib.util
import json
import os
import re
import shutil
import struct
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMAGE_DIR = os.path.join(ROOT, "images")
THUMB_DIR = os.path.join(IMAGE_DIR, "_thumbs")
DATA_DIR = os.path.join(ROOT, "data")
MANIFEST = os.path.join(DATA_DIR, "photos.json")
COLLECTIONS = os.path.join(DATA_DIR, "collections.json")
PAGES_DIR = os.path.join(ROOT, "collections")

RASTER_EXT = (".jpg", ".jpeg", ".png", ".webp")
EXTENSIONS = RASTER_EXT + (".svg",)
# The originals are large enough for a 5K display, which is far more than a
# phone should ever download. So every photograph is also written out at these
# long edges, and the browser picks one from a srcset. Add a width here and the
# next build fills it in; the original is always offered as the largest.
VARIANT_LONG_EDGES = (800, 1600, 2400, 4000)   # 4000 matters only above it: a 6400 panorama (5K screens)
VARIANT_QUALITY = 85

# Fields a human may edit; never overwritten once set. `focus` is a CSS
# object-position ("center bottom") for a photograph the grid has to crop.
# `caption` is the bird's English name, `sci` its scientific name, `ebird`
# its eBird species code (ebird.org/species/<code>) and `zh` its Chinese name
# (eBird's zh_SIM, shown first in the lightbox when the site is in Chinese).
AUTHORED_FIELDS = ("title", "location", "date", "caption", "collection", "featured",
                   "focus", "sci", "ebird", "zh", "wiki", "wikiZh", "also")


# --------------------------------------------------------------------------
# Image dimensions
# --------------------------------------------------------------------------

def jpeg_size(fh):
    """Width/height from a JPEG's SOF marker, or None."""
    fh.seek(2)  # past SOI
    while True:
        byte = fh.read(1)
        if not byte:
            return None
        if byte != b"\xff":
            continue
        marker = fh.read(1)
        while marker == b"\xff":           # markers may be 0xFF-padded
            marker = fh.read(1)
        if not marker:
            return None
        code = marker[0]
        if code in (0xD8, 0x01) or 0xD0 <= code <= 0xD7:   # standalone markers
            continue
        length_bytes = fh.read(2)
        if len(length_bytes) < 2:
            return None
        length = struct.unpack(">H", length_bytes)[0]
        # SOF0-SOF15, excluding DHT (C4), JPG (C8) and DAC (CC).
        if 0xC0 <= code <= 0xCF and code not in (0xC4, 0xC8, 0xCC):
            payload = fh.read(5)
            if len(payload) < 5:
                return None
            height, width = struct.unpack(">HH", payload[1:5])
            return width, height
        fh.seek(length - 2, os.SEEK_CUR)


def png_size(data):
    return struct.unpack(">II", data[16:24]) if len(data) >= 24 else None


def webp_size(data):
    """Handles all three WebP flavours: VP8 (lossy), VP8L (lossless), VP8X."""
    if len(data) < 30 or data[12:16] not in (b"VP8 ", b"VP8L", b"VP8X"):
        return None
    kind = data[12:16]
    if kind == b"VP8 ":
        return (struct.unpack("<H", data[26:28])[0] & 0x3FFF,
                struct.unpack("<H", data[28:30])[0] & 0x3FFF)
    if kind == b"VP8L":
        bits = struct.unpack("<I", data[21:25])[0]
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    w = data[24] | (data[25] << 8) | (data[26] << 16)   # VP8X: 24-bit, minus one
    h = data[27] | (data[28] << 8) | (data[29] << 16)
    return w + 1, h + 1


def svg_size(text):
    """Only used by the placeholder tiles; real photographs are raster."""
    box = re.search(r'viewBox\s*=\s*["\']\s*[\d.+-]+[\s,]+[\d.+-]+[\s,]+([\d.]+)[\s,]+([\d.]+)', text)
    if box:
        return int(float(box.group(1))), int(float(box.group(2)))
    w = re.search(r'\bwidth\s*=\s*["\'](\d+)', text)
    h = re.search(r'\bheight\s*=\s*["\'](\d+)', text)
    return (int(w.group(1)), int(h.group(1))) if w and h else None


def read_size(path):
    try:
        if path.lower().endswith(".svg"):
            with open(path, "r", encoding="utf-8", errors="replace") as fh:
                return svg_size(fh.read(4096))
        with open(path, "rb") as fh:
            head = fh.read(32)
            if head[:2] == b"\xff\xd8":
                fh.seek(0)
                return jpeg_size(fh)
            if head[:8] == b"\x89PNG\r\n\x1a\n":
                return png_size(head)
            if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
                fh.seek(0)
                return webp_size(fh.read(64))
    except (OSError, struct.error, ValueError):
        pass
    return None


def video_size(path):
    """An MP4/QuickTime video's width and height as a browser shows it: the
    first track with a picture (its tkhd), turned when its matrix turns it
    (a phone's upright video is stored on its side). None if unreadable."""
    try:
        with open(path, "rb") as fh:
            size = os.fstat(fh.fileno()).st_size

            def boxes(start, end):
                pos = start
                while pos + 8 <= end:
                    fh.seek(pos)
                    head = fh.read(16)
                    length, kind = struct.unpack(">I4s", head[:8])
                    body = 8
                    if length == 1:                  # a 64-bit size follows
                        length, body = struct.unpack(">Q", head[8:16])[0], 16
                    elif length == 0:                # runs to the end
                        length = end - pos
                    if length < body or pos + length > end:
                        return
                    yield kind, pos + body, pos + length
                    pos += length

            for kind, a, b in boxes(0, size):
                if kind != b"moov":
                    continue
                for kind2, a2, b2 in boxes(a, b):
                    if kind2 != b"trak":
                        continue
                    for kind3, a3, b3 in boxes(a2, b2):
                        if kind3 != b"tkhd":
                            continue
                        fh.seek(a3)
                        data = fh.read(min(b3 - a3, 96))
                        at = 88 if data[:1] == b"\x01" else 76    # version 1 has 64-bit times
                        if len(data) < at + 8:
                            continue
                        w, h = (v >> 16 for v in struct.unpack(">II", data[at:at + 8]))   # 16.16
                        if not w or not h:
                            continue                          # a sound track
                        ma, mb = struct.unpack(">ii", data[at - 36:at - 28])
                        if ma == 0 and mb != 0:               # turned a quarter
                            w, h = h, w
                        return w, h
    except (OSError, struct.error, ValueError):
        pass
    return None


# --------------------------------------------------------------------------
# EXIF
# --------------------------------------------------------------------------

TYPE_SIZES = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8}

IFD0_TAGS = {0x010F: "make", 0x0110: "model", 0x0112: "orientation", 0x8769: "_exif_ptr"}
EXIF_TAGS = {
    0x829A: "exposure_time", 0x829D: "fnumber", 0x8827: "iso",
    0x9003: "date_taken", 0x920A: "focal_length", 0xA405: "focal_35mm",
    0xA434: "lens",
}


def _read_ifd(blob, offset, endian, wanted):
    """Read one IFD, returning {name: value} for the tags in `wanted`."""
    out = {}
    if offset + 2 > len(blob):
        return out
    count = struct.unpack(endian + "H", blob[offset:offset + 2])[0]
    for i in range(count):
        entry = offset + 2 + i * 12
        if entry + 12 > len(blob):
            break
        tag, typ, n = struct.unpack(endian + "HHI", blob[entry:entry + 8])
        if tag not in wanted:
            continue
        size = TYPE_SIZES.get(typ, 0) * n
        if size == 0:
            continue
        if size <= 4:
            raw = blob[entry + 8:entry + 8 + size]
        else:
            ptr = struct.unpack(endian + "I", blob[entry + 8:entry + 12])[0]
            if ptr + size > len(blob):
                continue
            raw = blob[ptr:ptr + size]

        name = wanted[tag]
        if typ == 2:                                     # ASCII
            out[name] = raw.split(b"\x00")[0].decode("utf-8", "replace").strip()
        elif typ == 3:                                   # SHORT
            out[name] = struct.unpack(endian + "H", raw[:2])[0]
        elif typ == 4:                                   # LONG
            out[name] = struct.unpack(endian + "I", raw[:4])[0]
        elif typ in (5, 10):                             # (S)RATIONAL
            num, den = struct.unpack(endian + ("ii" if typ == 10 else "II"), raw[:8])
            out[name] = (num / den) if den else 0.0
    return out


def read_exif(path):
    """Best-effort EXIF read; returns {} for anything unparseable."""
    if not path.lower().endswith((".jpg", ".jpeg")):
        return {}
    try:
        with open(path, "rb") as fh:
            data = fh.read(256 * 1024)      # EXIF sits near the front of the file
    except OSError:
        return {}

    marker = data.find(b"\xff\xe1")
    if marker < 0 or data[marker + 4:marker + 10] != b"Exif\x00\x00":
        return {}
    tiff = data[marker + 10:]
    if len(tiff) < 8:
        return {}

    endian = "<" if tiff[:2] == b"II" else ">" if tiff[:2] == b"MM" else None
    if endian is None:
        return {}
    try:
        fields = _read_ifd(tiff, struct.unpack(endian + "I", tiff[4:8])[0], endian, IFD0_TAGS)
        if "_exif_ptr" in fields:
            fields.update(_read_ifd(tiff, fields.pop("_exif_ptr"), endian, EXIF_TAGS))
    except (struct.error, IndexError):
        return {}
    return fields


def format_exif(fields):
    """Raw EXIF values -> the strings shown under a photograph."""
    out = {}
    make = (fields.get("make") or "").strip()
    model = (fields.get("model") or "").strip()
    # "NIKON CORPORATION" + "NIKON Z 9" shouldn't read as "NIKON NIKON Z 9".
    if model and make and model.upper().startswith(make.split()[0].upper()):
        out["camera"] = model
    elif make or model:
        out["camera"] = (make + " " + model).strip()

    lens = (fields.get("lens") or "").strip()
    # Drones and phones report the lens as a bare spec ("70.0 mm f/2.8"),
    # which just repeats the focal length and aperture printed beside it.
    # Named glass ("RF100-500mm F4.5-7.1 L IS USM") is worth showing.
    bare_spec = re.fullmatch(r"[\d.]+\s*mm(\s*f/?[\d.]+)?", lens, re.I)
    if lens and not bare_spec and lens.lower() not in ("----", "unknown"):
        out["lens"] = lens

    if fields.get("focal_length"):
        out["focal"] = "{:g}mm".format(round(fields["focal_length"]))
    if fields.get("fnumber"):
        out["aperture"] = "f/{:g}".format(round(fields["fnumber"], 1))

    shutter = fields.get("exposure_time")
    if shutter:
        out["shutter"] = ("{:g}s".format(round(shutter, 1)) if shutter >= 1
                          else "1/{:g}s".format(round(1 / shutter)))
    if fields.get("iso"):
        out["iso"] = str(fields["iso"])
    return out


# --------------------------------------------------------------------------
# Filenames and thumbnails
# --------------------------------------------------------------------------

def parse_filename(stem):
    """'Snowy Owl_Amherst Island ON_2026-01-12' -> (title, location, date)."""
    parts = [p.strip() for p in stem.split("_")]
    title, location, date = (parts[0] if parts else stem), "", ""
    for part in parts[1:]:
        if re.match(r"^\d{4}-\d{2}-\d{2}$", part):
            date = part
        elif part and not location:
            location = part
    # Tolerate slugged filenames straight out of an export.
    if title and title.lower() == title:
        title = " ".join(w.capitalize() for w in re.sub(r"-+", " ", title).split())
    return title.strip(), location, date


def make_variants(src_abs, rel_path, rel_src, width, height):
    """Write the smaller widths of one photograph and describe them all.

    Returns a list of {"w": <real pixel width>, "src": <repo path>}, smallest
    first, with the original last. `w` is the true width of that file, not the
    long edge, because an upright resized to a 1600px long edge is 1280 wide
    and a srcset descriptor that lied about it would make the browser choose
    badly.
    """
    out = []
    if not shutil.which("sips") or src_abs.lower().endswith(".svg"):
        return [{"w": width, "src": rel_src}] if width else []

    long_edge = max(width, height)
    for edge in VARIANT_LONG_EDGES:
        if not long_edge or edge >= long_edge:
            continue                      # never upscale — the original is enough
        rel_out = "{}/{}".format(edge, rel_path)
        abs_out = os.path.join(THUMB_DIR, rel_out)
        os.makedirs(os.path.dirname(abs_out), exist_ok=True)

        if not (os.path.exists(abs_out)
                and os.path.getmtime(abs_out) >= os.path.getmtime(src_abs)):
            try:
                subprocess.run(
                    ["sips", "-Z", str(edge),
                     "--setProperty", "format", "jpeg",
                     "--setProperty", "formatOptions", str(VARIANT_QUALITY),
                     src_abs, "--out", abs_out],
                    check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except (subprocess.CalledProcessError, OSError):
                continue

        real = read_size(abs_out)
        if not real:
            continue
        out.append({"w": real[0],
                    "src": os.path.relpath(abs_out, ROOT).replace(os.sep, "/")})

    if width:
        out.append({"w": width, "src": rel_src})
    return out


# --------------------------------------------------------------------------
# Collection pages
# --------------------------------------------------------------------------

PAGE_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} — Newton Liu Photography</title>
<meta name="description" content="{title} — photographs by Newton Liu.">
<meta name="theme-color" content="#121212">
<link rel="icon" type="image/png" sizes="64x64" href="../../assets/favicon.png">
<link rel="apple-touch-icon" href="../../assets/apple-touch-icon.png">
<script>try{{if(localStorage.getItem("theme")==="white"){{document.documentElement.dataset.theme="light";var m=document.querySelector('meta[name="theme-color"]');if(m)m.content="#ffffff"}}}}catch(e){{}}</script>
<script>try{{if(localStorage.getItem("lang")==="zh"&&!/[?&]edit\\b/.test(location.search))document.documentElement.setAttribute("data-site-lang","zh")}}catch(e){{}}</script>
<link rel="stylesheet" href="../../assets/site.css?v={v_css}">
</head>

<!-- Generated by tools/build.py. The heading text is filled in from
     data/collections.json at runtime; edit that file, not this one. -->
<body data-page="gallery" data-collection="{slug}" data-base="../../">

<a class="skip-link" href="#grid">Skip to photographs</a>

<header class="masthead">
  <div class="wrap masthead-inner">
    <a class="wordmark" href="../../">
      <span class="wordmark-name">Newton Liu</span>
      <span class="wordmark-sub">Photography</span>
    </a>
    <nav class="nav">
      <a href="../../#collections" aria-current="page">Work</a>
      <a href="../../about.html">About</a>
      <button type="button" class="nav-tab" data-menu="journals">Journals</button>
      <a href="../../academia.html">Academia</a>
      <a href="../../projects.html">Projects</a>
      <a href="../../contact.html">Contact</a>
    </nav>
  </div>
</header>

<main>
  <div class="wrap-wide book-lead">
    <figure class="book-opener"></figure>
  </div>

  <div class="wrap-wide book-body">
    <aside class="book-rail">
      <a class="back-link" href="../../#collections">&larr; All collections</a>
      <h1 class="gallery-title">{title}</h1>
      <p class="gallery-date"></p>
      <p class="gallery-sub"></p>
      <p class="gallery-blurb"></p>
    </aside>

    <div id="grid" class="grid book" aria-live="polite">
      <p class="grid-status">Loading photographs…</p>
    </div>
  </div>
</main>

<footer class="footer">
  <div class="wrap footer-inner">
    <p>&copy; <span data-year>2026</span> Newton Liu. All photographs are my own.</p>
    <p class="footer-links">
      <a href="../../about.html">About</a>
      <a href="../../projects.html">Projects</a>
      <a href="../../contact.html">Contact</a>
    </p>
  </div>
</footer>

<div id="lightbox" class="lightbox" hidden role="dialog" aria-modal="true" aria-label="Photograph viewer">
  <button class="lb-close" type="button" aria-label="Close viewer">&times;</button>
  <button class="lb-nav lb-prev" type="button" aria-label="Previous photograph">&#8249;</button>
  <button class="lb-nav lb-next" type="button" aria-label="Next photograph">&#8250;</button>
  <figure class="lb-figure">
    <img class="lb-image" alt="">
    <figcaption class="lb-caption">
      <h2 class="lb-title"></h2>
      <p class="lb-meta"></p>
      <p class="lb-exif"></p>
      <p class="lb-name"></p>
    </figcaption>
  </figure>
</div>

<script src="../../assets/site.js?v={v_js}"></script>
<script src="../../assets/edit.js?v={v_edit}"></script>
</body>
</html>
"""


def load_collections():
    try:
        with open(COLLECTIONS, "r", encoding="utf-8") as fh:
            return json.load(fh).get("collections", [])
    except (OSError, ValueError) as exc:
        print("Couldn't read data/collections.json: {}".format(exc))
        return []


# --------------------------------------------------------------------------
# Asset fingerprints.
#
# A stylesheet edit that a browser refuses to re-fetch is indistinguishable
# from an edit that didn't work, and you lose a round trip finding that out.
# Every page therefore links its assets with ?v=<hash of the file>, so the URL
# changes whenever the file does and no cache can hold the old one. The root
# pages and the journal pages (journals/<trip>/index.html, which link
# ../../assets/x?v=) are hand-written, so their existing stamps are rewritten
# in place rather than regenerated. A page only gets a stamp it already has a
# link for.

ASSETS = ("site.css", "site.js", "edit.js", "globe.css", "globe.js",
          "journal.css", "journal.js", "journal-map.css", "journal-map.js")


def asset_stamps():
    """{'site.css': '3f9a1c7d', ...} — short content hash per asset."""
    out = {}
    for name in ASSETS:
        path = os.path.join(ROOT, "assets", name)
        try:
            with open(path, "rb") as fh:
                out[name] = hashlib.sha256(fh.read()).hexdigest()[:8]
        except OSError:
            out[name] = "0"
    return out


def stamp_root_pages(stamps):
    """Refresh ?v= on the hand-written pages: the six at the root and every
    journal's page. Returns how many changed."""
    changed = 0
    pages = ["index.html", "work.html", "projects.html", "about.html", "contact.html", "academia.html"]
    journals = os.path.join(ROOT, "journals")
    if os.path.isdir(journals):
        pages += sorted(os.path.join("journals", d, "index.html") for d in os.listdir(journals)
                        if not d.startswith((".", "_")))
    for page in pages:
        path = os.path.join(ROOT, page)
        if not os.path.exists(path):
            continue
        with open(path, "r", encoding="utf-8") as fh:
            html = fh.read()
        new = html
        for name, digest in stamps.items():
            # Only a link's own path (after a quote or a slash), never a
            # mention of the file in a comment.
            new = re.sub(
                r"(?<=[\"'/])(assets/" + re.escape(name) + r")(\?v=[0-9a-f]+)?",
                r"\1?v=" + digest, new)
        if new != html:
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(new)
            changed += 1
    return changed


def write_pages(collections, stamps):
    """One stub page per collection. Rewritten every run — don't hand-edit."""
    written = 0
    for c in collections:
        slug = c.get("slug")
        if not slug:
            continue
        out_dir = os.path.join(PAGES_DIR, slug)
        os.makedirs(out_dir, exist_ok=True)
        html = PAGE_TEMPLATE.format(
            slug=slug, title=c.get("title", slug),
            v_css=stamps["site.css"], v_js=stamps["site.js"],
            v_edit=stamps["edit.js"])
        path = os.path.join(out_dir, "index.html")
        existing = None
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as fh:
                existing = fh.read()
        if existing != html:
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(html)
            written += 1
    return written


# --------------------------------------------------------------------------
# Manifest
# --------------------------------------------------------------------------

def load_existing():
    if not os.path.exists(MANIFEST):
        return {}
    try:
        with open(MANIFEST, "r", encoding="utf-8") as fh:
            return {p["src"]: p for p in json.load(fh).get("photos", []) if p.get("src")}
    except (OSError, ValueError):
        return {}


def collect(make_thumbs=True):
    photos = []
    existing = load_existing()
    if not os.path.isdir(IMAGE_DIR):
        return photos

    for slug in sorted(os.listdir(IMAGE_DIR)):
        cat_dir = os.path.join(IMAGE_DIR, slug)
        if not os.path.isdir(cat_dir) or slug.startswith(("_", ".")):
            continue

        for name in sorted(os.listdir(cat_dir)):
            if not name.lower().endswith(EXTENSIONS) or name.startswith("."):
                continue

            abs_path = os.path.join(cat_dir, name)
            rel = "images/{}/{}".format(slug, name)
            title, location, date = parse_filename(os.path.splitext(name)[0])
            raw_exif = read_exif(abs_path)

            if not date and raw_exif.get("date_taken"):
                m = re.match(r"^(\d{4}):(\d{2}):(\d{2})", raw_exif["date_taken"])
                if m:
                    date = "{}-{}-{}".format(*m.groups())

            size = read_size(abs_path)
            width, height = size if size else (0, 0)
            if raw_exif.get("orientation") in (5, 6, 7, 8):     # rotated original
                width, height = height, width

            entry = {
                "src": rel, "title": title, "collection": slug,
                "location": location, "date": date,
                "width": width, "height": height,
                "exif": format_exif(raw_exif),
            }
            if make_thumbs:
                variants = make_variants(abs_path, "{}/{}".format(slug, name),
                                         rel, width, height)
                if len(variants) > 1:
                    entry["variants"] = variants
                    # `thumb` stays as the one modest-sized file to fall back on
                    # when a srcset isn't wanted — collection covers use it, and
                    # so does any browser that ignores srcset.
                    entry["thumb"] = variants[min(1, len(variants) - 2)]["src"]

            for field in AUTHORED_FIELDS:               # hand edits win
                if existing.get(rel, {}).get(field):
                    entry[field] = existing[rel][field]

            photos.append(entry)

    # The order of data/photos.json IS the gallery's running order — the packed
    # grid lays photographs out in exactly this sequence — so a hand-arranged
    # manifest has to survive a rebuild. Anything already in the manifest keeps
    # its position; newly imported photographs join the end, newest first, to
    # be placed by hand.
    position = {src: i for i, src in enumerate(existing)}
    seen = [p for p in photos if p["src"] in position]
    fresh = [p for p in photos if p["src"] not in position]
    seen.sort(key=lambda p: position[p["src"]])
    fresh.sort(key=lambda p: (p.get("date") or "0000-00-00", p["src"]), reverse=True)
    return seen + fresh


# --------------------------------------------------------------------------
# A travel journal's media: their shapes (journals/<trip>/media.json)
# --------------------------------------------------------------------------
# The width and height of every photograph, video and poster a journal
# shows, so assets/journal.js gives each frame its shape before the file
# arrives: the page doesn't shift as they come in, and a jump to an entry
# lands where it was aimed. The files are the ones tools/upload.py reads for
# the journal (its cover, and each listed entry's @photo, @video and
# poster). A file missing on this machine keeps the shape it had.

def journal_shapes(folder):
    """Write <folder>/media.json for the journal in `folder`. Returns the
    number of shapes it holds and whether the file changed."""
    spec = importlib.util.spec_from_file_location("site_upload", os.path.join(ROOT, "tools", "upload.py"))
    upload = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(upload)
    name = os.path.relpath(os.path.join(folder, "journal.json"), ROOT)
    out = os.path.join(folder, "media.json")
    try:
        with open(out, "r", encoding="utf-8") as fh:
            old = json.load(fh).get("sizes") or {}
    except (OSError, ValueError, AttributeError):
        old = {}
    try:
        with open(out, "r", encoding="utf-8") as fh:
            old_exif = json.load(fh).get("exif") or {}
    except (OSError, ValueError, AttributeError):
        old_exif = {}
    sizes, exif = {}, {}
    for key in upload.trip_media(folder, name):
        if key in sizes or key.startswith("/") or ".." in key:
            continue
        path = os.path.join(ROOT, key)
        size = None
        if os.path.isfile(path):
            if key.lower().endswith((".mp4", ".m4v", ".mov")):
                size = video_size(path)
            else:
                size = read_size(path)
                fields = read_exif(path)
                if size and fields.get("orientation") in (5, 6, 7, 8):
                    size = (size[1], size[0])             # shown turned, as browsers do
                # The camera line under the photograph when it's enlarged, as
                # a collection's photographs have from photos.json.
                if format_exif(fields):
                    exif[key] = format_exif(fields)
                    # The day it was taken, shown over the camera line when
                    # enlarged, as a collection's photographs have it.
                    m = re.match(r"^(\d{4}):(\d{2}):(\d{2})", fields.get("date_taken") or "")
                    if m:
                        exif[key]["date"] = "{}-{}-{}".format(*m.groups())
        elif isinstance(old_exif.get(key), dict):
            exif[key] = old_exif[key]
        if size and size[0] and size[1]:
            sizes[key] = [int(size[0]), int(size[1])]
        elif isinstance(old.get(key), list):
            sizes[key] = old[key]
    try:
        with open(out, "r", encoding="utf-8") as fh:
            old_birds = json.load(fh).get("birds") or {}
    except (OSError, ValueError, AttributeError):
        old_birds = {}
    birds = journal_birds(folder, old_birds)
    rows = ["    {}: [{}, {}]".format(json.dumps(k, ensure_ascii=False), *v) for k, v in sizes.items()]
    cams = ["    {}: {}".format(json.dumps(k, ensure_ascii=False), json.dumps(v, ensure_ascii=False)) for k, v in exif.items()]
    names = ["    {}: {}".format(json.dumps(k, ensure_ascii=False), json.dumps(v, ensure_ascii=False)) for k, v in birds.items()]
    text = ('{\n  "sizes": {' + ("\n" + ",\n".join(rows) + "\n  " if rows else "") + "},\n"
            '  "exif": {' + ("\n" + ",\n".join(cams) + "\n  " if cams else "") + "},\n"
            '  "birds": {' + ("\n" + ",\n".join(names) + "\n  " if names else "") + "}\n}\n")
    try:
        with open(out, "r", encoding="utf-8") as fh:
            if fh.read() == text:
                return len(sizes), False
    except OSError:
        pass
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(text)
    return len(sizes), True


# A bird with no Chinese name in eBird's zh_SIM taxonomy: the standard
# mainland name, checked (棕榈鬼鸮 is also Newton's own word for it).
ZH_BIRD_NAMES = {"nswowl": "棕榈鬼鸮"}


def bird_names(english):
    """{caption, sci, ebird, zh} for an English eBird name, from the eBird
    taxonomy in _arrange/geo-src/ (local only); None if it isn't there."""
    src = os.path.join(ROOT, "_arrange", "geo-src")
    try:
        with open(os.path.join(src, "ebird-taxonomy.csv"), encoding="utf-8") as fh:
            row = next((r for r in csv.DictReader(fh)
                        if r["COMMON_NAME"].lower() == english.lower() and r["CATEGORY"] == "species"), None)
    except OSError:
        return None
    if not row:
        return None
    out = {"caption": row["COMMON_NAME"], "sci": row["SCIENTIFIC_NAME"], "ebird": row["SPECIES_CODE"]}
    zh = ZH_BIRD_NAMES.get(out["ebird"])
    try:
        with open(os.path.join(src, "ebird-taxonomy-zh_SIM.csv"), encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                if r["SPECIES_CODE"] == out["ebird"] and r["COMMON_NAME"] != out["caption"]:
                    zh = r["COMMON_NAME"]
                    break
    except OSError:
        pass
    if zh:
        out["zh"] = zh
    return out


def journal_birds(folder, old):
    """{path: names} for each journal photo whose line says "bird: <English
    name>"; a name the taxonomy can't be read for keeps what media.json had."""
    out = {}
    entries = os.path.join(folder, "entries")
    for name in sorted(os.listdir(entries)) if os.path.isdir(entries) else []:
        if not name.endswith(".txt"):
            continue
        with open(os.path.join(entries, name), encoding="utf-8-sig") as fh:
            for line in fh:
                m = re.match(r"@photo\s+(.*)$", line.rstrip())
                if not m:
                    continue
                parts = [p.strip() for p in m.group(1).split("|")]
                bird = next((re.sub(r"^bird\s*:\s*", "", p, flags=re.I) for p in parts[1:]
                             if re.match(r"bird\s*:", p, re.I)), "")
                if not bird:
                    continue
                key = parts[0]
                names = bird_names(bird) or (old.get(key) if isinstance(old.get(key), dict) else None)
                if names:
                    out[key] = names
                else:
                    print("  {}: no eBird species called {!r}".format(name, bird))
    return out


def all_journal_shapes():
    """journal_shapes() for every journals/<trip>/; a line for the report."""
    root = os.path.join(ROOT, "journals")
    done = []
    if os.path.isdir(root):
        for trip in sorted(os.listdir(root)):
            folder = os.path.join(root, trip)
            if os.path.isfile(os.path.join(folder, "journal.json")):
                n, changed = journal_shapes(folder)
                done.append("{} {}{}".format(trip, n, " (written)" if changed else ""))
    return ", ".join(done) or "none"


def main():
    ap = argparse.ArgumentParser(description="Rebuild data/photos.json from images/")
    ap.add_argument("--no-thumbs", action="store_true", help="skip thumbnails (also drops variants from photos.json; do not commit)")
    ap.add_argument("--force", action="store_true", help="write even if no photos found")
    ap.add_argument("--allow-removals", action="store_true",
                    help="drop photographs whose files are no longer under images/")
    args = ap.parse_args()

    collections = load_collections()
    stamps = asset_stamps()
    roots = stamp_root_pages(stamps)
    pages = write_pages(collections, stamps)

    before = load_existing()
    photos = collect(make_thumbs=not args.no_thumbs)
    if not photos and not args.force:
        print("No photographs found under images/<collection>/.")
        print("Add some, or pass --force to write an empty gallery.")
        return 1

    # images/ is not in git (the photographs live in Cloudflare R2), so on a
    # machine where a folder is missing, a collection would quietly leave the
    # site on the next build. A photograph only leaves the manifest when asked.
    kept = {p["src"] for p in photos}
    gone = [src for src in before if src not in kept]
    if gone and not args.allow_removals:
        print("{} photograph(s) in data/photos.json have no file under images/, e.g.:".format(len(gone)))
        for src in gone[:10]:
            print("  " + src)
        print("Nothing was written to data/photos.json. If they were removed on purpose, run")
        print("again with --allow-removals. If images/ is just incomplete on this machine,")
        print("fetch them back from R2 with: python3 tools/upload.py --download")
        return 1

    known = {c.get("slug") for c in collections}
    orphans = sorted({p["collection"] for p in photos} - known)

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(MANIFEST, "w", encoding="utf-8") as fh:
        json.dump({"photos": photos}, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    counts = {}
    for p in photos:
        counts[p["collection"]] = counts.get(p["collection"], 0) + 1
    print("photos.json: {} photograph(s) — {}".format(
        len(photos), ", ".join("{} {}".format(v, k) for k, v in sorted(counts.items()))))
    print("collection pages: {} written, {} unchanged".format(pages, len(collections) - pages))
    print("journal media shapes: " + all_journal_shapes())
    print("asset stamps: {} — {} root page(s) restamped".format(
        " ".join("{}={}".format(k, v) for k, v in sorted(stamps.items())), roots))
    if orphans:
        print("\nWarning: these image folders have no entry in data/collections.json,")
        print("so they won't appear on the home page: {}".format(", ".join(orphans)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
