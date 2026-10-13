#!/usr/bin/env python3
"""Put the site's photographs in Cloudflare R2, and prove they are there.

    python3 tools/upload.py              # upload whatever R2 doesn't have yet
    python3 tools/upload.py --dry-run    # say what would go up; upload nothing
    python3 tools/upload.py --check      # is everything the site shows in R2? exit 1 if not
    python3 tools/upload.py --verify     # ask R2 about every file, ignoring the local record
    python3 tools/upload.py --download   # fetch files missing from images/ back from R2

Why this exists: GitHub Pages refuses a site over 1 GB, and the photographs
alone reached that in October 2026. So images/ is no longer in git (only
images/_about/ is, for the About page). The photographs live in the R2 bucket
`newton-liu-photos`, each stored under its repo path, and the live site reads
them from R2's public address — the `R2` constant in assets/site.js, which this
script reads too, so the address is written down in exactly one place. The
local preview still reads images/ on disk.

The files are exactly the ones the site asks for: every photograph's original
and smaller widths in data/photos.json, and any collection `cover` in
data/collections.json. So run tools/build.py first.

"In R2" means R2 answers a HEAD for the file's public URL with an ETag equal
to the local file's MD5: the same bytes, not merely the same name. Files that
pass are remembered in .r2-uploaded.json (not committed), so the next run asks
only about new or changed files. --verify, or deleting that file, starts again
from R2's own answers. A file missing from images/ (a checkout without the
photographs) counts as in R2 if R2 has it, though it can't be compared.

Uploads go through Cloudflare's own `wrangler` CLI, signed in once with
`npx wrangler login` (a browser sign-in Newton approves himself). No key or
token is stored in this repo or handled by this script.

The GPS check from tools/import.py runs again on every file before it leaves
the machine. Precise locations for nests, roosts and rarities must not be
published; pass --allow-gps only for a photograph meant to carry them.

Standard library only, plus wrangler (via npx) for uploading.
"""

import argparse
import hashlib
import http.client
import importlib.util
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, "data", "photos.json")
COLLECTIONS = os.path.join(ROOT, "data", "collections.json")
SITE_JS = os.path.join(ROOT, "assets", "site.js")
RECORD = os.path.join(ROOT, ".r2-uploaded.json")

BUCKET = "newton-liu-photos"
# A day in browsers. A photograph replaced under the same name can therefore
# show its old version for up to a day to someone who has already seen it.
CACHE_CONTROL = "public, max-age=86400"
CONTENT_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
                 ".webp": "image/webp", ".svg": "image/svg+xml"}

# Cloudflare's API allows about 1,200 requests per five minutes, and each
# upload is a handful of them, so uploads go three at a time. The public
# r2.dev address is rate-limited too, so questions and downloads go four at a
# time.
UPLOAD_WORKERS = 3
HTTP_WORKERS = 4

# wrangler puts the key into its API URL unencoded, so these would be stored
# under a different key from the one the site asks for. Refuse them up front.
UNSAFE_KEY = re.compile(r"[#?%\\\x00-\x1f\x7f]")

TRANSIENT = (429, 500, 502, 503, 504)
NETWORK_ERRORS = (urllib.error.URLError, http.client.HTTPException, OSError)

STOP = threading.Event()        # set on Ctrl-C, or when uploads plainly can't work


