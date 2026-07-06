import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

// Password hashing via node:crypto scrypt — zero native dependencies,
// OWASP-acceptable parameters for a single-user, tailnet-only service.
// Stored format: scrypt$N$r$p$<salt b64>$<hash b64> so parameters can be
// raised later without invalidating existing hashes (verify reads the
// params from the stored string).

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const N = 2 ** 16; // CPU/memory cost
const R = 8;       // block size
const P = 1;       // parallelization
const KEYLEN = 64;
// scrypt needs ~128*N*r bytes; default maxmem (32MB) is too small for N=2^16.
const MAXMEM = 128 * N * R * 2;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const n = parseInt(nStr!, 10);
  const r = parseInt(rStr!, 10);
  const p = parseInt(pStr!, 10);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  const salt = Buffer.from(saltB64!, 'base64');
  const expected = Buffer.from(hashB64!, 'base64');
  try {
    const actual = await scrypt(password, salt, expected.length, {
      N: n, r, p, maxmem: 128 * n * r * 2,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
