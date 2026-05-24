#!/usr/bin/env node
// Post-deploy smoke test for the prod stack. Runs a handful of cheap
// HTTP checks against api.dashboard.jeradhill.com and
// dashboard.jeradhill.com to catch the kind of regressions that only
// show up in prod (missing env var, bad PM2 restart, expired SSL,
// Supabase connection broken, cron secret rotated but not propagated).
//
// Usage:
//   CRON_SECRET=… node scripts/smoke-prod.mjs
//
//   # Override the targets for staging or local:
//   API_URL=http://localhost:3001 WEB_URL=http://localhost:3000 \
//     CRON_SECRET=… node scripts/smoke-prod.mjs
//
// Exits 1 if any check fails. Designed to run after `git push` →
// XCloud deploy completes (give the deploy ~30s before running this).
//
// All checks are READ-only or hit endpoints whose only side effect is
// the same work the regular cron already does (observations is
// idempotent via source_ref dedupe). Reminders/daily-summary/overdue
// are NOT exercised here — those have user-visible side effects
// (Pushover pushes) we don't want fake-firing on every smoke run.

const API_URL = (process.env.API_URL || 'https://api.dashboard.jeradhill.com').replace(/\/$/, '');
const WEB_URL = (process.env.WEB_URL || 'https://dashboard.jeradhill.com').replace(/\/$/, '');
const CRON_SECRET = process.env.CRON_SECRET || '';

// ─── ANSI helpers ────────────────────────────────────────────────────────

const isTTY = process.stdout.isTTY;
const c = {
  green: (s) => (isTTY ? `\x1b[32m${s}\x1b[0m` : s),
  red:   (s) => (isTTY ? `\x1b[31m${s}\x1b[0m` : s),
  yellow:(s) => (isTTY ? `\x1b[33m${s}\x1b[0m` : s),
  dim:   (s) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s),
  bold:  (s) => (isTTY ? `\x1b[1m${s}\x1b[0m` : s),
};

// ─── Check runner ────────────────────────────────────────────────────────

const checks = [];
function check(name, fn) {
  checks.push({ name, fn });
}

async function timed(fn) {
  const t0 = performance.now();
  try {
    const result = await fn();
    return { ...result, ms: Math.round(performance.now() - t0) };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      ms: Math.round(performance.now() - t0),
    };
  }
}

async function get(url, opts = {}) {
  const res = await fetch(url, {
    method: 'GET',
    headers: opts.headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(opts.timeout ?? 15_000),
  });
  let body = '';
  // Only read body for small JSON / text responses; HEAD-ish.
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json') || ct.startsWith('text/')) {
    body = await res.text();
  }
  return { status: res.status, body, ct };
}

function expectStatus(res, want, label) {
  const wants = Array.isArray(want) ? want : [want];
  if (!wants.includes(res.status)) {
    return { ok: false, message: `${label}: status ${res.status}, expected ${wants.join('/')}` };
  }
  return { ok: true };
}

function parseJson(body) {
  try { return JSON.parse(body); } catch { return null; }
}

// ─── Checks ──────────────────────────────────────────────────────────────

check('api /healthz returns 200 with all services configured', async () => {
  const res = await get(`${API_URL}/healthz`);
  const e = expectStatus(res, 200, 'healthz');
  if (!e.ok) return e;
  const j = parseJson(res.body);
  if (!j) return { ok: false, message: 'healthz: non-JSON body' };
  const missing = [];
  if (!j.supabase_configured) missing.push('supabase');
  if (!j.anthropic_configured) missing.push('anthropic');
  if (!j.whisper_configured) missing.push('whisper');
  if (missing.length) return { ok: false, message: `unconfigured: ${missing.join(', ')}` };
  return { ok: true, message: 'all services configured' };
});

check('api /readyz returns 200 status=ready', async () => {
  const res = await get(`${API_URL}/readyz`);
  const e = expectStatus(res, 200, 'readyz');
  if (!e.ok) return e;
  const j = parseJson(res.body);
  if (j?.status !== 'ready') return { ok: false, message: `readyz: status=${j?.status}` };
  return { ok: true };
});

check('api root index returns 200', async () => {
  const res = await get(`${API_URL}/`);
  return expectStatus(res, 200, 'root');
});

check('api auth is enforced (no JWT → 401)', async () => {
  // Any authed route works; /api/domains is cheap and stable.
  const res = await get(`${API_URL}/api/domains`);
  // 401 is the expected unauth response; 403 is acceptable; anything
  // 2xx would mean auth is broken and the route is leaking data.
  if (res.status === 401 || res.status === 403) return { ok: true, message: `status ${res.status}` };
  return { ok: false, message: `domains without JWT returned ${res.status}, expected 401/403` };
});

check('api cron auth enforced (no secret → 401)', async () => {
  const res = await get(`${API_URL}/api/cron/observations`);
  return expectStatus(res, 401, 'cron no-secret');
});

check('api cron auth enforced (wrong secret → 401)', async () => {
  const res = await get(`${API_URL}/api/cron/observations?secret=definitely-not-the-secret`);
  return expectStatus(res, 401, 'cron wrong-secret');
});

check('api cron observations runs with valid secret', async () => {
  if (!CRON_SECRET) return { skip: true, message: 'CRON_SECRET env not set' };
  const res = await get(`${API_URL}/api/cron/observations`, {
    headers: { 'X-Cron-Secret': CRON_SECRET },
  });
  const e = expectStatus(res, 200, 'observations');
  if (!e.ok) return e;
  return { ok: true, message: 'observations endpoint responded 200' };
});

check('web root reachable (200 or redirect)', async () => {
  const res = await get(`${WEB_URL}/`);
  // Web root may redirect to /today or /signin depending on session.
  if (res.status >= 200 && res.status < 400) {
    return { ok: true, message: `status ${res.status}` };
  }
  return { ok: false, message: `root returned ${res.status}` };
});

check('web /sign-in returns 200', async () => {
  const res = await get(`${WEB_URL}/sign-in`);
  return expectStatus(res, 200, 'sign-in');
});

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log(c.bold('Prod smoke test'));
  console.log(c.dim(`  api: ${API_URL}`));
  console.log(c.dim(`  web: ${WEB_URL}`));
  if (!CRON_SECRET) {
    console.log(c.yellow('  warn: CRON_SECRET env not set — one check will skip'));
  }
  console.log();

  let pass = 0, fail = 0, skipped = 0;
  for (const { name, fn } of checks) {
    process.stdout.write(`  ${c.dim('·')} ${name} `);
    const r = await timed(fn);
    if (r.skip) {
      console.log(`${c.yellow('⊘')} ${c.dim(`${r.ms}ms`)} ${c.yellow(`skip: ${r.message || ''}`)}`);
      skipped++;
    } else if (r.ok) {
      console.log(`${c.green('✓')} ${c.dim(`${r.ms}ms`)} ${r.message ? c.dim(r.message) : ''}`);
      pass++;
    } else {
      console.log(`${c.red('✗')} ${c.dim(`${r.ms}ms`)} ${c.red(r.message || 'failed')}`);
      fail++;
    }
  }

  const total = pass + fail + skipped;
  const skipNote = skipped > 0 ? c.yellow(`, ${skipped} skipped`) : '';
  console.log();
  if (fail === 0) {
    console.log(c.green(c.bold(`✓ ${pass} of ${total} checks passed`)) + skipNote);
    process.exit(0);
  } else {
    console.log(c.red(c.bold(`✗ ${fail} of ${total} checks failed`)) + skipNote);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(c.red('smoke runner crashed:'), err);
  process.exit(2);
});
