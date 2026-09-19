// Bound decoded response bytes too: Content-Length may be absent or describe
// compressed data. The fetch's timeout remains active while reading the body.
const MAX_RESPONSE_BYTES = 1024 * 1024;

export async function readModelList(response: Response): Promise<{ models: string[]; loaded?: string[] }> {
  if (!response.body) throw new Error('Model server returned an empty response.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('Model list exceeds the 1 MiB response limit.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('Model server returned invalid JSON.');
  }
  if (!payload || typeof payload !== 'object' || !('data' in payload) || !Array.isArray(payload.data)) {
    throw new Error('Expected a model list with a data array.');
  }

  const models = new Set<string>();
  const loaded = new Set<string>();
  let reportsLoaded = false;
  for (const entry of payload.data) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string') continue;
    models.add(entry.id);
    if (typeof entry.loaded === 'boolean') reportsLoaded = true;
    if (entry.loaded === true) loaded.add(entry.id);
  }
  const loadedIds = [...loaded].sort();
  return {
    models: [...loadedIds, ...[...models].filter((id) => !loaded.has(id)).sort()],
    ...(reportsLoaded ? { loaded: loadedIds } : {}),
  };
}
