// Regenerates packages/shared/fixtures/durable-capture/digest.json from
// create-text.json. Run from apps/api: ./node_modules/.bin/tsx scripts/capture-digest.mts
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, sha256Hex } from '../src/lib/capture/digest.js';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../packages/shared/fixtures/durable-capture');
const fixture = 'create-text.json';
const envelope = JSON.parse(readFileSync(resolve(dir, fixture), 'utf8')) as Record<string, unknown>;
const { operation_id: _omit, ...rest } = envelope;
const canonical = canonicalJson(rest);
const out = { fixture, note: 'sha256 of canonical JSON (sorted keys, no whitespace, UTF-8) of the envelope with operation_id removed.', canonical, sha256: sha256Hex(canonical) };
writeFileSync(resolve(dir, 'digest.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(out.sha256);
