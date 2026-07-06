import type { FastifyPluginAsync } from 'fastify';
import {
  CreateHealthVisitSchema, UpdateHealthVisitSchema,
  CreateHealthMetricSchema, UpdateHealthMetricSchema,
  CreateLabPanelSchema, UpdateLabPanelSchema, CreateLabResultSchema,
  CreateWellbeingCheckInSchema,
  CreateMedicationSchema, UpdateMedicationSchema,
  UpdateHealthHistorySchema,
} from '@jevi-ops/shared/schemas';

// /api/health/* — CRUD for the personal health record (see migration 0024).
//
// All routes are JWT-gated via the global authPlugin preHandler — this is
// genuinely sensitive data, no webhook secret path is exposed.

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  // ─── Visits ────────────────────────────────────────────────────────────

  app.get('/api/health/visits', async (req) => {
    const { data, error } = await req.supabase!
      .from('health_visits')
      .select('*')
      .order('visit_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw app.httpErrors.internalServerError(error.message);
    return { visits: data ?? [] };
  });

  app.get<{ Params: { id: string } }>('/api/health/visits/:id', async (req, reply) => {
    const sb = req.supabase!;
    const [visitRes, metricsRes, panelsRes, docsRes] = await Promise.all([
      sb.from('health_visits').select('*').eq('id', req.params.id).maybeSingle(),
      sb.from('health_metrics').select('*').eq('visit_id', req.params.id).order('measured_at'),
      sb.from('lab_panels').select('*').eq('visit_id', req.params.id).order('drawn_date'),
      sb.from('health_documents').select('*').eq('visit_id', req.params.id).order('uploaded_at'),
    ]);
    if (visitRes.error) throw app.httpErrors.internalServerError(visitRes.error.message);
    if (!visitRes.data) return reply.code(404).send({ error: 'not_found' });
    return {
      visit: visitRes.data,
      metrics: metricsRes.data ?? [],
      panels: panelsRes.data ?? [],
      documents: docsRes.data ?? [],
    };
  });

  app.post('/api/health/visits', async (req, reply) => {
    const parsed = CreateHealthVisitSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const { data, error } = await req.supabase!
      .from('health_visits')
      .insert(parsed.data)
      .select('*')
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(201).send(data);
  });

  app.patch<{ Params: { id: string } }>('/api/health/visits/:id', async (req, reply) => {
    const parsed = UpdateHealthVisitSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    if (Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: 'empty_payload' });
    }
    const { data, error } = await req.supabase!
      .from('health_visits')
      .update(parsed.data)
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    return data;
  });

  app.delete<{ Params: { id: string } }>('/api/health/visits/:id', async (req, reply) => {
    const { error } = await req.supabase!.from('health_visits').delete().eq('id', req.params.id);
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(204).send();
  });

  // ─── Vitals + wearable metrics ─────────────────────────────────────────

  app.get<{ Querystring: { metric?: string; from?: string; to?: string; source?: string; limit?: string } }>(
    '/api/health/metrics',
    async (req) => {
      const limit = Math.min(parseInt(req.query.limit ?? '500', 10) || 500, 5000);
      let q = req.supabase!
        .from('health_metrics')
        .select('*')
        .order('measured_at', { ascending: false })
        .limit(limit);
      if (req.query.metric) q = q.eq('metric', req.query.metric);
      if (req.query.source) q = q.eq('source', req.query.source);
      if (req.query.from) q = q.gte('measured_at', req.query.from);
      if (req.query.to) q = q.lte('measured_at', req.query.to);
      const { data, error } = await q;
      if (error) throw app.httpErrors.internalServerError(error.message);
      return { metrics: data ?? [] };
    },
  );

  app.post('/api/health/metrics', async (req, reply) => {
    const parsed = CreateHealthMetricSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const { data, error } = await req.supabase!
      .from('health_metrics')
      .insert(parsed.data)
      .select('*')
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(201).send(data);
  });

  app.patch<{ Params: { id: string } }>('/api/health/metrics/:id', async (req, reply) => {
    const parsed = UpdateHealthMetricSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    if (Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: 'empty_payload' });
    }
    const { data, error } = await req.supabase!
      .from('health_metrics')
      .update(parsed.data)
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    return data;
  });

  app.delete<{ Params: { id: string } }>('/api/health/metrics/:id', async (req, reply) => {
    const { error } = await req.supabase!.from('health_metrics').delete().eq('id', req.params.id);
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(204).send();
  });

  // ─── Labs (panels + nested results) ────────────────────────────────────

  app.get('/api/health/lab-panels', async (req) => {
    const { data, error } = await req.supabase!
      .from('lab_panels')
      .select('*, results:lab_results(id, analyte, value, unit, flag)')
      .order('drawn_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw app.httpErrors.internalServerError(error.message);
    return { panels: data ?? [] };
  });

  app.get<{ Params: { id: string } }>('/api/health/lab-panels/:id', async (req, reply) => {
    const { data, error } = await req.supabase!
      .from('lab_panels')
      .select('*, results:lab_results(*)')
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) throw app.httpErrors.internalServerError(error.message);
    if (!data) return reply.code(404).send({ error: 'not_found' });
    return data;
  });

  app.post('/api/health/lab-panels', async (req, reply) => {
    const parsed = CreateLabPanelSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const { results, ...panelFields } = parsed.data;
    const { data: panel, error } = await req.supabase!
      .from('lab_panels')
      .insert(panelFields)
      .select('*')
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);

    if (results && results.length > 0) {
      const { error: resErr } = await req.supabase!
        .from('lab_results')
        .insert(results.map((r) => ({ ...r, panel_id: panel.id })));
      if (resErr) {
        // Roll back the panel so a partial-failure doesn't strand an
        // empty panel in the list.
        await req.supabase!.from('lab_panels').delete().eq('id', panel.id);
        throw app.httpErrors.internalServerError(resErr.message);
      }
    }

    const { data: fullPanel } = await req.supabase!
      .from('lab_panels')
      .select('*, results:lab_results(*)')
      .eq('id', panel.id)
      .single();
    return reply.code(201).send(fullPanel ?? panel);
  });

  app.patch<{ Params: { id: string } }>('/api/health/lab-panels/:id', async (req, reply) => {
    const parsed = UpdateLabPanelSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    if (Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: 'empty_payload' });
    }
    const { data, error } = await req.supabase!
      .from('lab_panels')
      .update(parsed.data)
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    return data;
  });

  app.delete<{ Params: { id: string } }>('/api/health/lab-panels/:id', async (req, reply) => {
    const { error } = await req.supabase!.from('lab_panels').delete().eq('id', req.params.id);
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(204).send();
  });

  // Individual lab results — useful for editing + adding analytes to an
  // existing panel without re-posting the whole thing.
  app.post<{ Params: { panelId: string } }>('/api/health/lab-panels/:panelId/results', async (req, reply) => {
    const parsed = CreateLabResultSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const { data, error } = await req.supabase!
      .from('lab_results')
      .insert({ ...parsed.data, panel_id: req.params.panelId })
      .select('*')
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(201).send(data);
  });

  app.delete<{ Params: { id: string } }>('/api/health/lab-results/:id', async (req, reply) => {
    const { error } = await req.supabase!.from('lab_results').delete().eq('id', req.params.id);
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(204).send();
  });

  // Trend by analyte: returns every lab_results row for a given analyte
  // across all panels, with the panel's drawn_date for charting. Used by
  // the Labs trend view in Session 2; ships now so the schema is exercised.
  app.get<{ Querystring: { analyte: string } }>('/api/health/lab-trends', async (req, reply) => {
    const analyte = (req.query.analyte ?? '').trim();
    if (!analyte) return reply.code(400).send({ error: 'analyte_required' });
    const { data, error } = await req.supabase!
      .from('lab_results')
      .select('id, value, value_text, unit, flag, reference_range_low, reference_range_high, panel:lab_panels(drawn_date, panel_name)')
      .eq('analyte', analyte)
      .order('id', { ascending: true });
    if (error) throw app.httpErrors.internalServerError(error.message);
    return { analyte, results: data ?? [] };
  });

  // ─── Wellbeing check-ins ───────────────────────────────────────────────

  app.get<{ Querystring: { limit?: string; from?: string; to?: string } }>(
    '/api/health/check-ins',
    async (req) => {
      const limit = Math.min(parseInt(req.query.limit ?? '500', 10) || 500, 5000);
      let q = req.supabase!
        .from('wellbeing_check_ins')
        .select('*')
        .order('checked_in_at', { ascending: false })
        .limit(limit);
      if (req.query.from) q = q.gte('checked_in_at', req.query.from);
      if (req.query.to) q = q.lte('checked_in_at', req.query.to);
      const { data, error } = await q;
      if (error) throw app.httpErrors.internalServerError(error.message);
      return { check_ins: data ?? [] };
    },
  );

  app.post('/api/health/check-ins', async (req, reply) => {
    const parsed = CreateWellbeingCheckInSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const { data, error } = await req.supabase!
      .from('wellbeing_check_ins')
      .insert(parsed.data)
      .select('*')
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(201).send(data);
  });

  app.delete<{ Params: { id: string } }>('/api/health/check-ins/:id', async (req, reply) => {
    const { error } = await req.supabase!.from('wellbeing_check_ins').delete().eq('id', req.params.id);
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(204).send();
  });

  // ─── Medications + supplements + vitamins ──────────────────────────────

  app.get<{ Querystring: { active?: string; kind?: string } }>(
    '/api/health/medications',
    async (req) => {
      let q = req.supabase!
        .from('medications')
        .select('*')
        .order('kind', { ascending: true })
        .order('name', { ascending: true });
      if (req.query.active === 'true') q = q.eq('active', true);
      if (req.query.active === 'false') q = q.eq('active', false);
      if (req.query.kind) q = q.eq('kind', req.query.kind);
      const { data, error } = await q;
      if (error) throw app.httpErrors.internalServerError(error.message);
      return { medications: data ?? [] };
    },
  );

  app.post('/api/health/medications', async (req, reply) => {
    const parsed = CreateMedicationSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const { data, error } = await req.supabase!
      .from('medications')
      .insert(parsed.data)
      .select('*')
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(201).send(data);
  });

  app.patch<{ Params: { id: string } }>('/api/health/medications/:id', async (req, reply) => {
    const parsed = UpdateMedicationSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    if (Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: 'empty_payload' });
    }
    const { data, error } = await req.supabase!
      .from('medications')
      .update(parsed.data)
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    return data;
  });

  app.delete<{ Params: { id: string } }>('/api/health/medications/:id', async (req, reply) => {
    const { error } = await req.supabase!.from('medications').delete().eq('id', req.params.id);
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(204).send();
  });

  // ─── History (singleton) ───────────────────────────────────────────────

  app.get('/api/health/history', async (req) => {
    const { data, error } = await req.supabase!
      .from('health_history')
      .select('*')
      .eq('id', true)
      .maybeSingle();
    if (error) throw app.httpErrors.internalServerError(error.message);
    // Migration seeds the row; this fallback is just defense in depth.
    return data ?? {
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
    const { data, error } = await req.supabase!
      .from('health_history')
      .update(parsed.data)
      .eq('id', true)
      .select('*')
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    return data;
  });

  // ─── Overview snapshot ─────────────────────────────────────────────────
  // Single endpoint that powers the Health landing page. Pulls the most
  // recent of each thing the UI wants to surface in one round-trip so the
  // overview load is one HTTP request, not eight.

  app.get('/api/health/overview', async (req) => {
    const sb = req.supabase!;
    const [
      latestVitals, recentCheckIns, recentLabs, upcomingVisits,
      activeMedications,
    ] = await Promise.all([
      // Latest reading per known vital metric — fetch the last 30 of each
      // common metric type and let the UI pick out the most recent.
      sb.from('health_metrics')
        .select('id, measured_at, metric, value, value_secondary, unit, source')
        .in('metric', ['weight', 'bp', 'hr_resting', 'sleep_duration', 'sleep_score', 'hrv_overnight', 'spo2_avg'])
        .order('measured_at', { ascending: false })
        .limit(50),
      sb.from('wellbeing_check_ins')
        .select('*')
        .order('checked_in_at', { ascending: false })
        .limit(5),
      sb.from('lab_panels')
        .select('id, drawn_date, panel_name, results:lab_results(id, analyte, flag)')
        .order('drawn_date', { ascending: false })
        .limit(3),
      sb.from('health_visits')
        .select('id, visit_date, provider_name, visit_type, reason')
        .gte('visit_date', new Date().toISOString().slice(0, 10))
        .order('visit_date', { ascending: true })
        .limit(5),
      sb.from('medications')
        .select('*')
        .eq('active', true)
        .order('kind')
        .order('name'),
    ]);

    return {
      latest_vitals: latestVitals.data ?? [],
      recent_check_ins: recentCheckIns.data ?? [],
      recent_labs: recentLabs.data ?? [],
      upcoming_visits: upcomingVisits.data ?? [],
      active_medications: activeMedications.data ?? [],
    };
  });
};
