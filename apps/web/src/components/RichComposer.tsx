'use client';

import { useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';

// Rich content composer (Addendum 07 §5). A paste-target — not a formatting
// toolbar. Paste rich HTML or formatted text → it renders formatted; two copy
// actions write it back out (rich text as text/html, or raw HTML source). All
// HTML is sanitized with DOMPurify on paste AND on load, so nothing unsafe is
// ever stored or rendered. DOMPurify only runs in the browser (event handlers
// / effects), never during SSR.
//
// Used by: YouTube descriptions (video, course), show notes (podcast), body
// (newsletter). The current HTML mirrors to a hidden input so the surrounding
// <form> submits it like any other field.

export function RichComposer({
  name,
  initialHtml,
  placeholder,
}: {
  name: string;
  initialHtml: string;
  placeholder?: string;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState(initialHtml);
  const [copied, setCopied] = useState<string | null>(null);

  // Seed the editor once, sanitized. Uncontrolled thereafter (contenteditable
  // manages its own DOM); we mirror innerHTML to state + the hidden input.
  useEffect(() => {
    if (editorRef.current) {
      const clean = DOMPurify.sanitize(initialHtml);
      editorRef.current.innerHTML = clean;
      setHtml(clean);
    }
    // Intentionally seed only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function sync() {
    if (editorRef.current) setHtml(editorRef.current.innerHTML);
  }

  function onPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault();
    const raw = e.clipboardData.getData('text/html') || e.clipboardData.getData('text/plain');
    // Plain text with no markup → insert as text (the plain-textarea fallback);
    // otherwise sanitize the pasted HTML before it touches the DOM.
    const hasMarkup = /<[a-z][\s\S]*>/i.test(raw);
    const clean = hasMarkup
      ? DOMPurify.sanitize(raw)
      : escapeHtml(e.clipboardData.getData('text/plain')).replace(/\n/g, '<br>');
    document.execCommand('insertHTML', false, clean);
    sync();
  }

  async function copyRich() {
    const clean = DOMPurify.sanitize(html);
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([clean], { type: 'text/html' }),
          'text/plain': new Blob([stripHtml(clean)], { type: 'text/plain' }),
        }),
      ]);
      flash('Rich text copied');
    } catch {
      // Older browsers / permissions — fall back to plain text.
      await navigator.clipboard.writeText(stripHtml(clean));
      flash('Copied as text');
    }
  }

  async function copyHtml() {
    await navigator.clipboard.writeText(DOMPurify.sanitize(html));
    flash('HTML copied');
  }

  function flash(msg: string) {
    setCopied(msg);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={sync}
        onPaste={onPaste}
        data-placeholder={placeholder ?? 'Paste formatted content…'}
        className="rich-composer min-h-[120px] max-h-[420px] overflow-y-auto bg-transparent border border-line focus:border-accent focus:outline-none p-3 font-sans text-[14px] text-ink leading-relaxed"
      />
      {/* `html` is already sanitized (on mount + on every paste), so we submit
          it directly. Never call DOMPurify at render time — it runs during SSR
          where there is no DOM and `.sanitize` is unavailable. */}
      <input type="hidden" name={name} value={html} />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={copyRich}
          className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
        >
          Copy rich text
        </button>
        <button
          type="button"
          onClick={copyHtml}
          className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
        >
          Copy HTML
        </button>
        {copied && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-ink-2">{copied}</span>
        )}
      </div>
    </div>
  );
}

// Read-only sanitized render of stored rich HTML. Sanitizes on the client
// (effect) so no unsanitized HTML is ever injected — SSR renders the plain-text
// fallback, the client swaps in the formatted version after mount.
export function RichHtml({ html, className }: { html: string | null; className?: string }) {
  const [clean, setClean] = useState<string | null>(null);
  useEffect(() => {
    setClean(html ? DOMPurify.sanitize(html) : '');
  }, [html]);

  if (!html) return null;
  if (clean === null) {
    return <div className={className}>{stripHtml(html)}</div>;
  }
  return <div className={className} dangerouslySetInnerHTML={{ __html: clean }} />;
}

function stripHtml(html: string): string {
  if (typeof document === 'undefined') return html.replace(/<[^>]*>/g, '');
  const el = document.createElement('div');
  el.innerHTML = DOMPurify.sanitize(html);
  return el.textContent ?? '';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
