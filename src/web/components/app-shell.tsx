import { RiFileListLine, RiServerLine, RiSettings3Line } from '@remixicon/react';
import type { ReactNode } from 'react';
import { cn } from '@/web/lib/utils';

const TABS = [
  { to: '/admin', label: '配置', icon: RiFileListLine },
  { to: '/admin/airports', label: '机场', icon: RiServerLine },
  { to: '/admin/settings', label: '设置', icon: RiSettings3Line },
];

interface AppShellProps {
  path: string;
  onNavigate: (to: string) => void;
  /** 导航下面的侧栏内容（配置列表）。 */
  sidebar?: ReactNode;
  children: ReactNode;
}

/** 应用外壳：左侧固定导航栏，右侧单一内容区。页面只往右侧填内容。 */
export function AppShell({ path, onNavigate, sidebar, children }: AppShellProps) {
  return (
    <div className="flex h-full">
      <aside className="flex w-56 shrink-0 flex-col border-r-[0.5px] border-border bg-surface">
        <div className="flex h-14 shrink-0 items-center gap-2 px-4">
          <img src="/favicon.svg" alt="" className="size-4" />
          <span className="text-[13px] font-semibold tracking-tight">Dimrail</span>
        </div>

        <nav className="flex shrink-0 flex-col gap-px px-2">
          {TABS.map(({ to, label, icon: Icon }) => (
            <button
              key={to}
              type="button"
              onClick={() => onNavigate(to)}
              className={cn(
                'flex h-7 items-center gap-2 rounded-control px-2 text-[13px] outline-none transition-colors duration-150 ease-out',
                'focus-visible:ring-2 focus-visible:ring-ring/40',
                path === to
                  ? 'bg-muted font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className="size-3.5 shrink-0" />
              {label}
            </button>
          ))}
        </nav>

        {sidebar && <div className="mt-5 flex min-h-0 flex-1 flex-col">{sidebar}</div>}
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-background">{children}</main>
    </div>
  );
}
