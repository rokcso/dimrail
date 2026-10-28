import {
  RiFileListLine,
  RiMenuLine,
  RiMoonLine,
  RiServerLine,
  RiSettings3Line,
  RiStackLine,
  RiSunLine,
} from '@remixicon/react';
import { type ReactNode, useEffect, useState } from 'react';
import { cn } from '@/web/lib/utils';
import { applyTheme, getTheme, type Theme } from '@/web/theme';

const MAIN_TABS = [
  { to: '/admin/configs', label: '配置', icon: RiFileListLine },
  { to: '/admin/airports', label: '机场', icon: RiServerLine },
  { to: '/admin/pools', label: '节点池', icon: RiStackLine },
];

const SETTINGS_TAB = {
  to: '/admin/settings',
  label: '设置',
  icon: RiSettings3Line,
};

interface AppShellProps {
  path: string;
  onNavigate: (to: string) => void;
  /** 列表栏内容。三栏布局里它独占第二栏。 */
  sidebar?: ReactNode;
  children: ReactNode;
}

function isActive(path: string, to: string): boolean {
  return path === to || path.startsWith(`${to}/`);
}

/** 应用外壳：全局导航（栏 1）+ 列表（栏 2）+ 内容（栏 3）。 */
export function AppShell({ path, onNavigate, sidebar, children }: AppShellProps) {
  const [listOpen, setListOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => getTheme());

  // biome-ignore lint/correctness/useExhaustiveDependencies: 路径变化时关闭移动端抽屉
  useEffect(() => {
    setListOpen(false);
  }, [path]);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
  };

  return (
    <div className="flex h-full">
      <aside className="flex w-16 shrink-0 flex-col border-r-[0.5px] border-border bg-surface">
        <div className="flex h-12 shrink-0 items-center justify-center">
          <img src="/favicon.svg" alt="Dimrail" title="Dimrail" className="size-5" />
        </div>

        {sidebar && (
          <button
            type="button"
            title="打开列表"
            aria-label="打开列表"
            onClick={() => setListOpen((open) => !open)}
            className="mx-2 mb-1 flex h-9 items-center justify-center rounded-control text-muted-foreground outline-none hover:bg-muted hover:text-foreground md:hidden"
          >
            <RiMenuLine className="size-4" />
          </button>
        )}

        <nav className="flex flex-col gap-1 px-2" aria-label="主导航">
          {MAIN_TABS.map((tab) => (
            <NavItem
              key={tab.to}
              {...tab}
              active={isActive(path, tab.to)}
              onNavigate={onNavigate}
            />
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-1 px-2 pb-3">
          <button
            type="button"
            title={theme === 'dark' ? '切换到浅色' : '切换到深色'}
            aria-label={theme === 'dark' ? '切换到浅色' : '切换到深色'}
            onClick={toggleTheme}
            className="flex h-9 w-full items-center justify-center rounded-control text-muted-foreground outline-none hover:bg-muted hover:text-foreground"
          >
            {theme === 'dark' ? (
              <RiSunLine className="size-4" />
            ) : (
              <RiMoonLine className="size-4" />
            )}
          </button>
          <NavItem
            {...SETTINGS_TAB}
            active={isActive(path, SETTINGS_TAB.to)}
            onNavigate={onNavigate}
          />
        </div>
      </aside>

      {sidebar && (
        <>
          {listOpen && (
            <button
              type="button"
              aria-label="关闭列表"
              onClick={() => setListOpen(false)}
              className="fixed inset-0 z-20 bg-foreground/40 md:hidden"
            />
          )}
          <aside
            className={cn(
              'flex w-60 shrink-0 flex-col border-r-[0.5px] border-border bg-background max-lg:w-52',
              'max-md:fixed max-md:inset-y-0 max-md:left-16 max-md:z-30 max-md:w-64 max-md:border-r-[0.5px]',
              listOpen ? 'max-md:flex' : 'max-md:hidden',
            )}
          >
            {sidebar}
          </aside>
        </>
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
