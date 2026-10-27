import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: ReactNode;
  /** 标题下面那行：状态、更新时间、行数之类。传空则不留白。 */
  meta?: ReactNode;
  actions?: ReactNode;
}

/** 页面唯一的标题区：左边标题与元信息，右边该页的主操作。 */
export function PageHeader({ title, meta, actions }: PageHeaderProps) {
  return (
    <header className="flex shrink-0 items-start gap-4 border-b-[0.5px] border-border px-6 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex h-6 items-center text-[15px] font-medium tracking-tight text-foreground">
          {title}
        </div>
        {meta && (
          <div className="mt-1 flex min-w-0 items-center gap-2 text-[12px] text-muted-foreground">
            {meta}
          </div>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5 -mt-0.5">{actions}</div>}
    </header>
  );
}
