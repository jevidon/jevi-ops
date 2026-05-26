'use client';

import { createContext, useContext, type ReactNode } from 'react';

// React context that carries the app's configured timezone down to
// client components. The server-rendered authed layout fetches the
// value once and wraps children in this provider — every client
// component below (DateInput, DateTimeInput, the today-list, etc.)
// reads via useAppTimezone() instead of hardcoding 'America/Denver'.
//
// Fallback to a sane default so a missing provider doesn't crash
// renders — but the authed layout always wraps, so this is just
// belt-and-suspenders.

const TimezoneContext = createContext<string>('America/Denver');

export function TimezoneProvider({
  timezone,
  children,
}: {
  timezone: string;
  children: ReactNode;
}) {
  return <TimezoneContext.Provider value={timezone}>{children}</TimezoneContext.Provider>;
}

export function useAppTimezone(): string {
  return useContext(TimezoneContext);
}
