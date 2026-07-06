import type { FastifyPluginAsync } from 'fastify';
import { gt } from 'drizzle-orm';
import { env } from '../lib/env.js';
import { getDb } from '../lib/db.js';
import { quotes } from '../db/schema.js';

// /api/widget/* — secret-gated read endpoints for external surfaces
// (iOS Scriptable widgets, Android HTTP Shortcuts, etc.) that can't
// carry a session. The secret is the only access control.

// Quote text gets truncated to this many chars before being returned so
// long highlights don't blow out the widget card. Truncated at a word
// boundary with an ellipsis appended.
const MAX_QUOTE_CHARS = 360;

interface BookInfo {
  id: string;
  title: string;
  author: string | null;
  cover_image_url: string | null;
}

interface WidgetQuote {
  id: string;
  text: string;
  source_type: string | null;
  source_author: string | null;
  source_reference: string | null;
  source_url: string | null;
  book: BookInfo | null;
  href: string; // dashboard deep link for tap-through
}

function truncateAtWord(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

export const widgetRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { secret?: string } }>(
    '/api/widget/quote',
    async (req, reply) => {
      if (!env.WIDGET_SECRET) {
        return reply.code(503).send({ error: 'widget_disabled', reason: 'WIDGET_SECRET not set' });
      }
      const provided = req.query.secret ?? '';
      if (provided !== env.WIDGET_SECRET) {
        return reply.code(401).send({ error: 'unauthorized' });
      }

      // Pull every quote with resurface_weight > 0 plus its book join.
      // Personal library scale (~thousands at most); full scan is fine,
      // and it keeps the weighted pick logic in one place.
      const rows = await getDb().query.quotes.findMany({
        columns: {
          id: true, text: true, source_type: true, source_author: true,
          source_reference: true, source_url: true, resurface_weight: true,
        },
        with: { book: { columns: { id: true, title: true, author: true, cover_image_url: true } } },
        where: gt(quotes.resurface_weight, 0),
      });

      if (rows.length === 0) {
        return reply.code(200).send({ item: null });
      }

      // Weighted random pick. Multiplier is the resurface_weight column
      // (1.0 default; users boost to 2/5 or exclude with 0).
      const totalWeight = rows.reduce((sum, r) => sum + Number(r.resurface_weight ?? 1), 0);
      if (totalWeight <= 0) return reply.code(200).send({ item: null });
      const pickAt = Math.random() * totalWeight;
      let acc = 0;
      let chosen = rows[0]!;
      for (const r of rows) {
        acc += Number(r.resurface_weight ?? 1);
        if (acc >= pickAt) {
          chosen = r;
          break;
        }
      }

      // Tap-through target. WEB_PUBLIC_URL is the explicit "public origin
      // of the web app". Don't read CORS_ORIGINS — that often lists
      // localhost first for dev and we can't tell prod from dev by
      // string-sniffing.
      const dashboardOrigin = (env.WEB_PUBLIC_URL ?? env.WEB_APP_URL).replace(/\/$/, '');

      const payload: { item: WidgetQuote } = {
        item: {
          id: chosen.id,
          text: truncateAtWord((chosen.text ?? '').trim(), MAX_QUOTE_CHARS),
          source_type: chosen.source_type ?? null,
          source_author: chosen.source_author ?? null,
          source_reference: chosen.source_reference ?? null,
          source_url: chosen.source_url ?? null,
          book: chosen.book
            ? {
                id: chosen.book.id,
                title: chosen.book.title,
                author: chosen.book.author ?? null,
                cover_image_url: chosen.book.cover_image_url ?? null,
              }
            : null,
          href: `${dashboardOrigin}/library/quotes/${chosen.id}`,
        },
      };

      return payload;
    },
  );
};
