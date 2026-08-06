#!/usr/bin/env python3
"""Local dev server for the portfolio. Like `python -m http.server`, but it
tells the browser never to cache.

That difference is the whole point. http.server sends Last-Modified, so Chrome
and Firefox both revalidate, get a 304, and keep the *previous* copy of an ES
module. Because index.html imports app.js which imports light.js, room.js and
signals.js, a plain reload can leave you running a mix of old and new code with
no visible sign that anything is stale — an edited shader constant silently has
no effect, and the page looks like it is ignoring your change.

That has burned real debugging time more than once. Use this instead:

    python serve.py            # http://localhost:8000
    python serve.py 8080       # another port

Dev only. Production is GitHub Pages, which sets its own cache headers; nothing
here ships.
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def send_header(self, keyword, value):
        # SimpleHTTPRequestHandler emits Last-Modified from the file mtime, which
        # is exactly what lets a browser answer its own revalidation with a 304.
        if keyword.lower() == "last-modified":
            return
        super().send_header(keyword, value)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    server = ThreadingHTTPServer(("127.0.0.1", port), NoCacheHandler)
    print(f"serving {__file__.rsplit('/', 1)[0] or '.'} on http://localhost:{port}  (no-store)")
    print("stop with ctrl-c")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
        server.server_close()


if __name__ == "__main__":
    main()
