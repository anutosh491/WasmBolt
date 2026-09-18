"""Exercise the static server and the installed command without JupyterLab."""

from contextlib import redirect_stderr
from functools import partial
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import io
import json
from pathlib import Path
from queue import Queue
import re
import signal
import subprocess
import sys
import tempfile
from threading import Thread
import unittest
from unittest.mock import patch
from urllib.request import urlopen

from wasmbolt import __version__
from wasmbolt.server import SiteHandler, main, open_browser


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        root = Path(self.directory.name)
        (root / 'index.html').write_text('<h1>WasmBolt</h1>')
        (root / 'worker.js').write_text('self.onmessage = () => {};')
        (root / 'module.wasm').write_bytes(b'\0asm')
        (root / 'secret.txt').write_text('Not in the asset manifest')
        routes = {
            '/index.html': ['site', 'index.html'],
            '/lite/lab/index.html': ['site', 'index.html'],
            '/compiler/worker.js': ['extension', 'worker.js'],
            '/lite/compiler/worker.js': ['extension', 'worker.js'],
            '/compiler/module.wasm': ['extension', 'module.wasm'],
            '/lite/files/C++ examples.ipynb': ['site', 'index.html']
        }
        handler = partial(
            SiteHandler, roots={'site': root, 'extension': root}, routes=routes
        )
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
        self.thread = Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.connection = HTTPConnection(*self.server.server_address, timeout=5)

    def tearDown(self):
        self.connection.close()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.directory.cleanup()

    def request(self, path, method='GET'):
        self.connection.request(method, path)
        response = self.connection.getresponse()
        return response.status, dict(response.getheaders()), response.read()

    def test_shared_assets_and_content_types(self):
        primary = self.request('/compiler/worker.js')
        alias = self.request('/lite/compiler/worker.js')
        self.assertEqual(primary[0], 200)
        self.assertEqual(primary[2], alias[2])
        self.assertEqual(primary[1]['Content-Type'], 'text/javascript')
        self.assertEqual(
            primary[1]['Cross-Origin-Opener-Policy'], 'same-origin'
        )
        self.assertEqual(
            primary[1]['Cross-Origin-Embedder-Policy'], 'require-corp'
        )
        self.assertEqual(
            primary[1]['Cross-Origin-Resource-Policy'], 'same-origin'
        )
        status, headers, body = self.request('/compiler/module.wasm', 'HEAD')
        self.assertEqual(status, 200)
        self.assertEqual(headers['Content-Type'], 'application/wasm')
        self.assertEqual(headers['Content-Length'], '4')
        self.assertEqual(body, b'')

    def test_index_redirect_and_encoded_paths(self):
        self.assertEqual(self.request('/')[0], 200)
        status, headers, _ = self.request('/lite/lab?reset')
        self.assertEqual(status, 301)
        self.assertEqual(headers['Location'], '/lite/lab/?reset')
        self.assertEqual(
            self.request('/lite/files/C%2B%2B%20examples.ipynb')[0], 200
        )

    def test_unlisted_files_and_traversal_are_not_served(self):
        for path in ['/secret.txt', '/../secret.txt', '/%2e%2e/secret.txt']:
            with self.subTest(path=path), redirect_stderr(io.StringIO()):
                self.assertEqual(self.request(path)[0], 404)
        with redirect_stderr(io.StringIO()):
            self.assertEqual(self.request('/', method='POST')[0], 501)


class LauncherTests(unittest.TestCase):
    def test_invalid_port(self):
        for port in ['-1', '65536', 'abc']:
            with self.subTest(port=port), redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as error:
                    main(['--port', port])
                self.assertEqual(error.exception.code, 2)

    def test_browser_failure_leaves_an_address(self):
        output = io.StringIO()
        with patch('webbrowser.open', return_value=False):
            with redirect_stderr(output):
                open_browser('http://127.0.0.1:8000/')
        self.assertIn('http://127.0.0.1:8000/', output.getvalue())

    def test_busy_port(self):
        with ThreadingHTTPServer(('127.0.0.1', 0), SiteHandler) as server:
            output = io.StringIO()
            with redirect_stderr(output):
                with self.assertRaises(SystemExit) as error:
                    main(['--no-browser', '--port', str(server.server_port)])
            self.assertEqual(error.exception.code, 1)
            self.assertIn('Choose another port', output.getvalue())

    def test_installed_command(self):
        # Isolated mode cannot import the checkout or an unrelated installation.
        command = [sys.executable, '-I', '-m', 'wasmbolt']
        version = subprocess.check_output(command + ['--version'], text=True)
        self.assertEqual(version.strip(), __version__)
        with tempfile.TemporaryDirectory() as directory:
            process = subprocess.Popen(
                command + ['--no-browser', '--port', '0'], cwd=directory,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
            )
            try:
                lines = Queue()
                Thread(
                    target=lambda: lines.put(process.stdout.readline()),
                    daemon=True
                ).start()
                line = lines.get(timeout=30)
                match = re.search(r'http://127\.0\.0\.1:\d+/', line)
                self.assertIsNotNone(match, line)
                url = match.group()
                paths = ['', 'lite/lab/index.html', 'compiler/manifest.json']
                for path in paths:
                    with urlopen(url + path, timeout=10) as response:
                        self.assertEqual(response.status, 200)
                        data = response.read()
                        if path.endswith('.json'):
                            manifest = json.loads(data)
                            self.assertEqual(manifest['origin'], 'source')
                if sys.platform != 'win32':
                    process.send_signal(signal.SIGINT)
                    self.assertEqual(process.wait(timeout=10), 0)
            finally:
                if process.poll() is None:
                    process.terminate()
                process.communicate(timeout=10)


if __name__ == '__main__':
    unittest.main()
