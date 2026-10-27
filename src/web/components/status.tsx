import { cn } from '@/web/lib/utils';

export type Tone = 'saved' | 'dirty' | 'saving' | 'error';

const DOT: Record<Tone, string> = {
  saved: 'bg-primary',
  dirty: 'bg-warning',
  saving: 'bg-muted-foreground',
  error: 'bg-danger',
};

interface StatusProps {
  tone: Tone;
  label: string;
  /** 已保存时才给的时间，拼在文案后面。 */
  time?: string;
}

/** 保存状态：一个点 + 一句短文案，放在标题的元信息行里。 */
export function Status({ tone, label, time }: StatusProps) {
  return (
    <>
      <span className="flex shrink-0 items-center gap-1.5">
        <span className={cn('size-1.5 rounded-full', DOT[tone])} aria-hidden />
        <span className={tone === 'error' ? 'text-danger' : undefined}>{label}</span>
      </span>
      {time && <span className="shrink-0 tabular-nums">{time}</span>}
    </>
  );
}

/** 元信息行里的分隔点。 */
export function Dot() {
  return (
    <span className="text-border" aria-hidden>
      ·
    </span>
  );
}
