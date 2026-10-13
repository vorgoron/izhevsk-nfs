#!/usr/bin/env python3
"""Локальный сервер игры без кеша: иначе браузер после правок берёт старые модули из кеша.

Запуск: python3 tools/serve.py [порт]   →  http://127.0.0.1:8765/
"""
import functools
import http.server
import os
import sys

PUBLIC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public")


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    handler = functools.partial(NoCache, directory=PUBLIC)
    with http.server.ThreadingHTTPServer(("", port), handler) as srv:
        print(f"http://127.0.0.1:{port}/")
        srv.serve_forever()
