'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

// Tiny client effect that mirrors the current status + sort query params
// into cookies, so the next time the user lands on /library/books (with no
// params) the server can redirect them back to their saved view. The page
// itself reads these cookies during render.

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export function BookPrefsPersist() {
  const params = useSearchParams();

  useEffect(() => {
    const status = params.get('status') ?? 'all';
    const sort = params.get('sort') ?? 'title';
    const expires = new Date(Date.now() + ONE_YEAR_MS).toUTCString();
    document.cookie = `books_status=${encodeURIComponent(status)};path=/;expires=${expires};SameSite=Lax`;
    document.cookie = `books_sort=${encodeURIComponent(sort)};path=/;expires=${expires};SameSite=Lax`;
  }, [params]);

  return null;
}
