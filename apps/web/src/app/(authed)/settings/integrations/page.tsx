import { ScreenHeader } from '@/components/ScreenHeader';
import {
  settingsApi,
  ApiError,
  type IntegrationItem,
  type IntegrationCategory,
} from '@/lib/api';
import Link from 'next/link';

// /settings/integrations — read-only inventory of what's wired up via env
// vars. Shows "configured / partial / missing" per integration with a
// helpful detail string. NEVER renders actual secret values — the API
// returns only presence flags + descriptive text.
//
// Rotation workflow: open this page → see what's broken → fix it in
// XCloud's per-site env var editor (or the local .env for dev) → redeploy
// (or `pm2 restart` for prod) → reload this page to verify.

const CATEGORY_LABELS: Record<IntegrationCategory, string> = {
  infrastructure: 'Infrastructure',
  ai: 'AI services',
  integrations: 'Integrations',
  notifications: 'Notifications',
};

const CATEGORY_ORDER: IntegrationCategory[] = [
  'infrastructure',
  'ai',
  'integrations',
  'notifications',
];

export default async function IntegrationsStatusPage() {
  let items: IntegrationItem[] = [];
  let errorMessage: string | null = null;

  try {
    const res = await settingsApi.integrationsStatus();
    items = res.items;
  } catch (err) {
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  const grouped = new Map<IntegrationCategory, IntegrationItem[]>();
  for (const item of items) {
    const list = grouped.get(item.category) ?? [];
    list.push(item);
    grouped.set(item.category, list);
  }

  const configured = items.filter((i) => i.status === 'configured').length;
  const partial = items.filter((i) => i.status === 'partial').length;
  const missing = items.filter((i) => i.status === 'missing').length;

  return (
    <div>
      <ScreenHeader
        eyebrow="Settings"
        title="Integrations status"
        meta={
          items.length > 0
            ? `${configured} configured · ${partial} partial · ${missing} missing`
            : undefined
        }
      />
      <div className="hairline" />

      <div className="px-5 lg:px-0 pt-4">
        <p className="font-sans text-[13px] text-ink-2 leading-relaxed max-w-2xl">
          Live view of which env-var-backed services are reachable. No secret
          values are surfaced — only whether each variable is set. To rotate
          or set a value: edit the env var in XCloud&rsquo;s site settings
          (production) or repo <code className="font-mono">.env</code> (local),
          then redeploy or restart PM2. Reload this page to verify.
        </p>
        <p className="mt-2 font-sans text-[11px] text-ink-3">
          <Link href="/settings" className="hover:text-ink-2 transition-colors">
            ← Back to settings
          </Link>
        </p>
      </div>

      {errorMessage && (
        <div className="mx-5 lg:mx-0 mt-4 px-4 py-3 bg-accent/10 border border-accent text-accent font-mono text-[12px]">
          Couldn&rsquo;t read status: {errorMessage}
        </div>
      )}

      <div className="px-5 lg:px-0 mt-6 flex flex-col gap-8">
        {CATEGORY_ORDER.map((cat) => {
          const itemsForCat = grouped.get(cat);
          if (!itemsForCat || itemsForCat.length === 0) return null;
          return (
            <section key={cat}>
              <div className="eyebrow pb-2 border-b border-line mb-3">
                {CATEGORY_LABELS[cat]}
              </div>
              <ul className="flex flex-col gap-3">
                {itemsForCat.map((item) => (
                  <IntegrationRow key={item.key} item={item} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function IntegrationRow({ item }: { item: IntegrationItem }) {
  const glyph = item.status === 'configured' ? '✓' : item.status === 'partial' ? '⚠' : '✗';
  const tone =
    item.status === 'configured'
      ? 'text-ink'
      : item.status === 'partial'
      ? 'text-accent'
      : item.required
      ? 'text-accent'
      : 'text-ink-3';

  return (
    <li className="flex items-start gap-3 py-2 border-b border-line/40 last:border-b-0">
      <div className={`font-mono text-[14px] leading-tight w-6 shrink-0 ${tone}`}>
        {glyph}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline flex-wrap gap-2">
          <span className="font-sans text-[14px] text-ink">{item.label}</span>
          <span className={`font-mono text-[10px] uppercase tracking-wider ${tone}`}>
            {item.status}
            {item.required && item.status !== 'configured' ? ' · required' : ''}
          </span>
        </div>
        <div className="mt-0.5 font-mono text-[11px] text-ink-3 leading-snug break-all">
          {item.detail}
        </div>
        <div className="mt-1 font-sans text-[12px] text-ink-3 leading-snug">
          {item.purpose}
        </div>
      </div>
    </li>
  );
}
