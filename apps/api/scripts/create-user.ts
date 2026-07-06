import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { eq } from 'drizzle-orm';
import { getDb, closeDb } from '../src/lib/db.js';
import { auth_user } from '../src/db/schema.js';
import { hashPassword } from '../src/lib/passwords.js';

// One-time user setup for the single-user system.
//
//   pnpm --filter @jevi-ops/api exec tsx scripts/create-user.ts --email you@example.com [--id <uuid>]
//
// Prompts for the password with echo off. Upserts by email — re-running
// with the same email rotates the password. --id lets a migration reuse
// the old Supabase auth uid for continuity (nothing references it today,
// but it keeps logs/bridge claims consistent across the cutover).

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

// Piped stdin (scripted provisioning, docker exec): both lines can arrive in
// one tick, so buffer every line eagerly and let prompts consume the queue —
// a per-prompt once('line') would miss lines emitted between prompts.
let pipedQueue: string[] | null = null;
let pipedWaiter: ((line: string) => void) | null = null;

function initPipedInput(): void {
  if (pipedQueue) return;
  pipedQueue = [];
  const rl = createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    if (pipedWaiter) {
      const w = pipedWaiter;
      pipedWaiter = null;
      w(line);
    } else {
      pipedQueue!.push(line);
    }
  });
}

async function promptHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    initPipedInput();
    process.stdout.write(question + '\n');
    const queued = pipedQueue!.shift();
    if (queued !== undefined) return queued;
    return new Promise((resolve) => {
      pipedWaiter = resolve;
    });
  }
  // Interactive: muted stdout wrapper so the typed password never echoes.
  let muted = false;
  const mutedOut = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = createInterface({ input: process.stdin, output: mutedOut, terminal: true });
  return new Promise((resolve) => {
    mutedOut.write(question);
    muted = true;
    rl.question('', (answer) => {
      muted = false;
      mutedOut.write('\n');
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const email = argValue('--email')?.trim().toLowerCase();
  const id = argValue('--id')?.trim();
  if (!email || !email.includes('@')) {
    console.error('Usage: tsx scripts/create-user.ts --email you@example.com [--id <uuid>]');
    process.exit(1);
  }

  const password = await promptHidden(`Password for ${email}: `);
  if (password.length < 12) {
    console.error('Password must be at least 12 characters. (Use a generated 40+ char password.)');
    process.exit(1);
  }
  const confirm = await promptHidden('Confirm password: ');
  if (password !== confirm) {
    console.error('Passwords do not match.');
    process.exit(1);
  }

  const password_hash = await hashPassword(password);
  const db = getDb();

  const existing = await db.query.auth_user.findFirst({ where: eq(auth_user.email, email) });
  if (existing) {
    await db.update(auth_user).set({ password_hash }).where(eq(auth_user.id, existing.id));
    console.log(`Password updated for ${email} (id ${existing.id}).`);
  } else {
    const values: typeof auth_user.$inferInsert = { email, password_hash };
    if (id) values.id = id;
    const [row] = await db.insert(auth_user).values(values).returning({ id: auth_user.id });
    console.log(`User created: ${email} (id ${row?.id}).`);
  }
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
