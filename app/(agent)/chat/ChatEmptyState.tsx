import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

export const CHAT_EMPTY_COPY = {
  headline: 'Ask Jackie anything about Paramount',
  subtext:
    'Explore our work, case studies, and how we can help. Start with a question.',
} as const;

type Props = {
  loading: boolean;
  children: ReactNode;
};

export default function ChatEmptyState({ loading, children }: Props) {
  return (
    <div className="chat-empty-state relative z-10 flex flex-1 min-h-0 items-center justify-center overflow-hidden px-5 py-12 sm:px-8 sm:py-16">
      {loading ? (
        <div
          className="flex items-center justify-center gap-2.5 text-sm"
          style={{ color: 'var(--pi-silver-400)' }}
          role="status"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : (
        <div className="chat-empty-composition flex w-full max-w-[680px] flex-col items-center text-center">
          <div className="chat-empty-copy">
            <p className="chat-empty-eyebrow">Paramount Intelligence</p>
            <h2>{CHAT_EMPTY_COPY.headline}</h2>
            <p className="chat-empty-subtext">{CHAT_EMPTY_COPY.subtext}</p>
          </div>
          <div className="chat-empty-composer w-full">{children}</div>
        </div>
      )}
    </div>
  );
}
