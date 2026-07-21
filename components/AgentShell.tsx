import Link from 'next/link';
import { cn } from '@/lib/utils';

/** Slim navy shell matching marketing Header container + glass treatment. */
export function AgentHeader() {
  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 w-full"
      style={{
        background: 'rgba(6, 13, 26, 0.92)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(30, 111, 217, 0.2)',
        boxShadow: '0 4px 24px rgba(6, 13, 26, 0.5)',
      }}
    >
      <div className="w-full px-4 md:px-6 h-20 flex items-center justify-between gap-4">
        {/* Brand */}
        <Link
          href="/chat"
          className="group flex items-center gap-3 no-underline min-w-0"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/logo.png"
            alt="Paramount Intelligence"
            className="w-9 h-9 object-contain shrink-0 transition-transform duration-200 group-hover:scale-105"
          />
          <span className="flex items-center gap-2.5 min-w-0">
            <span
              className="text-white font-semibold tracking-tight text-base md:text-lg truncate"
              style={{ letterSpacing: '-0.02em' }}
            >
              Paramount Intelligence
            </span>
            <span
              className="hidden sm:inline-block text-[10px] md:text-xs font-medium uppercase tracking-widest px-2 py-0.5 rounded shrink-0"
              style={{
                color: 'var(--pi-blue-400)',
                background: 'rgba(59,136,245,0.12)',
                border: '1px solid rgba(59,136,245,0.25)',
              }}
            >
              Adviser
            </span>
          </span>
        </Link>

        {/* Right side: status + website link */}
        <div className="flex items-center gap-3 md:gap-5 shrink-0">
          <span
            className="hidden md:inline-flex items-center gap-2 text-xs"
            style={{ color: 'var(--pi-silver-400)' }}
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{
                background: '#3ddc84',
                boxShadow: '0 0 6px rgba(61,220,132,0.7)',
              }}
              aria-hidden="true"
            />
            Adviser online
          </span>
          <a
            href="https://www.paramountintelligence.co"
            target="_blank"
            rel="noopener noreferrer"
            className="nav-link text-xs md:text-sm font-medium no-underline px-3 py-1.5 rounded-lg"
            style={{
              color: 'var(--pi-silver-200)',
              border: '1px solid rgba(143,164,196,0.25)',
            }}
          >
            Visit website ↗
          </a>
        </div>
      </div>
    </header>
  );
}

export function AgentFooter() {
  return (
    <footer
      className={cn('relative')}
      style={{
        background: 'var(--pi-navy-900)',
        borderTop: '1px solid rgba(30,111,217,0.15)',
      }}
    >
      <div className="max-w-7xl mx-auto px-6 lg:px-12 xl:px-16 py-6 flex items-center justify-between">
        <p className="text-xs m-0" style={{ color: '#4a6080' }}>
          © {new Date().getFullYear()} Paramount Intelligence
        </p>
        <p className="text-xs m-0" style={{ color: 'var(--pi-silver-400)' }}>
          Commercial Agent
        </p>
      </div>
    </footer>
  );
}
