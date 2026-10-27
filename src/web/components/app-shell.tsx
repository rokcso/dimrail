import { RiFileListLine, RiServerLine, RiSettings3Line, RiStackLine } from '@remixicon/react';
import type { ReactNode } from 'react';
import { cn } from '@/web/lib/utils';

const MAIN_TABS = [
  { to: '/admin', label: '配置', icon: RiFileListLine, exact: true },
  { to: '/admin/airports', label: '机场', icon: RiServerLine, exact: false },
  { to: '/admin/groups', label: '节点组', icon: RiStackLine, exact: false },
];

const SETTINGS_TAB = {
  to: '/admin/settings',
  label: '设置',
  icon: RiSettings3Line,
  exact: false,
};

interface AppShellProps {
  path: string;
  onNavigate: (to: string) => void;
  /** 列表栏内容。三栏布局里它独占第二栏。 */
  sidebar?: ReactNode;
  children: ReactNode;
}

function isActive(path: string, to: string, exact: boolean): boolean {
  return path === to || (!exact && path.startsWith(`${to}/`));
}

/** 应用外壳：全局导航（栏 1）+ 列表（栏 2）+ 内容（栏 3）。 */
export function AppShell({ path, onNavigate, sidebar, children }: AppShellProps) {
  return (
    <div className="flex h-full">
      <aside className="flex w-16 shrink-0 flex-col border-r-[0.5px] border-border bg-surface">
        <div className="flex h-12 shrink-0 items-center justify-center">
          <img src="/favicon.svg" alt="Dimrail" title="Dimrail" className="size-5" />
        </div>

        <nav className="flex flex-col gap-1 px-2" aria-label="主导航">
          {MAIN_TABS.map((tab) => (
            <NavItem
              key={tab.to}
              {...tab}
              active={isActive(path, tab.to, tab.exact)}
              onNavigate={onNavigate}
            />
          ))}
        </nav>

        <div className="mt-auto px-2 pb-3">
          <NavItem
            {...SETTINGS_TAB}
            active={isActive(path, SETTINGS_TAB.to, SETTINGS_TAB.exact)}
            onNavigate={onNavigate}
          />
        </div>
      </aside>

      {sidebar && (
        <aside className="flex w-60 shrink-0 flex-col border-r-[0.5px] border-border bg-background max-lg:w-52">
          {sidebar}
        </aside>
      )}

      <main className="flex min-w-0 flex-1 flex-col bg-background">{children}</main>
    </div>
  );
}

interface NavItemProps {
  to: string;
  label: string;
  icon: typeof RiFileListLine;
  active: boolean;
  onNavigate: (to: string) => void;
}

function NavItem({ to, label, icon: Icon, active, onNavigate }: NavItemProps) {
  return (
    <button
      type="button"
      onClick={() => onNavigate(to)}
      aria-current={active ? 'page' : undefined}
      title={label}
      className={cn(
        'flex h-12 w-full flex-col items-center justify-center gap-1 rounded-control outline-none',
        'focus-visible:ring-2 focus-visible:ring-ring/40',
        active
          ? 'bg-muted text-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      <Icon className={cn('size-[18px] shrink-0', active && 'text-primary')} />
      <span className="text-[12px] leading-none">{label}</span>
    </button>
  );
}
