/**
 * Same allowlist as `markdownLinkHref` in `@upriv/shared`.
 * Electron main cannot import that module (its compile root is this folder),
 * so the window-open gate repeats the check before `shell.openExternal`.
 */
const MAX_URL_LENGTH = 2048;

function hasForbiddenLinkChar(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f || code === 0x5c) return true;
  }
  return false;
}

export function externalNavigationUrl(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const url = raw.trim();
  if (!url || url.length > MAX_URL_LENGTH) return null;
  if (hasForbiddenLinkChar(url) || /\s/.test(url)) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.username || parsed.password) return null;
  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    if (!parsed.hostname) return null;
    return parsed.href;
  }
  if (parsed.protocol === "mailto:") {
    if (!parsed.pathname) return null;
    return parsed.href;
  }
  return null;
}
