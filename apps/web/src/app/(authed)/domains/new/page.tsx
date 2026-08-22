import { ScreenHeader } from '@/components/ScreenHeader';
import { DomainCreateForm } from './domain-create-form';

// /domains/new — manual domain creation (Capture Portal "Domain" tile).
// Deliberately minimal: name + description. Cadence rules, staleness
// config, and the engraved illustration are set up afterwards on the
// detail page this redirects to.

export default function NewDomainPage() {
  return (
    <div>
      {/* No trail — same reasoning as /projects/new: /work never rides in
          trails; the Topbar fallback labels this page. */}
      <ScreenHeader
        eyebrow="Capture"
        title="New domain"
        meta="A standing area of stewardship"
      />
      <div className="hairline mb-6" />

      <div className="px-5 lg:px-0 max-w-2xl">
        <DomainCreateForm />
      </div>
    </div>
  );
}