def load_has_gps():
    # "import" is a keyword, so tools/import.py can't be imported by name.
    spec = importlib.util.spec_from_file_location(
        "site_import", os.path.join(ROOT, "tools", "import.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.has_gps


def public_base():
    with open(SITE_JS, "r", encoding="utf-8") as fh:
        m = re.search(r'var R2 = "(https://[^"]+/)";', fh.read())
    if not m:
        sys.exit("Couldn't find `var R2 = \"https://.../\";` in assets/site.js.")
    return m.group(1)


def referenced(manifest, collections):
    """Every file the site asks for, in order, without repeats."""
    with open(manifest, "r", encoding="utf-8") as fh:
        photos = json.load(fh).get("photos", [])
    keys = []
    for p in photos:
        keys.append(p.get("src"))
        keys.append(p.get("thumb"))
        keys.extend(v.get("src") for v in p.get("variants", []))
    try:
        with open(collections, "r", encoding="utf-8") as fh:
            keys.extend(c.get("cover") for c in json.load(fh).get("collections", []))
    except (OSError, ValueError):
        pass
    seen = set()
    return [k for k in keys if k and not (k in seen or seen.add(k))]


def md5_of(path):
    h = hashlib.md5()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def load_record():
    try:
        with open(RECORD, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def save_record(record):
    tmp = RECORD + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(record, fh, indent=0, sort_keys=True, ensure_ascii=False)
        fh.write("\n")
    os.replace(tmp, RECORD)


def last_words(text, limit=400):
    """The end of a tool's output, without colour codes, for an error message."""
    text = re.sub(r"\x1b\[[0-9;]*m", "", text or "").strip()
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    return " / ".join(lines[-4:])[-limit:] or "(no output)"


# --------------------------------------------------------------------------
# Asking the public address


def url_for(base, key, bust=None):
    # Same encoding as url() in site.js: each path segment on its own, with
    # everything but letters, digits and _.-~ percent-encoded.
    path = "/".join(urllib.parse.quote(seg, safe="") for seg in key.split("/"))
    return base + path + ("?v=" + bust if bust else "")


def head(base, key, bust):
    """(HTTP status, ETag) for one key; status 0 means no clear answer.
    `bust` keeps any cache out of it."""
    req = urllib.request.Request(url_for(base, key, bust), method="HEAD",
                                 headers={"User-Agent": "newton-liu.com upload.py",
                                          "Cache-Control": "no-cache"})
    for attempt in range(4):
        if attempt:
            time.sleep(2 * attempt)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.status, (resp.headers.get("ETag") or "").strip('"')
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return 404, None
            if exc.code not in TRANSIENT:
                return exc.code, None
        except NETWORK_ERRORS:
            pass
    return 0, None


def ask_r2(base, keys, digests):
    """{key: (status, etag)} for every key. One question first: if R2 can't be
    reached at all, say so now rather than after every key has timed out."""
    if not keys:
        return {}
    first = head(base, keys[0], digests.get(keys[0]))
    if first[0] == 0:
        return {k: (0, None) for k in keys}
    with ThreadPoolExecutor(HTTP_WORKERS) as pool:
        rest = pool.map(lambda k: head(base, k, digests.get(k)), keys[1:])
        return dict(zip(keys, [first] + list(rest)))


# --------------------------------------------------------------------------
# Uploading


def wrangler_cmd():
    custom = os.environ.get("WRANGLER")
    if custom:
        return shlex.split(custom)
    if shutil.which("wrangler"):
        return ["wrangler"]
    npx = shutil.which("npx") or os.path.expanduser("~/.local/node/bin/npx")
    if not os.path.exists(npx):
        sys.exit("Couldn't find wrangler or npx. Install Node, then: npx wrangler login")
    return [npx, "--yes", "wrangler@4"]


def sign_in_problem(cmd):
    """None if wrangler is signed in; "signed out" if it says so; otherwise
    what went wrong, in its own words (offline, npx failing, ...)."""
    try:
        # The first run on a machine downloads wrangler (~200 MB) before it
        # can answer, hence the long wait.
        out = subprocess.run(cmd + ["whoami"], cwd=ROOT, capture_output=True,
                             text=True, timeout=900)
    except subprocess.TimeoutExpired:
        return "wrangler didn't answer within 15 minutes; check the network."
    except OSError as exc:
        return str(exc)
    text = out.stdout + out.stderr
    if out.returncode == 0 and "You are logged in" in text:
        return None
    if "not authenticated" in text.lower():
        return "signed out"
    return last_words(text)


def put(cmd, key, path):
    """Upload one file. None on success, otherwise why not."""
    ctype = CONTENT_TYPES.get(os.path.splitext(key)[1].lower(), "application/octet-stream")
    args = cmd + ["r2", "object", "put", BUCKET + "/" + key, "--file", path,
                  "--remote", "--content-type", ctype,
                  "--cache-control", CACHE_CONTROL]
    why = "not attempted"
    for attempt in range(3):
        if attempt and STOP.wait(10 * attempt):      # wakes early on Ctrl-C
            return "stopped"
        if STOP.is_set():
            return "stopped"
        try:
            done = subprocess.run(args, cwd=ROOT, capture_output=True, text=True,
                                  timeout=300)
        except subprocess.TimeoutExpired:
            why = "wrangler took more than 5 minutes"
            continue
        except OSError as exc:
            return str(exc)
        if done.returncode == 0:
            return None
        if done.returncode < 0 or done.returncode == 130:   # killed, e.g. by Ctrl-C
            return "interrupted"
        why = last_words(done.stderr or done.stdout)
    return why


# --------------------------------------------------------------------------
# Downloading (a fresh clone, or a lost images/ folder)


def download(base, keys):
    failed = []

    def fetch(key):
        dest = os.path.join(ROOT, key)
        req = urllib.request.Request(url_for(base, key),
                                     headers={"User-Agent": "newton-liu.com upload.py"})
        for attempt in range(4):
            if attempt:
                time.sleep(3 * attempt)
            try:
                with urllib.request.urlopen(req, timeout=120) as resp:
                    data = resp.read()
                    etag = (resp.headers.get("ETag") or "").strip('"')
            except urllib.error.HTTPError as exc:
                if exc.code in TRANSIENT:
                    continue
                break
            except NETWORK_ERRORS:
                continue
            if etag and hashlib.md5(data).hexdigest() != etag:
                continue
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest + ".part", "wb") as fh:
                fh.write(data)
            os.replace(dest + ".part", dest)
            return
        failed.append(key)

    with ThreadPoolExecutor(HTTP_WORKERS) as pool:
        list(pool.map(fetch, keys))
    # build.py remakes a smaller width whenever it is older than its original.
    # The downloads finished in no particular order, so make every smaller
    # width newer than every original, or the next build would redo them all.
    now = time.time()
    for key in keys:
        if key.startswith("images/_thumbs/") and key not in failed:
            os.utime(os.path.join(ROOT, key), (now, now))
    return failed


# --------------------------------------------------------------------------


def main():
    ap = argparse.ArgumentParser(description="Upload the site's photographs to Cloudflare R2")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="list what would be uploaded")
    mode.add_argument("--check", action="store_true",
                      help="exit 1 if anything the site uses is not in R2; uploads nothing")
    mode.add_argument("--verify", action="store_true",
                      help="ask R2 about every file, ignoring .r2-uploaded.json; uploads nothing")
    mode.add_argument("--download", action="store_true",
                      help="fetch files missing from images/ back from R2")
    ap.add_argument("--allow-gps", action="store_true",
                    help="upload photographs that carry GPS coordinates")
    ap.add_argument("--manifest", default=MANIFEST, help=argparse.SUPPRESS)
    ap.add_argument("--collections", default=COLLECTIONS, help=argparse.SUPPRESS)
    args = ap.parse_args()

    base = public_base()
    keys = referenced(args.manifest, args.collections)
    absent = [k for k in keys if not os.path.isfile(os.path.join(ROOT, k))]

    if args.download:
        if not absent:
            print("images/ already has all {} file(s) the site uses.".format(len(keys)))
            return 0
        print("Fetching {} file(s) from R2…".format(len(absent)))
        failed = download(base, absent)
        print("fetched {}, failed {}".format(len(absent) - len(failed), len(failed)))
        for key in failed[:20]:
            print("  failed: " + key)
        return 1 if failed else 0

    unsafe = [k for k in keys if UNSAFE_KEY.search(k)]
    if unsafe:
        print("These filenames contain # ? % or \\, which can't be uploaded intact. Rename them:")
        for key in unsafe[:20]:
            print("  " + key)
        return 1

    record = load_record()

    # Not on this disk: fine if R2 has it (it just can't be compared byte for
    # byte); otherwise there is nothing to upload it from.
    if absent:
        ask = absent if args.verify else [k for k in absent if k not in record]
        answers = ask_r2(base, ask, {})
        lost = [k for k in ask if answers[k][0] != 200]
        if lost:
            print("{} file(s) the site uses are neither in images/ nor in R2, e.g.:".format(len(lost)))
            for key in lost[:10]:
                print("  " + key)
            if any(answers[k][0] == 0 for k in lost):
                print("(R2 couldn't be reached for some of them; the network may be down.)")
            print("Run tools/build.py if photographs were removed on purpose, or re-import them.")
            return 1

    absent_set = set(absent)
    present = [k for k in keys if k not in absent_set]
    digests = {k: md5_of(os.path.join(ROOT, k)) for k in present}
    unknown = present if args.verify else [k for k in present if record.get(k) != digests[k]]

    answers = ask_r2(base, unknown, digests)
    for key, (status, etag) in answers.items():
        if status == 200 and etag == digests[key]:
            record[key] = digests[key]
        elif args.verify:
            record.pop(key, None)
    save_record(record)

    need = [k for k in unknown if record.get(k) != digests[k]]
    unreachable = [k for k in need if answers[k][0] not in (200, 404)]
    replacing = [k for k in need if answers[k][0] == 200]

    if args.check or args.verify:
        if not need:
            print("All {} file(s) the site uses are in R2.".format(len(keys)))
            return 0
        print("{} of {} file(s) the site uses aren't in R2 (or differ), e.g.:".format(
            len(need), len(keys)))
        for key in need[:10]:
            print("  " + key)
        if unreachable:
            print("({} of those got no clear answer from R2; the network may be down.)".format(
                len(unreachable)))
        print("Upload them with: python3 tools/upload.py")
        return 1

    if not need:
        print("Nothing to upload: all {} file(s) the site uses are in R2.".format(len(keys)))
        return 0

    if unreachable and len(unreachable) == len(need):
        print("Couldn't reach R2's public address, so nothing was uploaded. "
              "Check the network and run this again.")
        return 1

    if not args.allow_gps:
        has_gps = load_has_gps()
        located = [k for k in need if has_gps(os.path.join(ROOT, k))]
        if located:
            print("Refusing to upload {} file(s) carrying GPS coordinates:".format(len(located)))
            for key in located[:20]:
                print("  " + key)
            print("Re-export them without location data (Lightroom: Export > Metadata > "
                  "Remove Location Info), or pass --allow-gps if they are meant to be public.")
            return 1

    total = sum(os.path.getsize(os.path.join(ROOT, k)) for k in need)
    print("{} file(s) to upload, {:.1f} MB{}".format(
        len(need), total / 1e6,
        "" if not replacing else " ({} replace an older version)".format(len(replacing))))
    for key in need[:10]:
        print("  " + key)
    if len(need) > 10:
        print("  … and {} more".format(len(need) - 10))
    if args.dry_run:
        return 0

    cmd = wrangler_cmd()
    problem = sign_in_problem(cmd)
    if problem == "signed out":
        print("wrangler isn't signed in to Cloudflare. Newton runs this and approves it "
              "in the browser, then run upload.py again:\n  npx wrangler login")
        return 2
    if problem:
        print("Couldn't ask wrangler who is signed in, so nothing was uploaded:\n  " + problem)
        return 2

    lock = threading.Lock()
    failed = []
    reasons = set()
    tally = {"done": 0, "ok": 0}

    def one(key):
        why = put(cmd, key, os.path.join(ROOT, key))
        if why is None:
            # wrangler reported success; believe R2's own answer, not wrangler's.
            status, etag = head(base, key, digests[key])
            if not (status == 200 and etag == digests[key]):
                why = "uploaded, but R2 doesn't return the same bytes (HTTP {})".format(status)
        with lock:
            tally["done"] += 1
            if why is None:
                record[key] = digests[key]
                tally["ok"] += 1
            else:
                failed.append(key)
                if why not in reasons and why not in ("stopped", "interrupted"):
                    reasons.add(why)
                    print("  {} failed: {}".format(key, why))
                # Three failures and not one success: something is wrong for
                # every file (permissions, account, bucket). Stop, don't grind.
                if tally["ok"] == 0 and len(failed) >= 3 and not STOP.is_set():
                    STOP.set()
                    print("Stopping: the first uploads all failed.")
            if tally["done"] % 25 == 0 or tally["done"] == len(need):
                save_record(record)
                print("  {}/{}".format(tally["done"], len(need)))

    interrupted = False
    try:
        with ThreadPoolExecutor(UPLOAD_WORKERS) as pool:
            try:
                list(pool.map(one, need))
            except KeyboardInterrupt:
                # wrangler got the Ctrl-C too; make sure nobody retries.
                interrupted = True
                STOP.set()
                print("\nStopping…")
    finally:
        with lock:
            save_record(record)

    not_done = len(need) - tally["ok"]
    print("uploaded {}, not uploaded {}".format(tally["ok"], not_done))
    for key in failed[:20]:
        print("  not uploaded: " + key)
    if replacing:
        print("Replaced photographs can look unchanged for up to a day to anyone "
              "whose browser already has the old version.")
    if interrupted:
        return 130
    return 1 if not_done else 0


if __name__ == "__main__":
    sys.exit(main())
