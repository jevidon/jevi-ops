/** Only app pages can be editor return destinations. Preserve query and hash. */
export function safeReturnPath(value: unknown, excludedPath?: string): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || /[\\\u0000-\u0020]/.test(value)) return null;
  try {
    const url = new URL(value, 'https://editor.invalid');
    if (url.origin !== 'https://editor.invalid') return null;
    const decoded = decodeURIComponent(url.pathname);
    if (/[\\\u0000-\u0020]/.test(decoded) || decoded.startsWith('//')) return null;
    if (!/^\/(?:$|(?:tasks|projects|domains|work|today|calendar|search|attention|inbox|content|assets|maintenance|people|companies|library|routines|health)(?:\/|$))/.test(decoded)) return null;
    if (/(?:^|\/)(?:new|edit)(?:\/|$)/.test(decoded) || decoded === excludedPath) return null;
    return url.pathname + url.search + url.hash;
  } catch { return null; }
}

export interface ReturnContext {
  href: string;
  scrollY: number;
  focusHref?: string;
  entryKey?: string;
}

export function showFloatingNotifications(path: string): boolean {
  if (path === '/' || /^\/(work|today|calendar|search|attention|inbox|notifications)$/.test(path)) return true;
  // Projects and domains are workspaces, including their review content.
  if (/^\/(projects|domains)\/[^/]+$/.test(path) && !path.endsWith('/new')) return true;
  return /^\/(tasks|projects|domains|assets|content|people|companies|library|routines|maintenance|health)$/.test(path)
    || /^\/library\/(books|notes|quotes|journal|inventory)$/.test(path);
}
