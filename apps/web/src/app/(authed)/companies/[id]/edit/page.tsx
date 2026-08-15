import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ScreenHeader } from '@/components/ScreenHeader';
import { companiesApi, domainsApi, ApiError } from '@/lib/api';
import { CompanyForm } from '../../company-form';

export default async function EditCompanyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [detailRes, domainsRes] = await Promise.allSettled([
    companiesApi.get(id),
    domainsApi.list(),
  ]);

  if (detailRes.status === 'rejected') {
    if (detailRes.reason instanceof ApiError && detailRes.reason.status === 404) notFound();
    throw detailRes.reason;
  }
  const company = detailRes.value.company;
  const domains =
    domainsRes.status === 'fulfilled'
      ? domainsRes.value.domains.filter((d) => !d.is_system).map((d) => ({ id: d.id, name: d.name }))
      : [];

  return (
    <div>
      <div className="px-5 lg:px-0 pt-4 pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
        <Link href={`/companies/${id}`} className="hover:text-ink-2 transition-colors">← {company.name}</Link>
      </div>
      <ScreenHeader eyebrow="CRM" title="Edit company" />
      <div className="hairline mb-4" />
      <div className="px-5 lg:px-0">
        <CompanyForm
          domains={domains}
          initial={{
            id: company.id,
            name: company.name,
            relationship_type: company.relationship_type ?? '',
            domain_id: company.domain_id ?? '',
            website: company.website ?? '',
            primary_email: company.primary_email ?? '',
            primary_phone: company.primary_phone ?? '',
            first_engagement_at: company.first_engagement_at ?? '',
            next_review_at: company.next_review_at ?? '',
            checkin_interval_days: company.checkin_interval_days ?? null,
            notes: company.notes ?? '',
            active: company.active,
          }}
        />
      </div>
    </div>
  );
}
