import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

type Props = {
  loading: boolean;
  assistantName: string;
  children: ReactNode;
};

export default function ChatEmptyState({ loading, assistantName, children }: Props) {
  return (
    <div className="chat-empty-state relative z-10 flex flex-1 min-h-0 items-center justify-center overflow-hidden px-5 py-10 sm:px-8 sm:py-16">
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
            <h2>How can we help?</h2>
            <p className="chat-empty-subtext">Ask {assistantName} about our capabilities, delivery experience, commercial model, or the best next step for your team.</p>
          </div>
          <div className="chat-empty-composer w-full">{children}</div>
        </div>
      )}
    </div>
  );
}
