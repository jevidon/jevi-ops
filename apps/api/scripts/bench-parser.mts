// One-off latency probe for the voice parser against a live local LLM
// server: cold call, then warm-up + call, reporting the server's own
// timings. Usage (from apps/api):
//   LLM_BASE_URL=http://127.0.0.1:8080/v1 LLM_MODEL=x ./node_modules/.bin/tsx scripts/bench-parser.mts "transcript"
import { env } from '../src/lib/env.js';
import { getDb, closeDb } from '../src/lib/db.js';
import { invalidateAppSettings } from '../src/lib/app-settings.js';
import { parseTranscript, warmParser } from '../src/lib/parser.js';

const baseUrl = process.env.BENCH_LLM_BASE_URL;
if (baseUrl) {
  env.LLM_PROVIDER = 'openai_compatible';
  env.LLM_BASE_URL = baseUrl;
  env.LLM_MODEL = process.env.BENCH_LLM_MODEL ?? 'local';
  invalidateAppSettings();
}
const transcript = process.argv[2] ?? 'add task to water the garden tomorrow and log 41235 kilometers on the car';
const db = getDb();
const log = { info: (o: Record<string, unknown>, msg: string) => console.log(msg, JSON.stringify(o)) };

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t = Date.now();
  const r = await fn();
  console.log(`${label}: ${Date.now() - t} ms`);
  return r;
}

console.log('— cold (server cache holds whatever it held)');
console.log(JSON.stringify(await timed('parse', () => parseTranscript(transcript, db, { log }))));
console.log('— warm-up, then the same parse');
await timed('warm', () => warmParser(db));
console.log(JSON.stringify(await timed('parse', () => parseTranscript(transcript, db, { log }))));
console.log('— repeat parse, nothing changed but the clock');
console.log(JSON.stringify(await timed('parse', () => parseTranscript(transcript + ' and buy milk', db, { log }))));
await closeDb();
