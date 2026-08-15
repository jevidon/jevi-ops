import type { FastifyPluginAsync } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { CreateConversationSchema, UpdateConversationSchema } from '@jevi-ops/shared/schemas';
import { getDb } from '../lib/db.js';
import { attention_items, conversations } from '../db/schema.js';

// Conversations (CRM port, migration 0042) — the unified interaction log.
// The DB trigger stamps companies.last_interaction_at on insert; this
// route additionally live-reconciles the company_silent attention item so
// logging a check-in clears the flag on the very next render instead of
// waiting for the cron sweep (same pattern as the task mutation sites).

export const conversationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  app.get<{ Querystring: {
    company_id?: string; person_id?: string; project_id?: string;
    task_id?: string; requires_followup?: string; limit?: string;
  } }>('/api/conversations', async (req) => {
    const limit = Math.min(parseInt(req.query.limit ?? '100', 10) || 100, 500);
    const wheres: SQL[] = [];
    if (req.query.company_id) wheres.push(eq(conversations.company_id, req.query.company_id));
    if (req.query.person_id) wheres.push(eq(conversations.person_id, req.query.person_id));
    if (req.query.project_id) wheres.push(eq(conversations.project_id, req.query.project_id));
    if (req.query.task_id) wheres.push(eq(conversations.task_id, req.query.task_id));
    if (req.query.requires_followup === 'true') wheres.push(eq(conversations.requires_followup, true));
    const rows = await getDb().query.conversations.findMany({
      where: wheres.length ? and(...wheres) : undefined,
      with: {
        company: { columns: { id: true, name: true } },
        person: { columns: { id: true, name: true } },
        project: { columns: { id: true, name: true, color: true } },
      },
      orderBy: desc(conversations.occurred_at),
      limit,
    });
    return { conversations: rows };
  });

  app.post('/api/conversations', async (req, reply) => {
    const parsed = CreateConversationSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const { occurred_at, ...rest } = parsed.data;
    const insert: typeof conversations.$inferInsert = { ...rest };
    if (occurred_at) insert.occurred_at = new Date(occurred_at).toISOString();
    const [row] = await getDb().insert(conversations).values(insert).returning();
    if (!row) throw app.httpErrors.internalServerError('insert_returned_no_row');

    // Live reconciliation: a fresh touchpoint settles the company's
    // silent-client flag immediately (the nightly rule would re-raise it
    // if the cadence lapses again).
    if (row.company_id) {
      await getDb()
        .update(attention_items)
        .set({ status: 'acted_on', acted_on_at: new Date().toISOString(), acted_on_action: 'conversation_logged' })
        .where(and(
          eq(attention_items.rule_type, 'company_silent'),
          eq(attention_items.source_id, row.company_id),
          eq(attention_items.status, 'active'),
        ));
    }
    return reply.code(201).send(row);
  });

  app.patch<{ Params: { id: string } }>('/api/conversations/:id', async (req, reply) => {
    const parsed = UpdateConversationSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    if (Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: 'empty_payload' });
    }
    // occurred_at NOT NULL with default — null in the patch means "leave it".
    const { occurred_at, ...restPatch } = parsed.data;
    const update: Partial<typeof conversations.$inferInsert> = { ...restPatch };
    if (typeof occurred_at === 'string') update.occurred_at = new Date(occurred_at).toISOString();
    const [row] = await getDb()
      .update(conversations)
      .set(update)
      .where(eq(conversations.id, req.params.id))
      .returning();
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return row;
  });

  app.delete<{ Params: { id: string } }>('/api/conversations/:id', async (req, reply) => {
    await getDb().delete(conversations).where(eq(conversations.id, req.params.id));
    return reply.code(204).send();
  });
};
