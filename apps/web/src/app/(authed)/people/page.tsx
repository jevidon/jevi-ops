import { peopleApi, ApiError, type Person } from '@/lib/api';
import { getAppTimezone } from '@/lib/app-settings';
import { todayIsoDate } from '@/lib/today';
import { PeopleView } from './people-view';

// /people — relationships CRM (v2 redesign). Thin server shell: fetch the
// people (with synthesised last-contact) + app-tz today, hand off to the client
// PeopleView which owns the facet rail + card grid.

export const dynamic = 'force-dynamic';

export default async function PeoplePage() {
  const tz = await getAppTimezone();
  const today = todayIsoDate(tz);

  let people: Person[] = [];
  let errorMessage: string | null = null;
  try {
    const res = await peopleApi.list();
    people = res.people;
  } catch (err) {
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  if (errorMessage) {
    return (
      <div className="px-5 lg:px-10 pt-8">
        <h1 className="font-serif text-[40px] font-medium tracking-[-0.022em] text-ink">People</h1>
        <p className="mt-4 font-sans text-[13px] text-ink-3">Couldn&rsquo;t load people: {errorMessage}</p>
      </div>
    );
  }

  return <PeopleView people={people} today={today} tz={tz} />;
}
