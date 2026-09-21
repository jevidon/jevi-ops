'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { safeReturnPath, type ReturnContext } from '@/lib/editor-navigation';
import { createClientId } from '@/lib/client-id';

interface StoredNavigation {
  views: Record<string, unknown>;
}
interface NavigationEntry { key: string; scope: string; href: string; origin: ReturnContext | null }
interface EditorNavigation {
  openCount: number;
  opened: () => () => void;
  origin: (excluded?: string) => ReturnContext | null;
  returnTo: (href: string) => void;
  readView: <T>(key: string) => T | undefined;
  writeView: (key: string, value: unknown) => void;
}
const Context = createContext<EditorNavigation | null>(null);

/** Tab-local navigation context; never stores editable record contents. */
export function EditorProvider({ scope, children }: { scope: string; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [openCount, setOpenCount] = useState(0);
  const data = useRef<StoredNavigation>({ views: {} });
  const storageKey = `jevi.editor-navigation:${scope}`;
  const loadedKey = useRef('');
  const restore = useRef<ReturnContext | null>(null);
  const pendingOrigin = useRef<{ href: string; origin: ReturnContext } | null>(null);
  const load = useCallback(() => {
    if (loadedKey.current === storageKey) return;
    loadedKey.current = storageKey;
    data.current = { views: {} };
    try {
      // A different signed-in user must not inherit the previous user's views.
      for (const key of Object.keys(sessionStorage)) {
        if (key.startsWith('jevi.editor-navigation:') && key !== storageKey) sessionStorage.removeItem(key);
      }
      const stored = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
      if (stored && stored.views && typeof stored.views === 'object') data.current = stored;
    } catch { /* Navigation still works if storage is unavailable. */ }
  }, [storageKey]);
  const persist = useCallback(() => {
    try {
      data.current.views = Object.fromEntries(Object.entries(data.current.views).slice(-40));
      sessionStorage.setItem(storageKey, JSON.stringify(data.current));
    } catch { /* In-memory context remains usable. */ }
  }, [storageKey]);
  const opened = useCallback(() => {
    setOpenCount(n => n + 1);
    return () => setOpenCount(n => Math.max(0, n - 1));
  }, []);
  const currentEntry = useCallback((): NavigationEntry => {
    const href = location.pathname + location.search + location.hash;
    const existing = history.state?.jeviNavigation as NavigationEntry | undefined;
    if (existing?.scope === scope && existing.href === href) return existing;
    const returning = restore.current?.href === href ? restore.current : null;
    const incoming = pendingOrigin.current?.href === href ? pendingOrigin.current.origin : null;
    const next = { key: returning?.entryKey ?? createClientId(), scope, href, origin: incoming };
    history.replaceState({ ...history.state, jeviNavigation: next }, '', href);
    if (incoming) pendingOrigin.current = null;
    return next;
  }, [scope]);
  const origin = useCallback((excluded?: string) => {
    load();
    const entry = currentEntry().origin;
    return entry && safeReturnPath(entry.href, excluded) ? entry : null;
  }, [load, currentEntry]);
  const returnTo = useCallback((href: string) => {
    const safe = safeReturnPath(href);
    if (!safe) return;
    const previous = origin();
    restore.current = previous?.href === safe ? previous : null;
    router.replace(safe, { scroll: false });
    router.refresh();
  }, [origin, router]);
  const readView = useCallback(<T,>(key: string): T | undefined => {
    load();
    return data.current.views[`${currentEntry().key}:${key}`] as T | undefined;
  }, [load, currentEntry]);
  const writeView = useCallback((key: string, value: unknown) => {
    load();
    data.current.views[`${currentEntry().key}:${key}`] = value;
    persist();
  }, [load, persist, currentEntry]);

  useEffect(() => {
    load();
    const capture = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element)?.closest<HTMLAnchorElement>('a[href]');
      if (!link || link.target || link.hasAttribute('download')) return;
      const url = new URL(link.href, location.href);
      if (url.origin !== location.origin) return;
      const from = location.pathname + location.search + location.hash;
      const to = url.pathname + url.search + url.hash;
      if (from === to) return;
      pendingOrigin.current = { href: to, origin: { href: from, scrollY: window.scrollY, focusHref: link.getAttribute('href') ?? undefined, entryKey: currentEntry().key } };
    };
    document.addEventListener('click', capture, true);
    return () => document.removeEventListener('click', capture, true);
  }, [load, currentEntry]);

  useEffect(() => {
    currentEntry();
    const target = restore.current;
    if (!target || new URL(target.href, location.origin).pathname !== pathname) return;
    restore.current = null;
    const frame = requestAnimationFrame(() => {
      window.scrollTo(0, target.scrollY);
      const link = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].find(el => el.getAttribute('href') === target.focusHref);
      if (link) link.focus({ preventScroll: true });
      else {
        const heading = document.querySelector<HTMLElement>('main h1, main h2');
        if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname, currentEntry]);

  const value = useMemo(() => ({ openCount, opened, origin, returnTo, readView, writeView }), [openCount, opened, origin, returnTo, readView, writeView]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useEditorNavigation() { return useContext(Context); }
