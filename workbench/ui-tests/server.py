"""Serve browser-test assets while keeping HTTP errors visible."""

import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class RequestHandler(SimpleHTTPRequestHandler):
  def log_request(self, code='-', size='-'):
    if (
      os.environ.get('FORTITUDO_TEST_SERVER_LOGS') == '1'
      or (isinstance(code, int) and code >= 400)
    ):
      super().log_request(code, size)

  def handle(self):
    try:
      super().handle()
    except (BrokenPipeError, ConnectionResetError):
      # Cancellation and reloads intentionally abandon asset downloads.
      pass


if __name__ == '__main__':
  root = Path(__file__).resolve().parent.parent
  handler = partial(RequestHandler, directory=str(root))
  with ThreadingHTTPServer(('127.0.0.1', 8765), handler) as server:
    server.serve_forever()
