/** Hide compiler provenance; keep code, data, and their directives. */
export function assemblyText(text: string): string {
  let metadata = false;
  return text
    .split('\n')
    .filter(line => {
      if (/^\s*\.section\s/.test(line)) {
        metadata =
          /^\s*\.section\s+\.custom_section\.(producers|target_features)\b/.test(
            line
          );
      }
      return !metadata && !/^\s*\.(file|ident)\s/.test(line);
    })
    .join('\n');
}
