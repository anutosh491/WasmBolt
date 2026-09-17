import type { Diagnostic } from './types';

/** Extract navigable Clang diagnostics; preserve other output separately. */
export function diagnostics(stderr: string): readonly Diagnostic[] {
  const results: Diagnostic[] = [];
  const located = /^(.*):(\d+):(\d+): (fatal error|error|warning|note): (.*)$/;
  const general = /^(?:.*?: )?(fatal error|error|warning|note): (.*)$/;

  for (const text of stderr.split('\n')) {
    const match = located.exec(text);
    if (match) {
      results.push({
        file: match[1],
        line: Number(match[2]),
        column: Number(match[3]),
        severity: severity(match[4]),
        message: match[5]
      });
      continue;
    }
    const message = general.exec(text);
    if (message) {
      results.push({
        file: null,
        line: null,
        column: null,
        severity: severity(message[1]),
        message: message[2]
      });
    }
  }
  return results;
}

/** Combine stages without repeating the same source diagnostic. */
export function uniqueDiagnostics(
  values: readonly Diagnostic[]
): readonly Diagnostic[] {
  const seen = new Set<string>();
  return values.filter(value => {
    const key = JSON.stringify([
      value.file,
      value.line,
      value.column,
      value.severity,
      value.message
    ]);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function severity(value: string): Diagnostic['severity'] {
  return value === 'note' || value === 'warning' ? value : 'error';
}
