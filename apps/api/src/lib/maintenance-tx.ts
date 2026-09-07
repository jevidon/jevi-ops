import { PgTransaction } from 'drizzle-orm/pg-core';
import type { Db } from './db.js';

// Transaction plumbing shared by the maintenance libs. Every authoritative
// maintenance write (completion, undo, sweep, lifecycle reconcile) runs in a
// transaction that locks the item row, so the HTTP endpoints, the cron
// sweep, the post-reading sweep, and the tasks route can't interleave.
//
// Callers that already hold a transaction (the tasks route completing a
// generated task) pass it through; everyone else passes the Db and the lib
// opens one.

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export function isTx(db: DbOrTx): db is Tx {
  return db instanceof PgTransaction;
}

export async function inTransaction<T>(db: DbOrTx, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (isTx(db)) return fn(db);
  return db.transaction(fn);
}
