import Link from 'next/link';
import { ScreenHeader } from '@/components/ScreenHeader';
import { HealthTabBar } from '../../health-tab-bar';
import { VisitForm } from '../visit-form';

export default function NewVisitPage() {
  return (
    <div>
      <div className="px-5 lg:px-0 pt-4 pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
        <Link href="/health/visits" className="hover:text-ink-2 transition-colors">
          ← Visits
        </Link>
      </div>
      <ScreenHeader eyebrow="Personal record" title="New visit" />
      <div className="hairline" />
      <HealthTabBar />
      <div className="px-5 lg:px-0">
        <VisitForm
          initial={{
            visit_date: '',
            provider_name: '',
            provider_specialty: '',
            visit_type: '',
            reason: '',
            assessment: '',
            plan: '',
            notes: '',
            follow_up_date: '',
          }}
        />
      </div>
    </div>
  );
}
