import type { ComponentProps } from 'react';
import { cn } from '@/web/lib/utils';

/**
 * 视觉与 base-nova 的 Input 一致，底层用原生 input。
 * Base UI 的 Input 是 Field.Control，会把 onChange 换成 onValueChange；
 * 单个口令输入框不必承担这层间接。
 */
export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      data-slot="input"
      className={cn(
        'h-7 w-full min-w-0 rounded-control border-[0.5px] border-input bg-background px-2 text-xs text-foreground',
        'outline-none placeholder:text-muted-foreground',
        'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
