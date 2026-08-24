#!/usr/bin/env python3
"""Scan images/ and regenerate data/photos.json + the per-collection pages.

Usage
-----
    python3 tools/build.py              # scan, make thumbnails, write manifest
    python3 tools/build.py --no-thumbs
    python3 tools/build.py --force      # allow writing an empty manifest

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
THUMB_LONG_EDGE = 1200

# Fields a human may edit; never overwritten once set.
AUTHORED_FIELDS = ("title", "location", "date", "caption", "collection", "featured")


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


def make_thumb(src_abs, rel_path):
    """Downscale with macOS `sips`. Returns a repo-relative path, or None."""
    if not shutil.which("sips") or src_abs.lower().endswith(".svg"):
        return None
    thumb_abs = os.path.join(THUMB_DIR, rel_path)
    os.makedirs(os.path.dirname(thumb_abs), exist_ok=True)

    if (os.path.exists(thumb_abs)
            and os.path.getmtime(thumb_abs) >= os.path.getmtime(src_abs)):
        return os.path.relpath(thumb_abs, ROOT).replace(os.sep, "/")
    try:
        subprocess.run(["sips", "-Z", str(THUMB_LONG_EDGE), src_abs, "--out", thumb_abs],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except (subprocess.CalledProcessError, OSError):
        return None
    return os.path.relpath(thumb_abs, ROOT).replace(os.sep, "/")


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
<meta name="theme-color" content="#ffffff">
<link rel="stylesheet" href="../../assets/site.css">
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
    </figcaption>
  </figure>
</div>

<script src="../../assets/site.js"></script>
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


def write_pages(collections):
    """One stub page per collection. Rewritten every run — don't hand-edit."""
    written = 0
    for c in collections:
        slug = c.get("slug")
        if not slug:
            continue
        out_dir = os.path.join(PAGES_DIR, slug)
        os.makedirs(out_dir, exist_ok=True)
        html = PAGE_TEMPLATE.format(slug=slug, title=c.get("title", slug))
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
                thumb = make_thumb(abs_path, "{}/{}".format(slug, name))
                if thumb:
                    entry["thumb"] = thumb

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


def main():
    ap = argparse.ArgumentParser(description="Rebuild data/photos.json from images/")
    ap.add_argument("--no-thumbs", action="store_true", help="skip thumbnail generation")
    ap.add_argument("--force", action="store_true", help="write even if no photos found")
    args = ap.parse_args()

    collections = load_collections()
    pages = write_pages(collections)

    photos = collect(make_thumbs=not args.no_thumbs)
    if not photos and not args.force:
        print("No photographs found under images/<collection>/.")
        print("Add some, or pass --force to write an empty gallery.")
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
    if orphans:
        print("\nWarning: these image folders have no entry in data/collections.json,")
        print("so they won't appear on the home page: {}".format(", ".join(orphans)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
