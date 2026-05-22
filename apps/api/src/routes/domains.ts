import type { FastifyPluginAsync } from 'fastify';

// Read-only domain endpoint. Single-user system, so we surface every active
// domain. Editing/CRUD on domains lands later once we have the Domain detail
// screen with failure-pattern editor.

export const domainRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  app.get('/api/domains', async (req) => {
    const { data, error } = await req.supabase!
      .from('stewardship_domains')
      .select('*')
      .eq('active', true)
      .order('name', { ascending: true });
    if (error) throw app.httpErrors.internalServerError(error.message);
    return { domains: data ?? [] };
  });
};
