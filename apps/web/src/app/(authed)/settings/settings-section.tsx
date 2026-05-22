// Container for a Settings panel — eyebrow heading + content card.
// Mobile keeps the px-5 gutter, desktop drops it because the main container
// already has lg:px-12.

export function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="px-5 lg:px-0 pt-6">
      <div className="eyebrow pb-2 border-b border-line mb-4">{title}</div>
      {children}
    </section>
  );
}
