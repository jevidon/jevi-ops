import { companiesApi, ApiError, type Company } from '@/lib/api';
import { getAppTimezone } from '@/lib/app-settings';
import { todayIsoDate } from '@/lib/today';
import { CompaniesView } from './companies-view';

// /companies — CRM (v2 redesign). Thin server shell: fetch companies (with
// last_interaction_at + active_project_count) + app-tz today, hand off to the
// client CompaniesView which owns the facet rail + card grid.

export const dynamic = 'force-dynamic';

export default async function CompaniesPage() {
  const tz = await getAppTimezone();
  const today = todayIsoDate(tz);

  let companies: Company[] = [];
  let errorMessage: string | null = null;
  try {
    const res = await companiesApi.list();
    companies = res.companies;
  } catch (err) {
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  if (errorMessage) {
    return (
      <div className="px-5 lg:px-10 pt-8">
        <h1 className="font-serif text-[40px] font-medium tracking-[-0.022em] text-ink">Companies</h1>
        <p className="mt-4 font-sans text-[13px] text-ink-3">Couldn&rsquo;t load companies: {errorMessage}</p>
      </div>
    );
  }

  return <CompaniesView companies={companies} today={today} tz={tz} />;
}
