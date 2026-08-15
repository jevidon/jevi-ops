import Link from 'next/link';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PersonForm } from '../person-form';

export default function NewPersonPage() {
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
          initial={{
            name: '',
            relationship_type: '',
            email: '',
            phone: '',
            company: '',
            notes: '',
          }}
        />
      </div>
    </div>
  );
}
