import type { z } from 'zod';
import { eq } from 'drizzle-orm';
import { CreateDomainSchema, CreateProjectSchema } from '@jevi-ops/shared';
import { assets, projects, stewardship_domains } from '../db/schema.js';
import { inTransaction, type DbOrTx } from './maintenance-tx.js';

export async function createDomain(db: DbOrTx, input: z.input<typeof CreateDomainSchema>): Promise<typeof stewardship_domains.$inferSelect> {
  const data = CreateDomainSchema.parse(input);
  return inTransaction(db, async (tx) => {
    const [row] = await tx.insert(stewardship_domains).values({
      name: data.name,
      description: data.description ?? null,
      expected_cadence: data.expected_cadence ?? null,
      doc_md: data.doc_md || null,
    }).returning();
    if (!row) throw new Error('insert_returned_no_row');
    return row;
  });
}

export async function createProject(db: DbOrTx, input: z.input<typeof CreateProjectSchema>): Promise<typeof projects.$inferSelect> {
  const values = CreateProjectSchema.parse(input);
  return inTransaction(db, async (tx) => {
    // Serialise inherited routing against a simultaneous asset domain move.
    // Asset lock always precedes project writes in the shared commands.
    if (values.asset_id) {
      const [asset] = await tx.select({ domain_id: assets.domain_id }).from(assets).where(eq(assets.id, values.asset_id)).for('update');
      if (!values.domain_id && asset?.domain_id) values.domain_id = asset.domain_id;
    }
    const [row] = await tx.insert(projects).values(values).returning();
    if (!row) throw new Error('insert_returned_no_row');
    return row;
  });
}
