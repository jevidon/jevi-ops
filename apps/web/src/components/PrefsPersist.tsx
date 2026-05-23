'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

interface Props {
  // Cookie key prefix, e.g. "books" → cookies named books_status, books_sort.
  cookiePrefix: string;
  // List of query-string param names whose values should be persisted.
  paramNames: readonly string[];
}

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

// Generic client effect that mirrors a set of query-string params into
// per-page cookies, so the server component on the next visit can read
// them back and (typically) redirect to restore the user's last view.
//
// Used pairwise with a server-side cookie read + redirect in the page —
// see /library/books/page.tsx for the pattern.
export function PrefsPersist({ cookiePrefix, paramNames }: Props) {
  const params = useSearchParams();
  // Stable string for dep array; the array reference would otherwise change
  // every render even if the values inside are constant.
  const namesKey = paramNames.join(',');

  useEffect(() => {
    const expires = new Date(Date.now() + ONE_YEAR_MS).toUTCString();
    for (const name of paramNames) {
      const value = params.get(name) ?? '';
      document.cookie = `${cookiePrefix}_${name}=${encodeURIComponent(value)};path=/;expires=${expires};SameSite=Lax`;
    }
    // namesKey covers paramNames; eslint can't infer that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, cookiePrefix, namesKey]);

  return null;
}
