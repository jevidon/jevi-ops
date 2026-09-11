import Link from 'next/link';
import { ResearchWorkersPanel } from '@/components/research/ResearchWorkersPanel';

export default function ResearchSettingsPage() {
  return <div className="mx-auto max-w-3xl space-y-5 px-5 py-6"><Link className="underline" href="/settings">Settings</Link><h1 className="font-serif text-2xl">Research workers</h1><ResearchWorkersPanel /></div>;
}
