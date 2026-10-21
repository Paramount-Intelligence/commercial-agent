'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BookCheck,
  Building2,
  FileStack,
  FileText,
  Library,
  LayoutDashboard,
  MessageSquareText,
  ScrollText,
  Shield,
  Users,
} from 'lucide-react';
import LogoutButton from './LogoutButton';
import { cn } from '@/lib/utils';

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Ops',
    items: [
      { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/admin/transcripts', label: 'Transcripts', icon: MessageSquareText },
      { href: '/admin/usage', label: 'Usage', icon: FileStack },
    ],
  },
  {
    label: 'Content',
    items: [
      { href: '/admin/cases', label: 'Cases', icon: Library },
      { href: '/admin/assets', label: 'Case assets', icon: FileText },
      { href: '/admin/knowledge', label: 'Knowledge', icon: ScrollText },
      { href: '/admin/approved-knowledge', label: 'Approved knowledge', icon: BookCheck },
      { href: '/admin/prompts', label: 'Prompts', icon: Shield },
    ],
  },
  {
    label: 'Access',
    items: [
      { href: '/admin/orgs', label: 'Organizations', icon: Building2 },
      { href: '/admin/admins', label: 'Admins', icon: Users },
    ],
  },
];

function navActive(pathname: string, href: string): boolean {
  if (href === '/admin') return pathname === '/admin';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AdminShell({
  title,
  adminName,
  adminRole,
  children,
  wide = false,
}: {
  title: string;
  adminName?: string;
  adminRole?: string;
  children: React.ReactNode;
  /** Wider main column (cases table). */
  wide?: boolean;
}) {
  const pathname = usePathname() || '/admin';

  return (
    <div className="min-h-screen bg-slate-100 flex">
      <aside className="hidden md:flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="px-4 py-4 border-b border-slate-200">
          <p className="m-0 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            Paramount · Backstage
          </p>
          <p className="m-0 mt-0.5 text-sm font-semibold text-slate-900">
            Adviser admin
          </p>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="m-0 px-2 mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                {group.label}
              </p>
              <ul className="m-0 p-0 list-none space-y-0.5">
                {group.items.map((item) => {
                  const active = navActive(pathname, item.href);
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={cn(
                          'flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm no-underline transition-colors',
                          active
                            ? 'bg-slate-900 text-white'
                            : 'text-slate-700 hover:bg-slate-100',
                        )}
                      >
                        <Icon className="w-4 h-4 shrink-0 opacity-80" />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="border-t border-slate-200 px-3 py-3 space-y-2">
          {adminName ? (
            <p className="m-0 text-xs text-slate-600 truncate" title={adminName}>
              {adminName}
              {adminRole ? (
                <span className="ml-1.5 text-[9px] font-medium uppercase tracking-wider px-1 py-0.5 rounded bg-slate-200 text-slate-600">
                  {adminRole}
                </span>
              ) : null}
            </p>
          ) : null}
          <LogoutButton />
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-slate-200 md:hidden">
          <div className="px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="m-0 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                Backstage
              </p>
              <h1 className="m-0 text-base font-semibold text-slate-900 truncate">
                {title}
              </h1>
            </div>
            <LogoutButton />
          </div>
          <div className="px-2 pb-2 flex gap-1 overflow-x-auto">
            {NAV_GROUPS.flatMap((g) => g.items).map((item) => {
              const active = navActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'shrink-0 rounded-full px-3 py-1 text-xs font-medium no-underline',
                    active
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-700',
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </header>

        <header className="hidden md:block bg-white border-b border-slate-200">
          <div
            className={cn(
              'mx-auto px-6 py-4',
              wide ? 'max-w-6xl' : 'max-w-5xl',
            )}
          >
            <h1 className="m-0 text-lg font-semibold text-slate-900">{title}</h1>
          </div>
        </header>

        <main
          className={cn(
            'mx-auto w-full px-4 sm:px-6 py-6 sm:py-8 flex-1',
            wide ? 'max-w-6xl' : 'max-w-5xl',
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
