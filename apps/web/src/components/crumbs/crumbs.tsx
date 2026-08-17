'use client';

import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Live breadcrumb plumbing. Server pages know their entity names; the Topbar
// (and the mobile crumb line) are the only always-mounted chrome. Pages render
// a <SetCrumbs trail={...}/> that registers the trail in this context, and the
// chrome consumes it. Pages that never register keep the Topbar's static
// fallback map.
//
// The trail is stored WITH the pathname that registered it, and consumers
// ignore a trail whose pathname doesn't match the live one — so back/forward
// navigation and unmount-ordering races can only ever produce a hidden trail,
// never a stale one.

export interface Crumb {
  label: string;
  href?: string;
}

interface Registered {
  pathname: string;
  trail: Crumb[];
}

interface CrumbsApi {
  reg: Registered | null;
  set: (r: Registered) => void;
  clear: (pathname: string) => void;
}

const CrumbsContext = createContext<CrumbsApi | null>(null);

export function CrumbsProvider({ children }: { children: ReactNode }) {
  const [reg, setReg] = useState<Registered | null>(null);
  const set = useCallback((r: Registered) => setReg(r), []);
  // Only clear our own registration — a new page may have registered before
  // the old page's cleanup ran.
  const clear = useCallback(
    (pathname: string) => setReg((cur) => (cur?.pathname === pathname ? null : cur)),
    [],
  );
  const api = useMemo(() => ({ reg, set, clear }), [reg, set, clear]);
  return <CrumbsContext.Provider value={api}>{children}</CrumbsContext.Provider>;
}

export function SetCrumbs({ trail }: { trail: Crumb[] }) {
  const ctx = useContext(CrumbsContext);
  const pathname = usePathname();
  // Serialize for the dep array — the server page hands us a fresh array each
  // render, and re-registering an identical trail would loop the effect.
  const key = JSON.stringify(trail);
  useLayoutEffect(() => {
    ctx?.set({ pathname, trail: JSON.parse(key) });
    return () => ctx?.clear(pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, key]);
  return null;
}

/** The registered trail, or null if none/stale — consumers fall back on null. */
export function useCrumbTrail(): Crumb[] | null {
  const ctx = useContext(CrumbsContext);
  const pathname = usePathname();
  if (!ctx?.reg || ctx.reg.pathname !== pathname) return null;
  return ctx.reg.trail;
}

// Shared renderer: the Topbar's mono-uppercase `/` dialect. Ancestors link,
// the final segment doesn't. Each label truncates so one long task title
// can't eat the whole bar.
export function CrumbTrail({ trail }: { trail: Crumb[] }) {
  return (
    <div className="flex items-baseline gap-[9px] font-mono text-[10px] uppercase tracking-[0.1em]">
      {trail.map((c, i) => {
        const last = i === trail.length - 1;
        return (
          <Fragment key={`${c.label}-${i}`}>
            {i > 0 && <span className="shrink-0 text-ink-3">/</span>}
            {c.href && !last ? (
              <Link
                href={c.href}
                className="shrink-0 truncate max-w-[220px] text-ink-3 hover:text-ink-2 transition-colors"
              >
                {c.label}
              </Link>
            ) : (
              <span className={`shrink-0 truncate max-w-[220px] ${last ? 'text-ink' : 'text-ink-3'}`}>
                {c.label}
              </span>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
