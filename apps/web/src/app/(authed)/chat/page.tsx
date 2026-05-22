import { ScreenHeader } from '@/components/ScreenHeader';
import { ChatThread } from './chat-thread';

// /chat — query interface (spec §11). Single-page thread; not persisted
// across reloads yet. Both type and voice input land in the same input.

export default function ChatPage() {
  return (
    <div>
      <ScreenHeader
        eyebrow="Ask"
        title="Chat"
        meta="Read-only query over tasks, projects, notes, quotes, calendar"
      />
      <div className="hairline" />
      <ChatThread />
    </div>
  );
}
