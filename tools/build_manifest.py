#!/usr/bin/env python3
"""Scan images/ and (re)generate photos.json for the portfolio.

Usage
-----
    python3 tools/build_manifest.py            # scan, build thumbs, write manifest
    python3 tools/build_manifest.py --no-thumbs
    python3 tools/build_manifest.py --force    # allow writing an empty manifest

How photos are organised
------------------------
Drop web-sized JPEGs into a category folder under images/:

    images/birds/Snowy Owl_Amherst Island ON_2026-01-12.jpg
    images/landscape/First Light_Denali AK_2025-09-03.jpg

The folder name becomes the category (the filter buttons on the site). The
filename is read as up to three underscore-separated fields:

    <Title>_<Location>_<YYYY-MM-DD>.jpg

Location and date are both optional — "Snowy Owl.jpg" works fine, and any
missing date falls back to the EXIF capture date. Folders beginning with "_"
or "." are skipped, which is how images/_thumbs and images/_placeholders stay
out of the gallery.

Hand edits are preserved
------------------------
Anything you correct by hand in photos.json — a title, a location, a caption —
survives re-runs. Only the mechanical fields (dimensions, EXIF, thumbnail
path) are refreshed from the file. Delete an entry's field to have it
re-derived.

Dependencies: none. Standard library only, plus macOS's built-in `sips` for
thumbnails (skipped automatically if it isn't available).
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
MANIFEST = os.path.join(ROOT, "photos.json")

EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp")
THUMB_LONG_EDGE = 1200

# Fields the user may edit by hand; never overwritten once present.
AUTHORED_FIELDS = ("title", "location", "date", "caption", "category", "featured")


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
        # Markers may be padded with any number of 0xFF bytes.
        marker = fh.read(1)
        while marker == b"\xff":
            marker = fh.read(1)
        if not marker:
            return None
        code = marker[0]
        # Standalone markers carry no length payload.
        if code in (0xD8, 0x01) or 0xD0 <= code <= 0xD7:
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
    if len(data) < 24:
        return None
    return struct.unpack(">II", data[16:24])


def webp_size(data):
    """Handles the three WebP flavours: lossy (VP8), lossless (VP8L), VP8X."""
    if len(data) < 30 or data[12:16] not in (b"VP8 ", b"VP8L", b"VP8X"):
        return None
    kind = data[12:16]
    if kind == b"VP8 ":
        return (struct.unpack("<H", data[26:28])[0] & 0x3FFF,
                struct.unpack("<H", data[28:30])[0] & 0x3FFF)
    if kind == b"VP8L":
        bits = struct.unpack("<I", data[21:25])[0]
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    # VP8X stores dimensions minus one as two 24-bit little-endian ints.
    w = data[24] | (data[25] << 8) | (data[26] << 16)
    h = data[27] | (data[28] << 8) | (data[29] << 16)
    return w + 1, h + 1


def read_size(path):
    try:
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
    except (OSError, struct.error):
        pass
    return None


# --------------------------------------------------------------------------
# EXIF
# --------------------------------------------------------------------------

TYPE_SIZES = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8}

IFD0_TAGS = {0x010F: "make", 0x0110: "model", 0x0112: "orientation", 0x8769: "_exif_ptr"}
EXIF_TAGS = {
    0x829A: "exposure_time",
    0x829D: "fnumber",
    0x8827: "iso",
    0x9003: "date_taken",
    0x920A: "focal_length",
    0xA405: "focal_35mm",
    0xA434: "lens",
}


def _read_ifd(blob, offset, endian, wanted):
    """Read one IFD, returning {name: value} for tags present in `wanted`."""
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
        if typ == 2:                                   # ASCII
            out[name] = raw.split(b"\x00")[0].decode("utf-8", "replace").strip()
        elif typ == 3:                                 # SHORT
            out[name] = struct.unpack(endian + "H", raw[:2])[0]
        elif typ == 4:                                 # LONG
            out[name] = struct.unpack(endian + "I", raw[:4])[0]
        elif typ in (5, 10):                           # (S)RATIONAL
            fmt = endian + ("ii" if typ == 10 else "II")
            num, den = struct.unpack(fmt, raw[:8])
            out[name] = (num / den) if den else 0.0
    return out


def read_exif(path):
    """Best-effort EXIF read. Returns {} for anything it can't parse."""
    if not path.lower().endswith((".jpg", ".jpeg")):
        return {}
    try:
        with open(path, "rb") as fh:
            data = fh.read(256 * 1024)   # EXIF lives near the front of the file
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
        ifd0_off = struct.unpack(endian + "I", tiff[4:8])[0]
        fields = _read_ifd(tiff, ifd0_off, endian, IFD0_TAGS)
        if "_exif_ptr" in fields:
            fields.update(_read_ifd(tiff, fields.pop("_exif_ptr"), endian, EXIF_TAGS))
    except (struct.error, IndexError):
        return {}
    return fields


def format_exif(fields):
    """Turn raw EXIF values into the strings the site displays."""
    out = {}

    make = (fields.get("make") or "").strip()
    model = (fields.get("model") or "").strip()
    # "NIKON CORPORATION" + "NIKON Z 9" shouldn't render as "NIKON NIKON Z 9".
    if model and make and model.upper().startswith(make.split()[0].upper()):
        out["camera"] = model
    elif make or model:
        out["camera"] = (make + " " + model).strip()

    lens = (fields.get("lens") or "").strip()
    if lens and lens.lower() not in ("----", "unknown"):
        out["lens"] = lens

    focal = fields.get("focal_length")
    if focal:
        out["focal"] = "{:g}mm".format(round(focal))

    fnum = fields.get("fnumber")
    if fnum:
        out["aperture"] = "f/{:g}".format(round(fnum, 1))

    shutter = fields.get("exposure_time")
    if shutter:
        out["shutter"] = ("{:g}s".format(round(shutter, 1)) if shutter >= 1
                          else "1/{:g}s".format(round(1 / shutter)))

    iso = fields.get("iso")
    if iso:
        out["iso"] = str(iso)

    return out


