'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/EmptyState';
import { BottomSheet } from '@/components/BottomSheet';
import type { ShoppingItem, ShoppingList } from '@/lib/api';
import {
  RECURRENCE_GLYPH,
  RECURRENCE_LABELS,
  isRecurrencePattern,
  type RecurrencePattern,
} from '@jevi-ops/shared';
import {
  addItemAction,
  archiveItemAction,
  archiveListAction,
  createListAction,
  deleteItemAction,
  deleteListAction,
  flagItemAction,
  importShoppingAction,
  purchaseItemAction,
  renameListAction,
  undoPurchaseAction,
  updateItemAction,
  type ImportResult,
  type PurchaseResult,
  type SaveResult,
} from './actions';

// Shopping view. One section per list (store), rows in position order.
// The checkbox semantic is INVERTED from tasks: checked = needs buying.
// Tapping an unchecked row flags it needed; tapping a checked row marks
// it BOUGHT (ledger row + reset), with a transient Undo. "Clear without
// buying" lives in the row's edit sheet for the mistake/skip case.
//
// `effective_needed` (server-derived) folds in recurrence: rule items
// re-check themselves once a full interval passes since last purchase.

// Recurrence choices offered for shopping items. daily/weekdays exist in
// the shared vocabulary but are degenerate for shopping — omitted here.
const RULE_OPTIONS: Array<{ value: '' | RecurrencePattern; label: string }> = [
  { value: '', label: 'Manual (default)' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Every 3 months' },
  { value: 'semiannually', label: 'Every 6 months' },
  { value: 'yearly', label: 'Yearly' },
];

// Compact "bought 3d ago" label for stocked rows.
function boughtAgo(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms) || ms < 0) return null;
  const days = Math.floor(ms / 86_400_000);
  if (days === 0) return 'bought today';
  if (days < 14) return `bought ${days}d ago`;
  if (days < 60) return `bought ${Math.floor(days / 7)}w ago`;
  return `bought ${Math.floor(days / 30)}mo ago`;
}

