import '../../style/site.css';

const repository = document.getElementById('wasmbolt-repository-details');
if (repository) {
  void showRepository(repository);
}

// GitHub metadata is optional; the packaged badge also works offline.
async function showRepository(details: HTMLElement): Promise<void> {
  const api = 'https://api.github.com/repos/anutosh491/WasmBolt';
  const signal = AbortSignal.timeout(5000);
  const [repository, release] = await Promise.all([
    read(api, signal),
    read(`${api}/releases/latest`, signal)
  ]);
  const version =
    release && typeof release.tag_name === 'string'
      ? release.tag_name.trim()
      : '';
  const stars = count(repository?.stargazers_count, 'star');
  const forks = count(repository?.forks_count, 'fork');
  const parts = [version || details.dataset.version, stars, forks].filter(
    Boolean
  );
  if (stars || forks) {
    details.textContent = parts.join(' · ');
  } else if (version) {
    details.textContent = `${version} · Source on GitHub`;
  }
}

async function read(
  url: string,
  signal: AbortSignal
): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(url, {
      credentials: 'omit',
      headers: { Accept: 'application/vnd.github+json' },
      signal
    });
    if (!response.ok) {
      return null;
    }
    const data: unknown = await response.json();
    return isRecord(data) ? data : null;
  } catch {
    // Offline, rate-limited, or unavailable: keep the packaged version.
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function count(value: unknown, label: string): string {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? `${value.toLocaleString('en')} ${label}${value === 1 ? '' : 's'}`
    : '';
}