# --------------------------------------------------------------------------
# Filenames
# --------------------------------------------------------------------------

def parse_filename(stem):
    """'Snowy Owl_Amherst Island ON_2026-01-12' -> title, location, date."""
    parts = [p.strip() for p in stem.split("_")]
    title = parts[0] if parts else stem
    location = ""
    date = ""

    for part in parts[1:]:
        if re.match(r"^\d{4}-\d{2}-\d{2}$", part):
            date = part
        elif part and not location:
            location = part

    # Tolerate hyphen-and-dash filenames straight out of a camera or export.
    if title and title.lower() == title:
        title = re.sub(r"[-]+", " ", title)
        title = " ".join(w.capitalize() for w in title.split())

    return title.strip(), location, date


# --------------------------------------------------------------------------
# Thumbnails
# --------------------------------------------------------------------------

def make_thumb(src_abs, rel_path):
    """Downscale via macOS `sips`. Returns a site-relative path, or None."""
    if not shutil.which("sips"):
        return None

    thumb_abs = os.path.join(THUMB_DIR, rel_path)
    os.makedirs(os.path.dirname(thumb_abs), exist_ok=True)

    if (os.path.exists(thumb_abs)
            and os.path.getmtime(thumb_abs) >= os.path.getmtime(src_abs)):
        return os.path.relpath(thumb_abs, ROOT).replace(os.sep, "/")

    try:
        subprocess.run(
            ["sips", "-Z", str(THUMB_LONG_EDGE), src_abs, "--out", thumb_abs],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    except (subprocess.CalledProcessError, OSError):
        return None
    return os.path.relpath(thumb_abs, ROOT).replace(os.sep, "/")


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def load_existing():
    """Existing entries keyed by src, so hand edits survive a rebuild."""
    if not os.path.exists(MANIFEST):
        return {}
    try:
        with open(MANIFEST, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return {}
    return {p["src"]: p for p in data.get("photos", []) if p.get("src")}


def collect(make_thumbs=True):
    photos = []
    existing = load_existing()

    if not os.path.isdir(IMAGE_DIR):
        return photos

    for category in sorted(os.listdir(IMAGE_DIR)):
        cat_dir = os.path.join(IMAGE_DIR, category)
        if not os.path.isdir(cat_dir) or category.startswith(("_", ".")):
            continue

        for name in sorted(os.listdir(cat_dir)):
            if not name.lower().endswith(EXTENSIONS) or name.startswith("."):
                continue

            abs_path = os.path.join(cat_dir, name)
            rel = "images/{}/{}".format(category, name)
            stem = os.path.splitext(name)[0]

            title, location, date = parse_filename(stem)
            raw_exif = read_exif(abs_path)

            if not date and raw_exif.get("date_taken"):
                # EXIF dates are "YYYY:MM:DD HH:MM:SS".
                m = re.match(r"^(\d{4}):(\d{2}):(\d{2})", raw_exif["date_taken"])
                if m:
                    date = "{}-{}-{}".format(*m.groups())

            size = read_size(abs_path)
            width, height = size if size else (0, 0)
            # Rotated originals report their pre-rotation dimensions.
            if raw_exif.get("orientation") in (5, 6, 7, 8):
                width, height = height, width

            entry = {
                "src": rel,
                "title": title,
                "category": category,
                "location": location,
                "date": date,
                "width": width,
                "height": height,
                "exif": format_exif(raw_exif),
            }

            if make_thumbs:
                thumb = make_thumb(abs_path, "{}/{}".format(category, name))
                if thumb:
                    entry["thumb"] = thumb

            # Hand-authored values win.
            prior = existing.get(rel, {})
            for field in AUTHORED_FIELDS:
                if prior.get(field):
                    entry[field] = prior[field]

            photos.append(entry)

    # Newest first; undated photos sink to the bottom rather than the top.
    photos.sort(key=lambda p: (p.get("date") or "0000-00-00", p["src"]), reverse=True)
    return photos


def main():
    ap = argparse.ArgumentParser(description="Rebuild photos.json from images/")
    ap.add_argument("--no-thumbs", action="store_true",
                    help="skip thumbnail generation")
    ap.add_argument("--force", action="store_true",
                    help="write the manifest even if no photos were found")
    args = ap.parse_args()

    photos = collect(make_thumbs=not args.no_thumbs)

    if not photos and not args.force:
        print("No photographs found under images/<category>/.")
        print("Add some (e.g. images/birds/Snowy Owl_Amherst Island ON_2026-01-12.jpg),")
        print("or pass --force to overwrite photos.json with an empty gallery.")
        return 1

    with open(MANIFEST, "w", encoding="utf-8") as fh:
        json.dump({"photos": photos}, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    by_cat = {}
    for p in photos:
        by_cat[p["category"]] = by_cat.get(p["category"], 0) + 1
    summary = ", ".join("{} {}".format(v, k) for k, v in sorted(by_cat.items()))
    print("Wrote photos.json — {} photograph(s): {}".format(len(photos), summary))
    return 0


if __name__ == "__main__":
    sys.exit(main())
