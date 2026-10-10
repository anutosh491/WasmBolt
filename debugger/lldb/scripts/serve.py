#!/usr/bin/env python3
"""Serve the generated browser site with pthread isolation headers."""
import argparse
import functools
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

class Handler(SimpleHTTPRequestHandler):
    extensions_map = dict(SimpleHTTPRequestHandler.extensions_map, **{'.js': 'text/javascript', '.wasm': 'application/wasm'})

    def send_head(self):
        path = Path(self.translate_path(self.path))
        compressed = Path(str(path) + '.gz')
        if 'gzip' in self.headers.get('Accept-Encoding', '') and compressed.is_file():
            data = compressed.open('rb')
            self.send_response(200)
            self.send_header('Content-Type', self.guess_type(str(path)))
            self.send_header('Content-Encoding', 'gzip')
            self.send_header('Content-Length', str(os.fstat(data.fileno()).st_size))
            self.send_header('Vary', 'Accept-Encoding')
            self.end_headers()
            return data
        return super().send_head()

    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Cross-Origin-Resource-Policy', 'same-origin')
        super().end_headers()

    def list_directory(self, path):
        self.send_error(404)
        return None

    def do_GET(self):
        if self.path.split('?')[0] == '/favicon.ico':
            self.send_response(204)
            self.end_headers()
        else:
            super().do_GET()

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--site', type=Path, default=Path(__file__).resolve().parents[3] / 'site')
p.add_argument('--port', type=int, default=8767)
a = p.parse_args()
site = a.site.resolve()
if not (site / 'index.html').is_file():
    p.error('Stage the browser site first with 70-stage-site.py')
print('Browser debugger: http://127.0.0.1:%d/?debugger=1' % a.port, flush=True)
ThreadingHTTPServer(('127.0.0.1', a.port), functools.partial(Handler, directory=str(site))).serve_forever()
