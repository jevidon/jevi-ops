import { desc, and, eq, sql } from 'drizzle-orm';
import type { DocEntityType } from '@jevi-ops/shared';
import type { DbOrTx, Tx } from './maintenance-tx.js';
import { assets, doc_revisions, projects, stewardship_domains } from '../db/schema.js';

// The markdown overview document (0050) — one save path for the three
// entities that carry one. Optimistic concurrency: the writer sends the
// doc_version it read; under a row lock the current version must match or
// the save is refused with the current body (DocConflict → 409). A save
// that changes nothing bumps nothing. Every accepted save writes a
// doc_revisions row with the new version and body, so the history is the
// doc's own and an edit is never a loss.

const TABLES = {
  asset: assets,
  project: projects,
  domain: stewardship_domains,
} as const;

export class DocConflict extends Error {
  constructor(public current: { doc_md: string | null; doc_version: number }) {
    super('The document changed since you opened it.');
    this.name = 'DocConflict';
  }
}

export interface SaveDocInput {
  entityType: DocEntityType;
  id: string;
  body: string | null;
  // The version the writer read; undefined = unconditional (imports).
  expectedVersion?: number | null;
  actor?: string | null;
}

export interface SaveDocResult {
  doc_md: string | null;
  doc_version: number;
  changed: boolean;
}

export async function saveDoc(tx: Tx, input: SaveDocInput): Promise<SaveDocResult | null> {
  const table = TABLES[input.entityType];
  const [current] = await tx
    .select({ doc_md: table.doc_md, doc_version: table.doc_version })
    .from(table)
    .where(eq(table.id, input.id))
    .for('update');
  if (!current) return null;

  if (input.expectedVersion != null && input.expectedVersion !== current.doc_version) {
    throw new DocConflict({ doc_md: current.doc_md, doc_version: current.doc_version });
  }
  const body = input.body === '' ? null : input.body;
  if (body === current.doc_md) {
    return { doc_md: current.doc_md, doc_version: current.doc_version, changed: false };
  }
  const nextVersion = current.doc_version + 1;
  await tx
    .update(table)
    .set({ doc_md: body, doc_version: nextVersion })
    .where(eq(table.id, input.id));
  await tx.insert(doc_revisions).values({
    entity_type: input.entityType,
    entity_id: input.id,
    version: nextVersion,
    body,
    actor: input.actor ?? null,
  });
  return { doc_md: body, doc_version: nextVersion, changed: true };
}

export async function listDocRevisions(
  db: DbOrTx,
  entityType: DocEntityType,
  id: string,
  limit = 20,
): Promise<Array<typeof doc_revisions.$inferSelect>> {
  return db
    .select()
    .from(doc_revisions)
    .where(and(eq(doc_revisions.entity_type, entityType), eq(doc_revisions.entity_id, id)))
    .orderBy(desc(doc_revisions.version))
    .limit(limit);
}

// When an entity is deleted its revisions have no owner; the delete paths
// call this so the table doesn't accumulate orphans. Cheap and explicit
// rather than a polymorphic trigger.
export async function deleteDocRevisions(db: DbOrTx, entityType: DocEntityType, id: string): Promise<void> {
  await db
    .delete(doc_revisions)
    .where(and(eq(doc_revisions.entity_type, entityType), eq(doc_revisions.entity_id, id)));
  void sql;
}
