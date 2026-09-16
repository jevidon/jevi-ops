import { createServer, type Server } from 'node:http';

// A fake OpenAI-compatible server for tests: chat completions and audio
// transcriptions on one loopback port. Every request body is recorded so a
// test can prove that nothing (or exactly one thing) was sent.

export interface FakeLlmState {
  bodies: Array<Record<string, unknown>>;
  /** Content of the next chat completion. */
  reply: string;
  /** Text returned by /v1/audio/transcriptions. */
  sttText: string;
  sttRequests: number;
  /** Artificial latency per request, ms. */
  delayMs: number;
  /** When set, chat completions respond with this HTTP status and no body. */
  failStatus: number | null;
}

export interface FakeLlm {
  port: number;
  baseUrl: string;
  state: FakeLlmState;
  close(): Promise<void>;
}

function completion(content: string) {
  return {
    id: 'x', object: 'chat.completion', created: 0, model: 'test',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
  };
}

export async function startFakeLlm(): Promise<FakeLlm> {
  const state: FakeLlmState = { bodies: [], reply: '{"actions":[]}', sttText: 'call the plumber about the hot water cylinder', sttRequests: 0, delayMs: 0, failStatus: null };
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const respond = () => {
        if (req.url?.includes('/audio/transcriptions')) {
          state.sttRequests += 1;
          res.setHeader('content-type', 'text/plain');
          res.end(state.sttText);
          return;
        }
        const raw = Buffer.concat(chunks).toString('utf8');
        try { state.bodies.push(JSON.parse(raw) as Record<string, unknown>); } catch { state.bodies.push({ raw }); }
        if (state.failStatus) { res.statusCode = state.failStatus; res.end(); return; }
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(completion(state.reply)));
      };
      if (state.delayMs > 0) setTimeout(respond, state.delayMs); else respond();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return {
    port,
    baseUrl: `http://127.0.0.1:${port}/v1`,
    state,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
