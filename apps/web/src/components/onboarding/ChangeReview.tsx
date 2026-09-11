import type { ReactNode } from 'react';

const internalField = /(?:^id$|_ids?$|^baseline$|fingerprint|operation_key|creation_key|^revision$|_version$|^created_at$|^updated_at$|^actor$|^preconditions$)/i;
const label = (key: string) => key === 'doc_md' || key === 'narrative' ? 'Authored Markdown' : key.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());

/** Show the reviewed values without exposing concurrency machinery as form content. */
export function ReadableValues({ value, depth = 0 }: { value: unknown; depth?: number }): ReactNode {
  if (value == null) return <span>Not recorded</span>;
  if (typeof value === 'boolean') return <span>{value ? 'Yes' : 'No'}</span>;
  if (typeof value !== 'object') return <span className="whitespace-pre-wrap break-words">{String(value)}</span>;
  if (depth > 8) return <span>Additional nested record details</span>;
  if (Array.isArray(value)) return value.length ? <ul className="space-y-2 pl-4">{value.map((item, index) => <li key={index}><ReadableValues value={item} depth={depth + 1} /></li>)}</ul> : <span>None selected</span>;
  const visible = Object.entries(value).filter(([key]) => !internalField.test(key));
  return visible.length ? <dl className="space-y-2 text-sm">{visible.map(([key, item]) => <div key={key}>
    <dt className="font-medium">{label(key)}</dt><dd className="pl-3">{key === 'doc_md' && typeof item === 'string' ? <p className="whitespace-pre-wrap">{item}</p> : <ReadableValues value={item} depth={depth + 1} />}</dd>
  </div>)}</dl> : <span>No additional displayed values</span>;
}

export function ChangeReview({ changes }: { changes: { label: string; before?: unknown; after?: unknown }[] }) {
  return changes.length ? <ul className="space-y-4">{changes.map((change, index) => <li key={index} className="space-y-2">
    <strong>{change.label}</strong>
    {change.before !== undefined && <details><summary>Current values</summary><ReadableValues value={change.before} /></details>}
    {change.after !== undefined && <div className="space-y-1"><p className="text-sm font-medium">Proposed values</p><ReadableValues value={change.after} /></div>}
  </li>)}</ul> : <p>No additional records will change.</p>;
}
