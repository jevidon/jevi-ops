import type { FastifyPluginAsync } from 'fastify';
import { and, asc, desc, eq, gte, inArray, lte, type SQL } from 'drizzle-orm';
import {
  CreateHealthVisitSchema, UpdateHealthVisitSchema,
  CreateHealthMetricSchema, UpdateHealthMetricSchema,
  CreateLabPanelSchema, UpdateLabPanelSchema, CreateLabResultSchema,
  CreateWellbeingCheckInSchema,
  CreateMedicationSchema, UpdateMedicationSchema,
  UpdateHealthHistorySchema,
} from '@jevi-ops/shared/schemas';
import { getDb } from '../lib/db.js';
import {
  health_documents,
  health_history,
  health_metrics,
  health_visits,
  lab_panels,
  lab_results,
  medications,
  wellbeing_check_ins,
} from '../db/schema.js';

// /api/health/* — CRUD for the personal health record (see migration 0024).
//
// All routes are JWT-gated via the global authPlugin preHandler — this is
// genuinely sensitive data, no webhook secret path is exposed.

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  // ─── Visits ────────────────────────────────────────────────────────────

  app.get('/api/health/visits', async () => {
    const visits = await getDb().query.health_visits.findMany({
      orderBy: [desc(health_visits.visit_date), desc(health_visits.created_at)],
      limit: 500,
    });
    return { visits };
  });

  app.get<{ Params: { id: string } }>('/api/health/visits/:id', async (req, reply) => {
    const db = getDb();
    const [visit, metrics, panels, documents] = await Promise.all([
      db.query.health_visits.findFirst({ where: eq(health_visits.id, req.params.id) }),
      db.query.health_metrics.findMany({
        where: eq(health_metrics.visit_id, req.params.id),
        orderBy: asc(health_metrics.measured_at),
      }),
      db.query.lab_panels.findMany({
        where: eq(lab_panels.visit_id, req.params.id),
        orderBy: asc(lab_panels.drawn_date),
      }),
      db.query.health_documents.findMany({
        where: eq(health_documents.visit_id, req.params.id),
        orderBy: asc(health_documents.uploaded_at),
      }),
    ]);
    if (!visit) return reply.code(404).send({ error: 'not_found' });
    return { visit, metrics, panels, documents };
  });

  app.post('/api/health/visits', async (req, reply) => {
    const parsed = CreateHealthVisitSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const [row] = await getDb().insert(health_visits).values(parsed.data).returning();
    if (!row) throw app.httpErrors.internalServerError('insert_returned_no_row');
    return reply.code(201).send(row);
  });

  app.patch<{ Params: { id: string } }>('/api/health/visits/:id', async (req, reply) => {
    const parsed = UpdateHealthVisitSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    if (Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: 'empty_payload' });
    }
    const [row] = await getDb()
      .update(health_visits)
      .set(parsed.data)
      .where(eq(health_visits.id, req.params.id))
      .returning();
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return row;
  });

  app.delete<{ Params: { id: string } }>('/api/health/visits/:id', async (req, reply) => {
    await getDb().delete(health_visits).where(eq(health_visits.id, req.params.id));
    return reply.code(204).send();
  });

  // ─── Vitals + wearable metrics ─────────────────────────────────────────

  app.get<{ Querystring: { metric?: string; from?: string; to?: string; source?: string; limit?: string } }>(
    '/api/health/metrics',
    async (req) => {
      const limit = Math.min(parseInt(req.query.limit ?? '500', 10) || 500, 5000);
      const conds: SQL[] = [];
      if (req.query.metric) conds.push(eq(health_metrics.metric, req.query.metric));
      if (req.query.source) conds.push(eq(health_metrics.source, req.query.source));
      if (req.query.from) conds.push(gte(health_metrics.measured_at, req.query.from));
      if (req.query.to) conds.push(lte(health_metrics.measured_at, req.query.to));
      const metrics = await getDb().query.health_metrics.findMany({
        where: conds.length ? and(...conds) : undefined,
        orderBy: desc(health_metrics.measured_at),
        limit,
      });
      return { metrics };
    },
  );

  app.post('/api/health/metrics', async (req, reply) => {
    const parsed = CreateHealthMetricSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const [row] = await getDb().insert(health_metrics).values(parsed.data).returning();
    if (!row) throw app.httpErrors.internalServerError('insert_returned_no_row');
    return reply.code(201).send(row);
  });

  app.patch<{ Params: { id: string } }>('/api/health/metrics/:id', async (req, reply) => {
    const parsed = UpdateHealthMetricSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    if (Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: 'empty_payload' });
    }
    const [row] = await getDb()
      .update(health_metrics)
      .set(parsed.data)
      .where(eq(health_metrics.id, req.params.id))
      .returning();
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return row;
  });

  app.delete<{ Params: { id: string } }>('/api/health/metrics/:id', async (req, reply) => {
    await getDb().delete(health_metrics).where(eq(health_metrics.id, req.params.id));
    return reply.code(204).send();
  });

  // ─── Labs (panels + nested results) ────────────────────────────────────

  app.get('/api/health/lab-panels', async () => {
    const panels = await getDb().query.lab_panels.findMany({
      with: { results: { columns: { id: true, analyte: true, value: true, unit: true, flag: true } } },
      orderBy: [desc(lab_panels.drawn_date), desc(lab_panels.created_at)],
      limit: 500,
    });
    return { panels };
  });

  app.get<{ Params: { id: string } }>('/api/health/lab-panels/:id', async (req, reply) => {
    const row = await getDb().query.lab_panels.findFirst({
      with: { results: true },
      where: eq(lab_panels.id, req.params.id),
    });
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return row;
  });

  app.post('/api/health/lab-panels', async (req, reply) => {
    const parsed = CreateLabPanelSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const { results, ...panelFields } = parsed.data;
    const db = getDb();

    // Panel + its results land together or not at all.
    const panelId = await db.transaction(async (tx) => {
      const [panel] = await tx.insert(lab_panels).values(panelFields).returning({ id: lab_panels.id });
      if (!panel) throw new Error('insert_returned_no_row');
      if (results && results.length > 0) {
        await tx.insert(lab_results).values(results.map((r) => ({ ...r, panel_id: panel.id })));
      }
      return panel.id;
    });

    const fullPanel = await db.query.lab_panels.findFirst({
      with: { results: true },
      where: eq(lab_panels.id, panelId),
    });
    return reply.code(201).send(fullPanel);
  });

  app.patch<{ Params: { id: string } }>('/api/health/lab-panels/:id', async (req, reply) => {
    const parsed = UpdateLabPanelSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    if (Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: 'empty_payload' });
    }
    const [row] = await getDb()
      .update(lab_panels)
      .set(parsed.data)
      .where(eq(lab_panels.id, req.params.id))
      .returning();
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return row;
  });

  app.delete<{ Params: { id: string } }>('/api/health/lab-panels/:id', async (req, reply) => {
    await getDb().delete(lab_panels).where(eq(lab_panels.id, req.params.id));
    return reply.code(204).send();
  });

  // Individual lab results — useful for editing + adding analytes to an
  // existing panel without re-posting the whole thing.
  app.post<{ Params: { panelId: string } }>('/api/health/lab-panels/:panelId/results', async (req, reply) => {
    const parsed = CreateLabResultSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const [row] = await getDb()
      .insert(lab_results)
      .values({ ...parsed.data, panel_id: req.params.panelId })
      .returning();
    if (!row) throw app.httpErrors.internalServerError('insert_returned_no_row');
    return reply.code(201).send(row);
  });

  app.delete<{ Params: { id: string } }>('/api/health/lab-results/:id', async (req, reply) => {
    await getDb().delete(lab_results).where(eq(lab_results.id, req.params.id));
    return reply.code(204).send();
  });

  // Trend by analyte: returns every lab_results row for a given analyte
  // across all panels, with the panel's drawn_date for charting. Used by
  // the Labs trend view in Session 2; ships now so the schema is exercised.
  app.get<{ Querystring: { analyte: string } }>('/api/health/lab-trends', async (req, reply) => {
    const analyte = (req.query.analyte ?? '').trim();
    if (!analyte) return reply.code(400).send({ error: 'analyte_required' });
    const results = await getDb().query.lab_results.findMany({
      columns: {
        id: true, value: true, value_text: true, unit: true, flag: true,
        reference_range_low: true, reference_range_high: true,
      },
      with: { panel: { columns: { drawn_date: true, panel_name: true } } },
      where: eq(lab_results.analyte, analyte),
      orderBy: asc(lab_results.id),
    });
    return { analyte, results };
  });

  // ─── Wellbeing check-ins ───────────────────────────────────────────────

  app.get<{ Querystring: { limit?: string; from?: string; to?: string } }>(
    '/api/health/check-ins',
    async (req) => {
      const limit = Math.min(parseInt(req.query.limit ?? '500', 10) || 500, 5000);
      const conds: SQL[] = [];
      if (req.query.from) conds.push(gte(wellbeing_check_ins.checked_in_at, req.query.from));
      if (req.query.to) conds.push(lte(wellbeing_check_ins.checked_in_at, req.query.to));
      const checkIns = await getDb().query.wellbeing_check_ins.findMany({
        where: conds.length ? and(...conds) : undefined,
        orderBy: desc(wellbeing_check_ins.checked_in_at),
        limit,
      });
      return { check_ins: checkIns };
    },
  );

  app.post('/api/health/check-ins', async (req, reply) => {
    const parsed = CreateWellbeingCheckInSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const [row] = await getDb().insert(wellbeing_check_ins).values(parsed.data).returning();
    if (!row) throw app.httpErrors.internalServerError('insert_returned_no_row');
    return reply.code(201).send(row);
  });

  app.delete<{ Params: { id: string } }>('/api/health/check-ins/:id', async (req, reply) => {
    await getDb().delete(wellbeing_check_ins).where(eq(wellbeing_check_ins.id, req.params.id));
    return reply.code(204).send();
  });

  // ─── Medications + supplements + vitamins ──────────────────────────────

  app.get<{ Querystring: { active?: string; kind?: string } }>(
    '/api/health/medications',
    async (req) => {
      const conds: SQL[] = [];
      if (req.query.active === 'true') conds.push(eq(medications.active, true));
      if (req.query.active === 'false') conds.push(eq(medications.active, false));
      if (req.query.kind) conds.push(eq(medications.kind, req.query.kind));
      const rows = await getDb().query.medications.findMany({
        where: conds.length ? and(...conds) : undefined,
        orderBy: [asc(medications.kind), asc(medications.name)],
      });
      return { medications: rows };
    },
  );

  app.post('/api/health/medications', async (req, reply) => {
    const parsed = CreateMedicationSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const [row] = await getDb().insert(medications).values(parsed.data).returning();
    if (!row) throw app.httpErrors.internalServerError('insert_returned_no_row');
    return reply.code(201).send(row);
  });

  app.patch<{ Params: { id: string } }>('/api/health/medications/:id', async (req, reply) => {
    const parsed = UpdateMedicationSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    if (Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: 'empty_payload' });
    }
    const [row] = await getDb()
      .update(medications)
      .set(parsed.data)
      .where(eq(medications.id, req.params.id))
      .returning();
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return row;
  });

  app.delete<{ Params: { id: string } }>('/api/health/medications/:id', async (req, reply) => {
    await getDb().delete(medications).where(eq(medications.id, req.params.id));
    return reply.code(204).send();
  });

  // ─── History (singleton) ───────────────────────────────────────────────

  app.get('/api/health/history', async () => {
    const row = await getDb().query.health_history.findFirst({
      where: eq(health_history.id, true),
    });
    // Migration seeds the row; this fallback is just defense in depth.
    return row ?? {
      id: true,
      narrative: null,
      conditions: [],
      surgeries: [],
      allergies: [],
      immunizations: [],
      family_history: [],
    };
  });

  app.patch('/api/health/history', async (req, reply) => {
    const parsed = UpdateHealthHistorySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    if (Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: 'empty_payload' });
    }
    const [row] = await getDb()
      .update(health_history)
      .set(parsed.data)
      .where(eq(health_history.id, true))
      .returning();
    if (!row) throw app.httpErrors.internalServerError('history_row_missing');
    return row;
  });

  // ─── Overview snapshot ─────────────────────────────────────────────────
  // Single endpoint that powers the Health landing page. Pulls the most
  // recent of each thing the UI wants to surface in one round-trip so the
  // overview load is one HTTP request, not eight.

  app.get('/api/health/overview', async () => {
    const db = getDb();
    const [
      latestVitals, recentCheckIns, recentLabs, upcomingVisits,
      activeMedications,
    ] = await Promise.all([
      // Latest reading per known vital metric — fetch the last 30 of each
      // common metric type and let the UI pick out the most recent.
      db.query.health_metrics.findMany({
        columns: { id: true, measured_at: true, metric: true, value: true, value_secondary: true, unit: true, source: true },
        where: inArray(health_metrics.metric, ['weight', 'bp', 'hr_resting', 'sleep_duration', 'sleep_score', 'hrv_overnight', 'spo2_avg']),
        orderBy: desc(health_metrics.measured_at),
        limit: 50,
      }),
      db.query.wellbeing_check_ins.findMany({
        orderBy: desc(wellbeing_check_ins.checked_in_at),
        limit: 5,
      }),
      db.query.lab_panels.findMany({
        columns: { id: true, drawn_date: true, panel_name: true },
        with: { results: { columns: { id: true, analyte: true, flag: true } } },
        orderBy: desc(lab_panels.drawn_date),
        limit: 3,
      }),
      db.query.health_visits.findMany({
        columns: { id: true, visit_date: true, provider_name: true, visit_type: true, reason: true },
        where: gte(health_visits.visit_date, new Date().toISOString().slice(0, 10)),
        orderBy: asc(health_visits.visit_date),
        limit: 5,
      }),
      db.query.medications.findMany({
        where: eq(medications.active, true),
        orderBy: [asc(medications.kind), asc(medications.name)],
      }),
    ]);

    return {
      latest_vitals: latestVitals,
      recent_check_ins: recentCheckIns,
      recent_labs: recentLabs,
      upcoming_visits: upcomingVisits,
      active_medications: activeMedications,
    };
  });
};
