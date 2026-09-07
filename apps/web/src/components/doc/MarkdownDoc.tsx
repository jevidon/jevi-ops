'use client';

import { useState, useTransition } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { promoteChecklistLineAction } from './doc-actions';

// The rendered overview document (0050): GitHub-flavoured markdown in the
// house typography, HTML skipped. Task-list checkboxes are DOCUMENT-ONLY —
// they render as marks, never as controls, because a checkbox in prose is
// not a completion state; the "→ task" affordance beside a line turns it
// into a real task (the one completion state) when the page supplies a
// promote context.

export interface PromoteContext {
  projectId?: string | null;
  domainId?: string | null;
  source: string;     // "overview of Outback"
  revalidate: string; // the page to refresh after creating the task
}

type HastNode = { type?: string; value?: string; tagName?: string; children?: HastNode[] };

// The plain text of a list item, minus the checkbox input.
function hastText(node: HastNode | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.value ?? '';
  if (node.tagName === 'input') return '';
  return (node.children ?? []).map(hastText).join('');
}

function PromoteButton({ text, promote }: { text: string; promote: PromoteContext }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<'idle' | 'done' | 'error'>('idle');
  return (
    <button
      type="button"
      disabled={pending || state === 'done'}
      onClick={() =>
        start(async () => {
          const res = await promoteChecklistLineAction({
            title: text,
            projectId: promote.projectId ?? null,
            domainId: promote.domainId ?? null,
            source: promote.source,
            revalidate: promote.revalidate,
          });
          setState(res.ok ? 'done' : 'error');
        })
      }
      title={state === 'done' ? 'Task created' : 'Make this line a task'}
      className={`ml-2 align-baseline font-mono text-[9.5px] uppercase tracking-[0.08em] transition-colors ${
        state === 'done' ? 'text-ink-3' : state === 'error' ? 'text-accent' : 'text-ink-4 hover:text-accent'
      }`}
    >
      {pending ? '…' : state === 'done' ? 'task ✓' : state === 'error' ? 'failed' : '→ task'}
    </button>
  );
}

function components(promote?: PromoteContext): Components {
  return {
    h1: ({ children }) => <h2 className="font-serif text-[22px] font-medium tracking-[-0.01em] text-ink mt-6 mb-2 first:mt-0">{children}</h2>,
    h2: ({ children }) => <h3 className="font-serif text-[18px] font-medium text-ink mt-5 mb-1.5 first:mt-0">{children}</h3>,
    h3: ({ children }) => <h4 className="font-sans text-[14px] font-semibold text-ink mt-4 mb-1 first:mt-0">{children}</h4>,
    h4: ({ children }) => <h5 className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 mt-4 mb-1">{children}</h5>,
    p: ({ children }) => <p className="font-sans text-[14px] leading-relaxed text-ink mb-3 last:mb-0">{children}</p>,
    a: ({ href, children }) => {
      const external = typeof href === 'string' && /^https?:\/\//.test(href);
      return (
        <a href={href} className="text-accent underline decoration-accent/40 hover:decoration-accent" {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}>
          {children}
        </a>
      );
    },
    ul: ({ children, className }) => (
      <ul className={`mb-3 pl-5 font-sans text-[14px] leading-relaxed text-ink ${className?.includes('contains-task-list') ? 'list-none pl-1' : 'list-disc'}`}>{children}</ul>
    ),
    ol: ({ children }) => <ol className="mb-3 pl-5 list-decimal font-sans text-[14px] leading-relaxed text-ink">{children}</ol>,
    li: ({ node, children, className }) => {
      const isTask = typeof className === 'string' && className.includes('task-list-item');
      if (!isTask) return <li className="mb-0.5">{children}</li>;
      return (
        <li className="mb-0.5 flex items-baseline gap-1.5">
          <span className="min-w-0">{children}</span>
          {promote && <PromoteButton text={hastText(node as HastNode)} promote={promote} />}
        </li>
      );
    },
    input: ({ checked, type }) =>
      type === 'checkbox' ? (
        <span
          aria-hidden
          title="A checklist in the document — not a task. Use → task to make it one."
          className={`inline-flex h-3 w-3 shrink-0 items-center justify-center border border-line-strong align-[-1px] font-mono text-[8px] leading-none ${checked ? 'bg-ink-3 text-bg' : 'bg-transparent text-transparent'}`}
        >
          ✓
        </span>
      ) : null,
    code: ({ children, className }) => {
      const block = typeof className === 'string' && className.startsWith('language-');
      return block ? (
        <code className="font-mono text-[12px] text-ink">{children}</code>
      ) : (
        <code className="font-mono text-[12px] bg-surface-2 px-1 py-px text-ink">{children}</code>
      );
    },
    pre: ({ children }) => <pre className="mb-3 overflow-x-auto border border-line bg-surface p-3">{children}</pre>,
    blockquote: ({ children }) => <blockquote className="mb-3 border-l-2 border-line-strong pl-3 text-ink-2 italic">{children}</blockquote>,
    hr: () => <hr className="my-5 border-line" />,
    table: ({ children }) => (
      <div className="mb-3 overflow-x-auto">
        <table className="w-full border-collapse font-sans text-[13px] text-ink">{children}</table>
      </div>
    ),
    th: ({ children }) => <th className="border-b border-line-strong px-2 py-1 text-left font-mono text-[9.5px] uppercase tracking-[0.08em] text-ink-3">{children}</th>,
    td: ({ children }) => <td className="border-b border-line px-2 py-1 align-top">{children}</td>,
    img: ({ src, alt }) => (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={typeof src === 'string' ? src : undefined} alt={alt ?? ''} className="my-3 max-w-full rounded border border-line" />
    ),
    strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
  };
}

export function MarkdownDoc({ body, promote }: { body: string; promote?: PromoteContext }) {
  return (
    <div className="max-w-[68ch]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={components(promote)}>
        {body}
      </ReactMarkdown>
    </div>
  );
}
