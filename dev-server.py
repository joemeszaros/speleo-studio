#!/usr/bin/env python3
"""Static file server for local development.

Identical to `python3 -m http.server` except that it tells the browser never to cache anything.
The stock server sends no Cache-Control header at all, which lets the browser apply heuristic
freshness and happily keep serving a stale module long after the file on disk has changed.
"""

import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def handle_one_request(self):
        # Playwright tears connections down mid-response all the time; a broken pipe is not
        # something worth a stack trace.
        try:
            super().handle_one_request()
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True

    def log_message(self, *args):
        # Silence per-request logging: Playwright forwards the web server's output into the test
        # report, where one line per asset drowns everything else.
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f'Serving on http://localhost:{port}/ with caching disabled')
    ThreadingHTTPServer(('', port), NoCacheHandler).serve_forever()
