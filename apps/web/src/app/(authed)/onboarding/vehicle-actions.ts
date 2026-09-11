'use server';
import { api } from '@/lib/api';
export async function loadVehicleOptionsAction(): Promise<{ ok: true; value: { domains: { id: string; name: string }[] } } | { ok: false }> {
  try { return { ok: true, value: await api.get<{ domains: { id: string; name: string }[] }>('/api/domains') }; }
  catch { return { ok: false }; }
}
