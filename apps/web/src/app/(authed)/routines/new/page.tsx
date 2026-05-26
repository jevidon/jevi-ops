import Link from 'next/link';
import { ScreenHeader } from '@/components/ScreenHeader';
import { RoutineForm } from '../routine-form';

export default function NewRoutinePage() {
  return (
    <div>
      <div className="px-5 lg:px-0 pt-4 pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
        <Link href="/routines" className="hover:text-ink-2 transition-colors">
          ← Routines
        </Link>
      </div>
      <ScreenHeader eyebrow="Routines" title="New routine" />
      <div className="hairline mb-6" />
      <div className="px-5 lg:px-0">
        <RoutineForm
          initial={{
            name: '',
            description: '',
            time_of_day: 'anytime',
            specific_time: '',
            reminder_enabled: false,
            goal_days: null,
          }}
        />
      </div>
    </div>
  );
}
