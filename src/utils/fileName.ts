// A name safe to show and download: no path, no control or reserved characters, at most 120 characters.
export function safeFileName(name: string, ext: string): string {
  const base = (name.split(/[/\\]/).pop() ?? "")
    .replace(/[\p{Cc}"<>|*?:]/gu, "")
    .trim()
    .slice(0, 120);
  return base || `file.${ext}`;
}
