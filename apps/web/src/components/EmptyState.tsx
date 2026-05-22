export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-5 py-10 text-center">
      <div className="font-serif text-[18px] text-ink-2 mb-1">{title}</div>
      <div className="font-sans text-[13px] text-ink-3 leading-relaxed">{body}</div>
    </div>
  );
}
