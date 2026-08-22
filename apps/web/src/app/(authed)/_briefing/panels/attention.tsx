import { AttentionItemRow } from '@/components/attention/AttentionItemRow';
import { PanelFrame, PanelLink } from '../PanelFrame';
import type { BriefingContext } from '../registry';

// Attention — the non-silent-client rules (waiting / content / ideas …),
// high+normal urgency, top 5.

export function AttentionPanel({ ctx }: { ctx: BriefingContext }) {
  const { attentionItems, attentionActiveCount } = ctx;
  if (attentionItems.length === 0) return null;
  return (
    <PanelFrame
      eyebrow={<>Attention{attentionActiveCount > 0 ? ` · ${attentionActiveCount} active` : ''}</>}
      action={
        attentionActiveCount > attentionItems.length
          ? <PanelLink href="/attention">See all →</PanelLink>
          : undefined
      }
      headerGap="mb-2"
    >
      <ul>
        {attentionItems.map((it) => <AttentionItemRow key={it.id} item={it} />)}
      </ul>
    </PanelFrame>
  );
}
