'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Global keyboard shortcut: ⌘K / Ctrl-K opens /search from anywhere.
// Mounted once at the (authed) layout level so it's always listening.
// We swallow the default browser behavior (focus address bar on some
// platforms) so the navigation always wins.

export function SearchHotkey() {
  const router = useRouter();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Cmd+K on macOS, Ctrl+K elsewhere. Match either to feel native.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        router.push('/search');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);

  return null;
}
