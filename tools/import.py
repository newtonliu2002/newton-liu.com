#!/usr/bin/env python3
"""Bring a folder of exports into the site at a web-safe size.

    python3 tools/import.py ~/Desktop/"2025.12 West JPEG" --collection west
    python3 tools/import.py <dir> --collection west --dry-run
    python3 tools/import.py <dir> --collection west --strip-exif

Why this exists: full-resolution masters must never be committed. Git keeps
every version forever and the repo has a 1 GB soft limit, so a single 200 MB
trip folder is a permanent tax. This resizes to a long edge that still looks
sharp on a retina display (4000px by default) and leaves your masters alone —
the source folder is only ever read.

4000px is chosen so that even a full-width photograph on a 5K display is drawn
from real pixels rather than invented ones. It is deliberately generous: the
site never serves these files to a phone, because build.py derives smaller
widths from them and the browser picks. See "Sizes on the page" in CLAUDE.md.

It also refuses to import a photograph carrying GPS coordinates unless you
pass --strip-exif or --allow-gps. Precise locations for nests, roosts and
rarities should not be published, and this is the last place to catch it.

Afterwards, run tools/build.py to regenerate the manifest.

Requires macOS's built-in `sips`. No other dependencies.
"""

import argparse
import os
import re
import shutil
import struct
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMAGE_DIR = os.path.join(ROOT, "images")

SOURCE_EXT = (".jpg", ".jpeg", ".png", ".tif", ".tiff", ".heic")
DEFAULT_LONG_EDGE = 4000
DEFAULT_QUALITY = 85


def has_gps(path):
    """True if the JPEG's IFD0 carries a GPSInfo pointer (tag 0x8825)."""
    try:
        with open(path, "rb") as fh:
            data = fh.read(300 * 1024)
    except OSError:
        return False

    marker = data.find(b"\xff\xe1")
    if marker < 0 or data[marker + 4:marker + 10] != b"Exif\x00\x00":
        return False
    tiff = data[marker + 10:]
    if len(tiff) < 8:
        return False
    endian = "<" if tiff[:2] == b"II" else ">" if tiff[:2] == b"MM" else None
    if endian is None:
        return False
    try:
        offset = struct.unpack(endian + "I", tiff[4:8])[0]
        count = struct.unpack(endian + "H", tiff[offset:offset + 2])[0]
        for i in range(count):
            tag = struct.unpack(endian + "H", tiff[offset + 2 + i * 12:offset + 4 + i * 12])[0]
            if tag == 0x8825:
                return True
    except (struct.error, IndexError):
        pass
    return False


def strip_exif(path):
    """Drop every APP1 segment, removing all EXIF.

    Blunt on purpose: this is the safe option, not the clever one. Camera and
    lens details are lost along with the coordinates, so only reach for it
    when a file genuinely carries GPS you don't want published.
    """
    try:
        with open(path, "rb") as fh:
            data = fh.read()
    except OSError:
        return False

    if data[:2] != b"\xff\xd8":
        return False

    out = bytearray(data[:2])
    i = 2
    while i < len(data) - 1:
        if data[i] != 0xFF:
            out.extend(data[i:])                 # entropy-coded data; copy the rest
            break
        marker = data[i + 1]
        if marker == 0xDA:                       # start of scan — image data follows
            out.extend(data[i:])
            break
        if i + 4 > len(data):
            out.extend(data[i:])
            break
        length = struct.unpack(">H", data[i + 2:i + 4])[0]
        if marker != 0xE1:                       # keep everything except APP1
            out.extend(data[i:i + 2 + length])
        i += 2 + length

    with open(path, "wb") as fh:
        fh.write(bytes(out))
    return True


def slugify(stem):
    """Camera filenames make dreadful titles, but they must stay unique."""
    stem = re.sub(r"[-_]?edit[-_]?", "", stem, flags=re.I)   # drop Lightroom's suffix
    stem = re.sub(r"[^A-Za-z0-9]+", "-", stem).strip("-")
    return stem or "photo"


def resize(src, dst, long_edge, quality):
    subprocess.run(
        ["sips", "-Z", str(long_edge),
         "--setProperty", "format", "jpeg",
         "--setProperty", "formatOptions", str(quality),
         src, "--out", dst],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


def main():
    ap = argparse.ArgumentParser(description="Import exports into images/<collection>/")
    ap.add_argument("source", help="folder of exported photographs")
    ap.add_argument("--collection", required=True, help="target collection slug")
    ap.add_argument("--long-edge", type=int, default=DEFAULT_LONG_EDGE)
    ap.add_argument("--quality", type=int, default=DEFAULT_QUALITY)
    ap.add_argument("--strip-exif", action="store_true",
                    help="remove all EXIF from imported copies")
    ap.add_argument("--allow-gps", action="store_true",
                    help="import files carrying GPS coordinates anyway")
    ap.add_argument("--overwrite", action="store_true",
                    help="re-import files that are already present")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not shutil.which("sips"):
        print("sips not found — this tool needs macOS.")
        return 1

    source = os.path.expanduser(args.source)
    if not os.path.isdir(source):
        print("Not a folder: {}".format(source))
        return 1

    dest = os.path.join(IMAGE_DIR, args.collection)
    names = sorted(n for n in os.listdir(source)
                   if n.lower().endswith(SOURCE_EXT) and not n.startswith("."))
    if not names:
        print("No images found in {}".format(source))
        return 1

    flagged = [n for n in names if has_gps(os.path.join(source, n))]
    if flagged and not (args.strip_exif or args.allow_gps):
        print("{} of {} files carry GPS coordinates:".format(len(flagged), len(names)))
        for n in flagged[:10]:
            print("   {}".format(n))
        if len(flagged) > 10:
            print("   ... and {} more".format(len(flagged) - 10))
        print("\nRe-run with --strip-exif to remove all metadata from the copies,")
        print("or --allow-gps if publishing these coordinates is genuinely fine.")
        return 1

    if not args.dry_run:
        os.makedirs(dest, exist_ok=True)

    imported = skipped = 0
    total_in = total_out = 0

    for name in names:
        src = os.path.join(source, name)
        out_name = slugify(os.path.splitext(name)[0]) + ".jpg"
        dst = os.path.join(dest, out_name)

        if os.path.exists(dst) and not args.overwrite:
            skipped += 1
            continue

        in_size = os.path.getsize(src)
        total_in += in_size

        if args.dry_run:
            print("{:>10}  {}  ->  images/{}/{}".format(
                "{:.1f} MB".format(in_size / 1e6), name, args.collection, out_name))
            imported += 1
            continue

        try:
            resize(src, dst, args.long_edge, args.quality)
        except subprocess.CalledProcessError:
            print("  failed: {}".format(name))
            continue

        if args.strip_exif:
            strip_exif(dst)

        out_size = os.path.getsize(dst)
        total_out += out_size
        imported += 1
        print("{:>9} -> {:>8}  {}".format(
            "{:.1f} MB".format(in_size / 1e6),
            "{:.0f} KB".format(out_size / 1e3), out_name))

    print()
    if args.dry_run:
        print("Dry run — {} file(s) would be imported, nothing written.".format(imported))
        return 0

    print("Imported {} file(s){}.".format(
        imported, ", skipped {} already present".format(skipped) if skipped else ""))
    if total_out:
        print("{:.0f} MB of masters -> {:.1f} MB committed ({:.0f}x smaller).".format(
            total_in / 1e6, total_out / 1e6, total_in / max(total_out, 1)))
    print("\nNext: python3 tools/build.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
