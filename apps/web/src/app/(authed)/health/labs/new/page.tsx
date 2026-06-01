import Link from 'next/link';
import { ScreenHeader } from '@/components/ScreenHeader';
import { HealthTabBar } from '../../health-tab-bar';
import { PanelForm } from '../panel-form';

export default function NewPanelPage() {
  return (
    <div>
      <div className="px-5 lg:px-0 pt-4 pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
        <Link href="/health/labs" className="hover:text-ink-2 transition-colors">
          ← Labs
        </Link>
      </div>
      <ScreenHeader eyebrow="Personal record" title="New lab panel" />
      <div className="hairline" />
      <HealthTabBar />
      <div className="px-5 lg:px-0">
        <PanelForm />
      </div>
    </div>
  );
}
