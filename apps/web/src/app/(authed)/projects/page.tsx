import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/EmptyState';

export default function ProjectsPage() {
  return (
    <div>
      <ScreenHeader eyebrow="Active work" title="Projects" />
      <div className="hairline" />
      <EmptyState
        title="No projects yet"
        body="Create one via voice ('start project Reviews v2.4') or the + button once auth is wired."
      />
    </div>
  );
}
