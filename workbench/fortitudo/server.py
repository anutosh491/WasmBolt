"""Serve the packaged explorer and notebooks on this computer."""

import argparse
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.metadata import distribution
import json
import mimetypes
from pathlib import Path
import shutil
import sys
from threading import Thread
from urllib.parse import quote, unquote, urlsplit
import webbrowser

from . import __version__


def extension_path() -> Path:
    """Locate shared Jupyter data in editable, user, and wheel installations."""
    local = Path(__file__).parent / 'labextension'
    if local.is_dir():
        return local
    package = distribution('fortitudo')
    suffix = 'share/jupyter/labextensions/fortitudo/package.json'
    for path in package.files or []:
        if path.as_posix().endswith(suffix):
            return Path(package.locate_file(path)).resolve().parent
    raise FileNotFoundError('The Fortitudo extension assets are missing.')


class SiteHandler(BaseHTTPRequestHandler):
    """Serve only URLs in the build manifest, never the working directory."""

    def __init__(self, *args, roots, routes, **kwargs):
        self.roots = roots
        self.routes = routes
        super().__init__(*args, **kwargs)

    def do_GET(self):
        self.serve(head=False)

    def do_HEAD(self):
        self.serve(head=True)

    def serve(self, *, head):
        try:
            url = urlsplit(self.path)
            path = unquote(url.path)
        except ValueError:
            self.send_error(400)
            return
        if path.endswith('/'):
            path += 'index.html'
        asset = self.routes.get(path)
        if asset is None:
            if f'{path}/index.html' in self.routes:
                target = quote(path + '/')
                if url.query:
                    target += '?' + url.query
                self.send_response(301)
                self.send_header('Location', target)
                self.send_header('Content-Length', '0')
                self.end_headers()
            else:
                self.send_error(404)
            return
        scope, relative = asset
        try:
            file = (self.roots[scope] / relative).open('rb')
        except OSError:
            self.send_error(404, 'Packaged asset not found')
            return
        with file:
            content_type = {
                '.js': 'text/javascript',
                '.wasm': 'application/wasm',
                '.data': 'application/octet-stream',
                '.so': 'application/wasm'
            }.get(Path(path).suffix)
            content_type = content_type or mimetypes.guess_type(path)[0]
            self.send_response(200)
            self.send_header(
                'Content-Type', content_type or 'application/octet-stream'
            )
            self.send_header('Content-Length', str(file.seek(0, 2)))
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            file.seek(0)
            if not head:
                try:
                    shutil.copyfileobj(file, self.wfile)
                except (BrokenPipeError, ConnectionResetError):
                    pass

    def log_request(self, code='-', size='-'):
        if isinstance(code, int) and code >= 400:
            super().log_request(code, size)


def open_browser(url: str) -> None:
    try:
        opened = webbrowser.open(url)
    except webbrowser.Error:
        opened = False
    if not opened:
        print(f'Open {url} in your browser.', file=sys.stderr, flush=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description='Open the Fortitudo explorer and JupyterLite locally.'
    )
    parser.add_argument('--version', action='version', version=__version__)
    parser.add_argument(
        '--port', type=int, default=8000,
        help='local port (default: 8000; 0 selects an available port)'
    )
    parser.add_argument(
        '--no-browser', action='store_true',
        help='print the address without opening a browser'
    )
    args = parser.parse_args(argv)
    if not 0 <= args.port <= 65535:
        parser.error('--port must be between 0 and 65535')
    site = Path(__file__).parent / 'site'
    try:
        routes = json.loads((site / 'routes.json').read_text())
        roots = {'site': site, 'extension': extension_path()}
    except (OSError, ValueError) as error:
        parser.exit(
            1, 'Local site assets are missing. Reinstall Fortitudo.\n'
            f'{error}\n'
        )
    handler = partial(SiteHandler, roots=roots, routes=routes)
    try:
        server = ThreadingHTTPServer(('127.0.0.1', args.port), handler)
    except OSError as error:
        parser.exit(
            1, f'Cannot start Fortitudo: {error}.\n'
            'Choose another port with --port PORT.\n'
        )
    with server:
        url = f'http://127.0.0.1:{server.server_port}/'
        print(f'Fortitudo is running at {url}', flush=True)
        print('Press Ctrl+C to stop.', flush=True)
        if not args.no_browser:
            Thread(target=open_browser, args=(url,), daemon=True).start()
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print('\nStopped Fortitudo.', flush=True)
    return 0
