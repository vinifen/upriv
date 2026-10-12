/** Reject enormous hrefs before they reach the OS handler. */
const MAX_MARKDOWN_LINK_LENGTH = 2048;

function hasForbiddenLinkChar(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f || code === 0x5c) return true;
  }
  return false;
}

/**
 * Absolute `http`, `https`, and `mailto` links a markdown note may open.
 * Anything else (including `javascript:`, `data:`, `file:`, userinfo, and
 * relative URLs) is not a navigation target. The returned string is the
 * normalized `URL.href`.
 *
 * Electron main repeats this check in `externalNavigationUrl` (it cannot
 * import this module). Keep the two functions in lockstep.
 */
export function markdownLinkHref(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const url = raw.trim();
  if (!url || url.length > MAX_MARKDOWN_LINK_LENGTH) return null;
  if (hasForbiddenLinkChar(url) || /\s/.test(url)) return null;

  let parsed: {
    protocol: string;
    username: string;
    password: string;
    hostname: string;
    pathname: string;
    href: string;
  };
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
