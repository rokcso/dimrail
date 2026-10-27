import type { ComponentProps } from 'react';
import { cn } from '@/web/lib/utils';

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: htmlFor 由调用方提供
    <label
      data-slot="label"
      className={cn('block text-xs font-medium text-muted-foreground select-none', className)}
      {...props}
    />
  );
}
