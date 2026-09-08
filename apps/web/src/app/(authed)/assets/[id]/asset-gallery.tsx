'use client';

import { useState, useTransition } from 'react';
import type { Attachment } from '@/lib/api';
import { ImageUploader } from '@/components/ImageUploader';
import { PhotoGallery } from '@/components/PhotoGallery';
import { patchAssetPhotosAction } from './actions';

// The asset's photos (0050): the composed gallery, an uploader into the
// `assets/` folder, and per-photo controls. The hero is EXPLICIT —
// attachments[0], chosen with "Set as hero", never upload order.
//
// Every change is an OPERATION against the server's current array — add,
// remove, set hero — never a whole-array save. An upload that finishes
// after you removed a photo or chose a hero appends to what is there now,
// so it can't resurrect the removed one or undo the choice; the same holds
// across two tabs. The list shown is what the server returned.

export function AssetGallery({
  assetId,
  assetName,
  attachments: initial,
}: {
  assetId: string;
  assetName: string;
  attachments: Attachment[];
}) {
  const [attachments, setAttachments] = useState<Attachment[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const apply = (op: { add?: Attachment[]; remove?: string[]; hero?: string }) => {
    setError(null);
    start(async () => {
      const res = await patchAssetPhotosAction({ assetId, ...op });
      if (res.ok) setAttachments(res.attachments);
      else setError(res.error);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <PhotoGallery attachments={attachments} />
      {attachments.length > 0 && (
        <ul className="flex flex-col gap-1">
          {attachments.map((a, i) => (
            <li key={a.storage_path} className="flex items-center gap-2 font-mono text-[10px] text-ink-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.url} alt="" className="h-7 w-7 shrink-0 rounded-sm border border-line object-cover" />
              <span className="min-w-0 flex-1 truncate">{i === 0 ? 'hero' : a.location ?? a.alt ?? a.storage_path.split('/').pop()}</span>
              {i !== 0 && (
                <button type="button" onClick={() => apply({ hero: a.storage_path })} disabled={pending} className="uppercase tracking-[0.08em] hover:text-accent disabled:opacity-40">
                  set as hero
                </button>
              )}
              <button type="button" onClick={() => apply({ remove: [a.storage_path] })} disabled={pending} className="uppercase tracking-[0.08em] hover:text-accent disabled:opacity-40">
                remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <ImageUploader
        attachments={[]}
        onChange={(added) => {
          if (added.length > 0) apply({ add: added });
        }}
        prefix="assets"
        label="Add photos"
        titleHint={() => assetName}
      />
      {error && <p role="alert" className="font-sans text-[12px] text-accent">{error}</p>}
    </div>
  );
}
