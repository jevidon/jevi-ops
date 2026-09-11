import { notFound } from 'next/navigation';
import type { CoreSetupContext, OnboardingModuleDefinition, OnboardingSession } from '@jevi-ops/shared/schemas';
import { api, ApiError, settingsApi } from '@/lib/api';
import { CoreOnboardingScreen } from '../core-onboarding-screen';
import { VehicleOnboardingScreen } from '../vehicle-onboarding-screen';
import { ResumeUpdatedSetup } from '../resume-updated-setup';

export default async function OnboardingSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let loaded: { session: OnboardingSession; module: OnboardingModuleDefinition; warning: { code: string; can_migrate: boolean } | null };
  try { loaded = await api.get(`/api/onboarding/sessions/${id}`); }
  catch (err) { if (err instanceof ApiError && (err.status === 400 || err.status === 404)) notFound(); throw err; }
  if (loaded.warning && ['in_progress', 'deferred'].includes(loaded.session.status)) return <ResumeUpdatedSetup session={loaded.session} canMigrate={loaded.warning.can_migrate} />;
  if (loaded.session.module_id === 'vehicle') return <VehicleOnboardingScreen initialSession={loaded.session} module={loaded.module} />;
  const [settings, context, { items }] = await Promise.all([
    settingsApi.getApp(), api.get<CoreSetupContext>(`/api/onboarding/sessions/${id}/core-context`), settingsApi.integrationsStatus(),
  ]);
  return <CoreOnboardingScreen initialSession={loaded.session} module={loaded.module} initialSettings={settings} initialContext={context} integrations={items} />;
}