export function ShoppingView({ lists }: { lists: ShoppingList[] }) {
  const [filter, setFilter] = useState<'all' | 'needed'>('all');

  const neededTotal = useMemo(
    () => lists.reduce((n, l) => n + l.items.filter((i) => i.effective_needed).length, 0),
    [lists],
  );

  const listRefs = useMemo(
    () => lists.map((l) => ({ id: l.id, name: l.name })),
    [lists],
  );

  const visible = useMemo(
    () =>
      lists
        .map((l) => ({
          list: l,
          items: filter === 'needed' ? l.items.filter((i) => i.effective_needed) : l.items,
        }))
        // In shopping mode, an all-stocked store drops out entirely.
        .filter((s) => filter === 'all' || s.items.length > 0),
    [lists, filter],
  );

  return (
    <div>
      <ScreenHeader
        eyebrow="Household"
        title="Shopping"
        meta={neededTotal > 0 ? `${neededTotal} needed` : 'All stocked'}
      />
      <div className="hairline" />

      {/* All | Needed filter — "Needed" is the in-store view. */}
      <div className="flex items-center gap-2 px-5 lg:px-0 pt-4">
        {(['all', 'needed'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider border transition-colors ${
              filter === f
                ? 'bg-ink text-bg border-ink'
                : 'border-line text-ink-3 hover:border-ink-2 hover:text-ink'
            }`}
          >
            {f === 'all' ? 'All' : `Needed${neededTotal > 0 ? ` · ${neededTotal}` : ''}`}
          </button>
        ))}
      </div>

      {listRefs.length > 0 && (
        <div className="px-5 lg:px-0 mt-4">
          <QuickAddForm listRefs={listRefs} />
        </div>
      )}

      {lists.length === 0 ? (
        <EmptyState
          title="No lists yet"
          body="Create a store below, or paste your grocery wiki page into Import to bring everything over in one go."
        />
      ) : filter === 'needed' && visible.length === 0 ? (
        <EmptyState title="All stocked" body="Nothing is flagged as needed right now." />
      ) : (
        visible.map(({ list, items }) => (
          <ListSection
            key={list.id}
            list={list}
            items={items}
            listRefs={listRefs}
            showAdd={filter === 'all'}
          />
        ))
      )}

      {filter === 'all' && (
        <div className="px-5 lg:px-0 mt-8 flex flex-col gap-6 pb-4">
          <NewListForm />
          <ImportForm />
        </div>
      )}
    </div>
  );
}

// ─── List section ──────────────────────────────────────────────────────

function ListSection({
  list,
  items,
  listRefs,
  showAdd,
}: {
  list: ShoppingList;
  items: ShoppingItem[];
  listRefs: Array<{ id: string; name: string }>;
  showAdd: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const neededCount = list.items.filter((i) => i.effective_needed).length;

  return (
    <section className="px-5 lg:px-0 mt-6">
      <div className="flex items-baseline justify-between gap-3 border-b border-line pb-2 group">
        <div className="eyebrow">
          {list.name}
          {list.items.length > 0 && (
            <span className="text-ink-4"> · {neededCount}/{list.items.length} needed</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label={`Edit list ${list.name}`}
          className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-ink transition-colors"
        >
          Edit
        </button>
      </div>

      {items.length === 0 ? (
        <div className="font-sans text-[13px] text-ink-3 italic py-3">Nothing here yet.</div>
      ) : (
        <ul className="py-1">
          {items.map((item) => (
            <ItemRow key={item.id} item={item} listRefs={listRefs} />
          ))}
        </ul>
      )}

      {showAdd && <AddItemForm listId={list.id} />}

      <ListMenuSheet list={list} open={menuOpen} onClose={() => setMenuOpen(false)} />
    </section>
  );
}

// ─── Item row ──────────────────────────────────────────────────────────

function ItemRow({
  item,
  listRefs,
}: {
  item: ShoppingItem;
  listRefs: Array<{ id: string; name: string }>;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const needed = item.effective_needed;
  const rule = isRecurrencePattern(item.recurrence_rule) ? item.recurrence_rule : null;

  // Transient "Bought · Undo" after a purchase.
  const [purchaseState, purchaseAction] = useActionState<PurchaseResult | null, FormData>(
    purchaseItemAction,
    null,
  );
  const [undoId, setUndoId] = useState<string | null>(null);
  useEffect(() => {
    if (purchaseState?.ok) {
      setUndoId(purchaseState.purchaseId);
      const t = setTimeout(() => setUndoId(null), 8000);
      return () => clearTimeout(t);
    }
  }, [purchaseState]);

  const ago = boughtAgo(item.last_purchased_at);

  return (
    <li className="flex items-center gap-3 py-1.5 group">
      {/* Checked = needed. Tapping a checked box means "bought it". */}
      {needed ? (
        <form action={purchaseAction} className="shrink-0">
          <input type="hidden" name="itemId" value={item.id} />
          <CheckboxButton checked label="Mark bought" />
        </form>
      ) : (
        <form action={flagItemAction} className="shrink-0">
          <input type="hidden" name="itemId" value={item.id} />
          <input type="hidden" name="needed" value="true" />
          <CheckboxButton checked={false} label="Mark needed" />
        </form>
      )}

      <button
        type="button"
        onClick={() => setEditOpen(true)}
        className="flex-1 min-w-0 text-left"
        title="Edit item"
      >
        <span
          className={`font-sans text-[14px] leading-snug ${needed ? 'text-ink' : 'text-ink-3'}`}
        >
          {item.name}
        </span>
        {item.note && (
          <span className="ml-2 font-sans text-[12px] text-ink-3">{item.note}</span>
        )}
        {!needed && ago && (
          <span className="ml-2 font-mono text-[9px] uppercase tracking-wider text-ink-4">
            {ago}
          </span>
        )}
      </button>

      {undoId && (
        <form action={undoPurchaseAction} className="shrink-0">
          <input type="hidden" name="purchaseId" value={undoId} />
          <button
            type="submit"
            className="font-mono text-[10px] uppercase tracking-wider text-accent hover:underline"
          >
            Bought · Undo
          </button>
        </form>
      )}

      {rule && (
        <span
          className={`font-mono text-[10px] uppercase tracking-wider shrink-0 ${
            item.auto_needed && !item.needed ? 'text-accent' : 'text-ink-3'
          }`}
          title={
            item.auto_needed && !item.needed
              ? `Auto-flagged — a full ${RECURRENCE_LABELS[rule].toLowerCase()} interval has passed since the last purchase.`
              : `Re-flags itself ${RECURRENCE_LABELS[rule].toLowerCase()} after each purchase.`
          }
        >
          {RECURRENCE_GLYPH} {RECURRENCE_LABELS[rule]}
        </span>
      )}
      {item.one_off && (
        <span
          className="font-mono text-[10px] uppercase tracking-wider text-ink-3 shrink-0"
          title="One-time item — leaves the list once bought."
        >
          once
        </span>
      )}

      <button
        type="button"
        onClick={() => setEditOpen(true)}
        aria-label={`Edit ${item.name}`}
        className="shrink-0 font-mono text-[12px] leading-none text-ink-3 hover:text-ink transition-colors px-1"
        title="Edit item"
      >
        ···
      </button>

      <ItemEditSheet
        item={item}
        listRefs={listRefs}
        open={editOpen}
        onClose={() => setEditOpen(false)}
      />
    </li>
  );
}

function CheckboxButton({ checked, label }: { checked: boolean; label: string }) {
  return (
    <button
      type="submit"
      aria-label={label}
      className={`h-5 w-5 border-2 flex items-center justify-center transition-colors ${
        checked ? 'bg-ink border-ink text-bg' : 'border-line hover:border-ink-2'
      }`}
    >
      {checked && (
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M3 8l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

// ─── Item edit sheet ───────────────────────────────────────────────────

function ItemEditSheet({
  item,
  listRefs,
  open,
  onClose,
}: {
  item: ShoppingItem;
  listRefs: Array<{ id: string; name: string }>;
  open: boolean;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState<SaveResult | null, FormData>(
    updateItemAction,
    null,
  );
  const [oneOff, setOneOff] = useState(item.one_off);
  useEffect(() => {
    if (state?.ok) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const rule = isRecurrencePattern(item.recurrence_rule) ? item.recurrence_rule : '';

  return (
    <BottomSheet open={open} onClose={onClose} title={item.name}>
      <div className="px-5 py-4 flex flex-col gap-5">
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="itemId" value={item.id} />
          <Field label="Name">
            <input
              type="text" name="name" required defaultValue={item.name} autoComplete="off"
              className="w-full bg-transparent border-b border-line focus:border-ink-2 focus:outline-none py-1.5 font-sans text-[14px] text-ink"
            />
          </Field>
          <Field label="Note">
            <input
              type="text" name="note" defaultValue={item.note ?? ''} autoComplete="off"
              placeholder="e.g. distilled"
              className="w-full bg-transparent border-b border-line focus:border-ink-2 focus:outline-none py-1.5 font-sans text-[14px] text-ink placeholder:text-ink-3/70"
            />
          </Field>
          <Field label="List">
            <select
              name="listId" defaultValue={item.list_id}
              className="w-full bg-transparent border-b border-line focus:border-ink-2 focus:outline-none py-1.5 font-sans text-[14px] text-ink"
            >
              {listRefs.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </Field>
          <label className="flex items-center gap-2 py-1 cursor-pointer select-none">
            <input
              type="checkbox" name="one_off" value="true" checked={oneOff}
              onChange={(e) => setOneOff(e.target.checked)}
              className="h-4 w-4 accent-ink"
            />
            <span className="font-sans text-[13px] text-ink">One-time</span>
            <span className="font-sans text-[12px] text-ink-3">— leaves the list once bought</span>
          </label>
          <Field label="Recurs">
            <select
              name="recurrence_rule" defaultValue={rule} disabled={oneOff}
              title={
                oneOff
                  ? 'One-time items have no cadence.'
                  : 'When set, the item re-flags itself as needed once this interval passes after a purchase.'
              }
              className="w-full bg-transparent border-b border-line focus:border-ink-2 focus:outline-none py-1.5 font-sans text-[14px] text-ink disabled:opacity-40"
            >
              {RULE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
          {state && !state.ok && (
            <span className="font-mono text-[10px] uppercase text-accent">{state.error}</span>
          )}
          <button
            type="submit" disabled={pending}
            className="self-start bg-ink hover:bg-ink-2 text-bg font-sans font-semibold text-[12px] uppercase tracking-wider px-4 py-2 transition-colors disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
        </form>

        <div className="border-t border-line pt-3 flex flex-wrap items-center gap-4">
          {item.effective_needed && (
            <form action={flagItemAction}>
              <input type="hidden" name="itemId" value={item.id} />
              <input type="hidden" name="needed" value="false" />
              <button
                type="submit" onClick={onClose}
                title={
                  item.recurrence_rule
                    ? 'Uncheck without logging a purchase. Counts as satisfied for this recurrence cycle.'
                    : 'Uncheck without logging a purchase.'
                }
                className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-ink transition-colors"
              >
                Clear without buying
              </button>
            </form>
          )}
          <form action={archiveItemAction}>
            <input type="hidden" name="itemId" value={item.id} />
            <button
              type="submit" onClick={onClose}
              title="Hide from the list; purchase history is kept."
              className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-ink transition-colors"
            >
              Archive
            </button>
          </form>
          <form action={deleteItemAction}>
            <input type="hidden" name="itemId" value={item.id} />
            <button
              type="submit" onClick={onClose}
              title="Deletes the item AND its purchase history. Archive keeps the history."
              className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
            >
              Delete
            </button>
          </form>
        </div>
      </div>
    </BottomSheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-3">{label}</span>
      {children}
    </label>
  );
}

// ─── Add item ──────────────────────────────────────────────────────────

// Small mono "once" toggle shared by both add forms. Unchecked boxes
// aren't submitted, so the action reads one_off === 'true' only when on.
function OnceToggle({ disabled }: { disabled?: boolean }) {
  return (
    <label
      className="flex items-center gap-1.5 shrink-0 cursor-pointer select-none"
      title="One-time item — leaves the list once bought."
    >
      <input type="checkbox" name="one_off" value="true" disabled={disabled} className="h-3.5 w-3.5 accent-ink" />
      <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">once</span>
    </label>
  );
}

// Global quick add: one input that files into any store. Lives at the top
// of the page so adding never requires scrolling to the right section.
function QuickAddForm({ listRefs }: { listRefs: Array<{ id: string; name: string }> }) {
  const [state, formAction, pending] = useActionState<SaveResult | null, FormData>(
    addItemAction,
    null,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  // Remember the last-used store across the form reset — chained entries
  // usually target the same list.
  const [listId, setListId] = useState(listRefs[0]?.id ?? '');

  useEffect(() => {
    if (state?.ok) {
      inputRef.current?.form?.reset();
      inputRef.current?.focus();
    }
  }, [state]);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3 border border-line px-3 py-2">
      <span className="text-ink-3 text-[14px] select-none" aria-hidden>+</span>
      <input
        ref={inputRef}
        type="text" name="name" required autoComplete="off" disabled={pending}
        placeholder="Quick add…"
        className="flex-1 min-w-[140px] bg-transparent focus:outline-none py-1 font-sans text-[14px] placeholder:text-ink-3/70 text-ink"
      />
      <select
        name="listId" value={listId} disabled={pending}
        onChange={(e) => setListId(e.target.value)}
        className="bg-transparent border-b border-line focus:border-ink-2 focus:outline-none py-1 font-mono text-[11px] uppercase tracking-wider text-ink-3 max-w-[160px]"
      >
        {listRefs.map((l) => (
          <option key={l.id} value={l.id}>{l.name}</option>
        ))}
      </select>
      <OnceToggle disabled={pending} />
      {state && !state.ok && (
        <span className="font-mono text-[10px] uppercase text-accent">{state.error}</span>
      )}
    </form>
  );
}

function AddItemForm({ listId }: { listId: string }) {
  const [state, formAction, pending] = useActionState<SaveResult | null, FormData>(
    addItemAction,
    null,
  );
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state?.ok) {
      // Clear + refocus on success so entries chain quickly.
      inputRef.current?.form?.reset();
      inputRef.current?.focus();
    }
  }, [state]);

  return (
    <form action={formAction} className="flex items-center gap-3 mt-1">
      <input type="hidden" name="listId" value={listId} />
      <span className="text-ink-3 text-[14px] select-none" aria-hidden>+</span>
      <input
        ref={inputRef}
        type="text" name="name" required autoComplete="off" disabled={pending}
        placeholder="Add an item…"
        className="flex-1 min-w-[160px] bg-transparent border-b border-line focus:border-ink-2 focus:outline-none py-1.5 font-sans text-[14px] placeholder:text-ink-3/70 text-ink"
      />
      <OnceToggle disabled={pending} />
      {state && !state.ok && (
        <span className="font-mono text-[10px] uppercase text-accent">{state.error}</span>
      )}
    </form>
  );
}

// ─── New list / list menu ──────────────────────────────────────────────

function NewListForm() {
  const [state, formAction, pending] = useActionState<SaveResult | null, FormData>(
    createListAction,
    null,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (state?.ok) {
      inputRef.current?.form?.reset();
      inputRef.current?.focus();
    }
  }, [state]);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <span className="eyebrow shrink-0">New list</span>
      <input
        ref={inputRef}
        type="text" name="name" required autoComplete="off" disabled={pending}
        placeholder="Store or section name…"
        className="flex-1 min-w-[160px] max-w-[320px] bg-transparent border-b border-line focus:border-ink-2 focus:outline-none py-1.5 font-sans text-[14px] placeholder:text-ink-3/70 text-ink"
      />
      {state && !state.ok && (
        <span className="font-mono text-[10px] uppercase text-accent">{state.error}</span>
      )}
    </form>
  );
}

function ListMenuSheet({
  list,
  open,
  onClose,
}: {
  list: ShoppingList;
  open: boolean;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState<SaveResult | null, FormData>(
    renameListAction,
    null,
  );
  useEffect(() => {
    if (state?.ok) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <BottomSheet open={open} onClose={onClose} title={list.name}>
      <div className="px-5 py-4 flex flex-col gap-5">
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="listId" value={list.id} />
          <Field label="Name">
            <input
              type="text" name="name" required defaultValue={list.name} autoComplete="off"
              className="w-full bg-transparent border-b border-line focus:border-ink-2 focus:outline-none py-1.5 font-sans text-[14px] text-ink"
            />
          </Field>
          {state && !state.ok && (
            <span className="font-mono text-[10px] uppercase text-accent">{state.error}</span>
          )}
          <button
            type="submit" disabled={pending}
            className="self-start bg-ink hover:bg-ink-2 text-bg font-sans font-semibold text-[12px] uppercase tracking-wider px-4 py-2 transition-colors disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Rename'}
          </button>
        </form>

        <div className="border-t border-line pt-3 flex flex-wrap items-center gap-4">
          <form action={archiveListAction}>
            <input type="hidden" name="listId" value={list.id} />
            <button
              type="submit" onClick={onClose}
              title="Hide the list and its items; everything is kept."
              className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-ink transition-colors"
            >
              Archive
            </button>
          </form>
          <form action={deleteListAction}>
            <input type="hidden" name="listId" value={list.id} />
            <button
              type="submit" onClick={onClose}
              title="Deletes the list, its items, AND their purchase history."
              className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
            >
              Delete
            </button>
          </form>
        </div>
      </div>
    </BottomSheet>
  );
}

// ─── Import ────────────────────────────────────────────────────────────

function ImportForm() {
  const [openForm, setOpenForm] = useState(false);
  const [state, formAction, pending] = useActionState<ImportResult | null, FormData>(
    importShoppingAction,
    null,
  );

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpenForm((v) => !v)}
        className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-ink transition-colors"
      >
        {openForm ? '− Import from markdown' : '+ Import from markdown'}
      </button>
      {openForm && (
        <form action={formAction} className="mt-3 flex flex-col gap-2 max-w-[560px]">
          <p className="font-sans text-[12px] text-ink-3 leading-relaxed">
            Paste your wiki page: headings become lists, <code className="font-mono">- [ ]</code>{' '}
            rows become items, and <code className="font-mono">- [x]</code> imports as needed.
            Re-pasting skips anything that already exists.
          </p>
          <textarea
            name="text" required rows={8} disabled={pending}
            placeholder={'## Household\n- [x] Bread\n- [ ] Ziploc bags'}
            className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-3 font-mono text-[12px] text-ink placeholder:text-ink-3/70"
          />
          <div className="flex items-center gap-3">
            <button
              type="submit" disabled={pending}
              className="bg-ink hover:bg-ink-2 text-bg font-sans font-semibold text-[12px] uppercase tracking-wider px-4 py-2 transition-colors disabled:opacity-50"
            >
              {pending ? 'Importing…' : 'Import'}
            </button>
            {state && (
              <span className={`font-sans text-[12px] ${state.ok ? 'text-ink-2' : 'text-accent'}`}>
                {state.ok
                  ? `Imported ${state.items} item${state.items === 1 ? '' : 's'} across ${state.lists} new list${state.lists === 1 ? '' : 's'}${state.skipped ? ` · ${state.skipped} already present` : ''}.`
                  : state.error}
              </span>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
