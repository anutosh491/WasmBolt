// Large header ASTs can contain tens of megabytes of text.
export const outputLimit = 100_000;

export function outputPreview(text) {
  if (text.length <= outputLimit) return text;
  const half = outputLimit / 2;
  return `${text.slice(0, half)}\n\n… Large output: preview shows the beginning and end. Copy keeps the complete output.\n\n${text.slice(-half)}`;
}

export function terminalHistory(previous, text) {
  const notice = '… Earlier terminal output omitted. Redirect large output to a file to retain it.\n';
  const history = previous + text;
  return history.length <= outputLimit ? history
    : notice + history.slice(-(outputLimit - notice.length));
}
