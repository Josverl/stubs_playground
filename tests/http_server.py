"""
Threaded HTTP server for test suite.

python3 tests/http_server.py <port> <directory>

Uses ThreadingHTTPServer so it can handle many concurrent requests from
Playwright without accumulating CLOSE_WAIT connections.
"""
import http.server
import os
import sys


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8888
    directory = sys.argv[2] if len(sys.argv) > 2 else "."

    os.chdir(directory)

    class Handler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, format, *args):
            pass  # suppress access logs

    class ThreadingHTTPServer(http.server.ThreadingHTTPServer):
        pass

    with ThreadingHTTPServer(("", port), Handler) as httpd:
        print(f"Serving at http://localhost:{port}/apps/playground/", flush=True)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
