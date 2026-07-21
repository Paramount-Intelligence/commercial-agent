'use client';

import ReactMarkdown from 'react-markdown';

type CitedCase = { id: string; title: string; url?: string };

type Message = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  citedCases: CitedCase[];
  toolsUsed: string[];
  tokensIn: number;
  tokensOut: number;
  rating: number | null;
};

type Conversation = {
  id: string;
  createdAt: string;
  messageCount: number;
  totalTokens: number;
  user: { name: string | null; email: string; affiliation: string | null };
  organization: { id: string; name: string } | null;
  messages: Message[];
};

const CASE_TAG_RE = /\[\[case:[^\]]+\]\]/gi;

function stripCaseTags(text: string): string {
  return text.replace(CASE_TAG_RE, '').replace(/[ \t]+\n/g, '\n').trim();
}

function AdminAssistantMd({ text }: { text: string }) {
  const cleaned = stripCaseTags(text);
  return (
    <div className="text-sm leading-relaxed text-slate-800">
      <ReactMarkdown
        components={{
          p: ({ children }) => (
            <p className="m-0 mb-2 last:mb-0">{children}</p>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-slate-900">{children}</strong>
          ),
          ul: ({ children }) => (
            <ul className="m-0 mb-2 pl-5 list-disc space-y-1 last:mb-0">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="m-0 mb-2 pl-5 list-decimal space-y-1 last:mb-0">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="pl-0.5">{children}</li>,
          h1: ({ children }) => (
            <p className="m-0 mb-2 font-semibold text-base text-slate-900">
              {children}
            </p>
          ),
          h2: ({ children }) => (
            <p className="m-0 mb-2 font-semibold text-sm text-slate-900">
              {children}
            </p>
          ),
          h3: ({ children }) => (
            <p className="m-0 mb-2 font-semibold text-sm text-slate-900">
              {children}
            </p>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-700 underline"
            >
              {children}
            </a>
          ),
          code: ({ children }) => (
            <code className="px-1 py-0.5 rounded text-[12px] bg-slate-200 text-slate-800">
              {children}
            </code>
          ),
        }}
      >
        {cleaned}
      </ReactMarkdown>
    </div>
  );
}

export default function TranscriptDetail({
  conversation,
}: {
  conversation: Conversation;
}) {
  const { user, organization, messages } = conversation;

  return (
    <div className="flex flex-col gap-5">
      {/* Header meta */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-4">
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              User
            </div>
            <div className="font-medium text-slate-900">
              {user.name || '—'}
            </div>
            <div className="text-slate-600">{user.email}</div>
            {user.affiliation && (
              <div className="text-slate-500 text-xs mt-0.5">
                {user.affiliation}
              </div>
            )}
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Organization
            </div>
            <div className="font-medium text-slate-900">
              {organization?.name ?? '—'}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Started
            </div>
            <div className="text-slate-700">
              {new Date(conversation.createdAt).toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Messages
            </div>
            <div className="text-slate-700 tabular-nums">
              {conversation.messageCount}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Tokens
            </div>
            <div className="text-slate-700 tabular-nums">
              {conversation.totalTokens.toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {/* Thread */}
      <div className="flex flex-col gap-3">
        {messages.map((m) => {
          const isUser = m.role === 'user';
          return (
            <div
              key={m.id}
              className={`rounded-xl border px-4 py-3 ${
                isUser
                  ? 'bg-slate-800 border-slate-700 text-white ml-0 sm:ml-8'
                  : 'bg-white border-slate-200 text-slate-800 mr-0 sm:mr-8'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <span
                  className={`text-[10px] font-semibold uppercase tracking-wider ${
                    isUser ? 'text-slate-300' : 'text-slate-500'
                  }`}
                >
                  {isUser ? 'User' : 'Assistant'}
                </span>
                <span
                  className={`text-[11px] ${
                    isUser ? 'text-slate-400' : 'text-slate-400'
                  }`}
                >
                  {new Date(m.createdAt).toLocaleTimeString()}
                </span>
              </div>

              {isUser ? (
                <p className="m-0 text-sm leading-relaxed whitespace-pre-wrap">
                  {m.content}
                </p>
              ) : (
                <AdminAssistantMd text={m.content} />
              )}

              {!isUser &&
                (m.citedCases.length > 0 ||
                  m.toolsUsed.length > 0 ||
                  m.tokensIn + m.tokensOut > 0 ||
                  m.rating != null) && (
                  <div className="mt-3 pt-2.5 border-t border-slate-200 space-y-1.5 text-[11px] text-slate-500">
                    {m.citedCases.length > 0 && (
                      <div>
                        <span className="font-medium text-slate-600">Cited: </span>
                        {m.citedCases.map((c, i) => (
                          <span key={c.id}>
                            {i > 0 && ', '}
                            {c.url ? (
                              <a
                                href={c.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-700 hover:underline"
                              >
                                {c.title}
                              </a>
                            ) : (
                              c.title
                            )}
                          </span>
                        ))}
                      </div>
                    )}
                    {m.toolsUsed.length > 0 && (
                      <div>
                        <span className="font-medium text-slate-600">Tools: </span>
                        {m.toolsUsed.join(', ')}
                      </div>
                    )}
                    {(m.tokensIn > 0 || m.tokensOut > 0) && (
                      <div>
                        <span className="font-medium text-slate-600">Tokens: </span>
                        {m.tokensIn} in / {m.tokensOut} out
                      </div>
                    )}
                    {m.rating != null && (
                      <div>
                        <span className="font-medium text-slate-600">Rating: </span>
                        {m.rating}
                      </div>
                    )}
                  </div>
                )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
