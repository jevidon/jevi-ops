'use client';
import { useMemo } from 'react';
import { Workspace } from './Workspace';
import { BrowserWorkspace, indexedStorage } from './browser';
export function LocalWorkspace({ account }: { account: string }) {
  const adapter = useMemo(() => new BrowserWorkspace(indexedStorage(account), account), [account]);
  return <Workspace adapter={adapter} />;
}
