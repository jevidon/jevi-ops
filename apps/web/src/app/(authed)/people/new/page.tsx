import Link from 'next/link';
import { ScreenHeader } from '@/components/ScreenHeader';
import { companiesApi, ApiError } from '@/lib/api';
import { PersonForm } from '../person-form';

export default async function NewPersonPage() {
  let companies: Array<{ id: string; name: string }> = [];
  try {
    companies = (await companiesApi.list()).companies.map((c) => ({ id: c.id, name: c.name }));
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
  }

  return (
    <div>
      <div className="px-5 lg:px-0 pt-4 pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
        <Link href="/people" className="hover:text-ink-2 transition-colors">
          ← People
        </Link>
      </div>
      <ScreenHeader eyebrow="People" title="New person" />
      <div className="hairline mb-6" />
      <div className="px-5 lg:px-0">
        <PersonForm
          companies={companies}
          initial={{
            name: '',
            relationship_type: '',
            email: '',
            phone: '',
            company_id: '',
            role_at_company: '',
            is_primary_contact: false,
            birthday: '',
            anniversary: '',
            notes: '',
          }}
        />
      </div>
    </div>
  );
}
