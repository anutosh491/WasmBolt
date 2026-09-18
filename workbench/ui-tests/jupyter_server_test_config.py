import os
from pathlib import Path

root = Path(__file__).resolve().parent.parent
contents = root / 'work' / 'jupyter'
contents.mkdir(parents=True, exist_ok=True)

c = get_config()  # noqa: F821
c.Application.log_level = (
  'INFO' if os.environ.get('WASMBOLT_TEST_SERVER_LOGS') == '1' else 'WARN'
)
c.ServerApp.ip = '127.0.0.1'
c.ServerApp.port = 8766
c.ServerApp.port_retries = 0
c.ServerApp.open_browser = False
c.ServerApp.root_dir = str(contents)
c.ServerApp.base_url = '/wasmbolt/'
c.IdentityProvider.token = ''
