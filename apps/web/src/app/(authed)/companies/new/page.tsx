import Link from 'next/link';
import { ScreenHeader } from '@/components/ScreenHeader';
import { domainsApi, ApiError } from '@/lib/api';
import { CompanyForm } from '../company-form';

// Non-system domains only — the Inbox system domain isn't a valid company home.
export default async function NewCompanyPage() {
  let domains: Array<{ id: string; name: string }> = [];
  try {
    domains = (await domainsApi.list()).domains
      .filter((d) => !d.is_system)
      .map((d) => ({ id: d.id, name: d.name }));
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
  }

  return (
    <div>
      <div className="px-5 lg:px-0 pt-4 pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
        <Link href="/companies" className="hover:text-ink-2 transition-colors">← Companies</Link>
      </div>
      <ScreenHeader eyebrow="CRM" title="New company" />
      <div className="hairline mb-4" />
      <div className="px-5 lg:px-0">
        <CompanyForm
          domains={domains}
          initial={{
            name: '',
            relationship_type: '',
            domain_id: '',
            website: '',
            primary_email: '',
            primary_phone: '',
            first_engagement_at: '',
            next_review_at: '',
            checkin_interval_days: null,
            notes: '',
            active: true,
          }}
        />
      </div>
    </div>
  );
}
