import { and, eq, sql } from 'drizzle-orm';
import type { OperationDisposition } from '@jevi-ops/shared';
import { app_settings, operation_receipts } from '../../db/schema.js';
import { CommandError } from '../command-error.js';
import { inTransaction, type DbOrTx, type Tx } from '../maintenance-tx.js';

// Operation ledger: one terminal result per (data space, client operation id).
//
// A client retries with the SAME operation_id after a lost response. The
// first request commits its effects and its receipt in one transaction; the
// retry finds the receipt and replays it. The same id with different content
// is a client bug and is refused (409 operation_id_reused). Transient failures
// (thrown errors) never insert a receipt, so they are never memoised.
//
// The advisory lock serialises concurrent attempts on one operation id so the
// second sees the first's committed receipt instead of racing its insert.

export interface OperationContext {
  operationId: string;
  command: string;
  protocolVersion: number;
  /** Server-derived actor label ("session:<email>", "token:<name>", "ingest:webhook"). */
  actor: string;
  /** api_tokens.id when a token authenticated the request; null for sessions/webhooks. */
  credentialId: string | null;
  /** True for capture_client credentials: they may only replay their own receipts. */
  restrictToCredential: boolean;
  digest: string;
}

export interface OperationOutcome<T> {
  disposition: OperationDisposition;
  status: number;
  result: T;
  resourceRef?: string | null;
}

export interface OperationResult<T> extends OperationOutcome<T> {
  replayed: boolean;
  dataSpaceId: string;
  serverEpoch: number;
}

export interface InstallationIdentity { dataSpaceId: string; serverEpoch: number }

export async function installationIdentity(tx: Tx): Promise<InstallationIdentity> {
  const [row] = await tx.select({ data_space_id: app_settings.data_space_id, server_epoch: app_settings.server_epoch }).from(app_settings).where(eq(app_settings.id, true));
  if (!row) throw new Error('settings_unavailable');
  return { dataSpaceId: row.data_space_id, serverEpoch: row.server_epoch };
}

export async function withOperation<T>(
  db: DbOrTx,
  ctx: OperationContext,
  fn: (tx: Tx, identity: InstallationIdentity) => Promise<OperationOutcome<T>>,
): Promise<OperationResult<T>> {
  return inTransaction(db, async (tx) => {
    const identity = await installationIdentity(tx);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`operation:${identity.dataSpaceId}:${ctx.operationId}`}, 0))`);
    const [prior] = await tx.select().from(operation_receipts)
      .where(and(eq(operation_receipts.data_space_id, identity.dataSpaceId), eq(operation_receipts.operation_id, ctx.operationId)));
    if (prior) {
      if (ctx.restrictToCredential && prior.credential_id !== ctx.credentialId) {
        // Another credential's operation: reveal nothing, including that it exists.
        throw new CommandError(404, 'operation_not_found', 'Operation not found.');
      }
      if (prior.digest !== ctx.digest || prior.command !== ctx.command) {
        throw new CommandError(409, 'operation_id_reused', 'This operation_id was already used with different content. Retry with a new operation_id.', { operation_id: ctx.operationId });
      }
      return { replayed: true, disposition: prior.disposition, status: prior.status, result: prior.result as T, resourceRef: prior.resource_ref, ...identity };
    }
    const outcome = await fn(tx, identity);
    await tx.insert(operation_receipts).values({
      data_space_id: identity.dataSpaceId,
      operation_id: ctx.operationId,
      protocol_version: ctx.protocolVersion,
      command: ctx.command,
      actor: ctx.actor,
      credential_id: ctx.credentialId,
      digest: ctx.digest,
      disposition: outcome.disposition,
      status: outcome.status,
      result: outcome.result,
      resource_ref: outcome.resourceRef ?? null,
      server_epoch: identity.serverEpoch,
    });
    return { replayed: false, ...outcome, ...identity };
  });
}

/** Durable result lookup after an ambiguous network failure. */
export async function readOperation(db: DbOrTx, operationId: string, ctx: Pick<OperationContext, 'credentialId' | 'restrictToCredential'>) {
  const [row] = await db.select().from(operation_receipts).where(eq(operation_receipts.operation_id, operationId));
  if (!row) return null;
  if (ctx.restrictToCredential && row.credential_id !== ctx.credentialId) return null;
  return {
    operation_id: row.operation_id,
    data_space_id: row.data_space_id,
    server_epoch: row.server_epoch,
    protocol_version: row.protocol_version,
    command: row.command,
    disposition: row.disposition,
    status: row.status,
    resource_ref: row.resource_ref,
    result: row.result,
    created_at: row.created_at,
  };
}
