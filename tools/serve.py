#!/usr/bin/env python3
"""Local preview server.

`python3 -m http.server` sends no cache headers at all. Browsers fall back to
heuristic freshness — roughly a tenth of the file's age — and a page that has
sat unedited for a week is then served from cache for hours without ever
asking the server whether it changed. The symptom is an edit that appears not
to have worked: the stylesheet is correct on disk, the page requesting it is
not, and no amount of reloading helps because the reload never leaves the
cache. Sending no-store on everything makes local edits show up on a refresh,
every time. Production is a separate matter — there the ?v= stamps that
tools/build.py writes are what keep assets from going stale.

    python3 tools/serve.py [port]
"""

import functools
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        SimpleHTTPRequestHandler.end_headers(self)

    def send_head(self):
        # Suppress the 304 path as well; a conditional request that the
        # browser makes on its own would otherwise still hand back the
        # version it already has.
        self.headers.replace_header("If-Modified-Since", "") \
            if "If-Modified-Since" in self.headers else None
        self.headers.replace_header("If-None-Match", "") \
            if "If-None-Match" in self.headers else None
        return SimpleHTTPRequestHandler.send_head(self)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8137
    handler = functools.partial(NoCacheHandler, directory=ROOT)
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    print("serving {} at http://localhost:{}/ (no-store)".format(ROOT, port))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
