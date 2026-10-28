import { Dialog } from '@base-ui/react/dialog';
import type { ComponentProps } from 'react';
import { cn } from '@/web/lib/utils';

export const DialogRoot = Dialog.Root;
export const DialogTrigger = Dialog.Trigger;
export const DialogClose = Dialog.Close;

export function DialogContent({
  className,
  children,
  ...props
}: ComponentProps<typeof Dialog.Popup>) {
  return (
    <Dialog.Portal>
      <Dialog.Backdrop className="fixed inset-0 z-50 bg-foreground/40" />
      <Dialog.Popup
        className={cn(
          'fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2',
          'rounded-card border-[0.5px] border-border bg-background p-5 outline-none',
          className,
        )}
        {...props}
      >
        {children}
      </Dialog.Popup>
    </Dialog.Portal>
  );
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof Dialog.Title>) {
  return (
    <Dialog.Title
      className={cn('text-[15px] font-medium tracking-tight text-foreground', className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof Dialog.Description>) {
  return (
    <Dialog.Description
      className={cn('mt-1 text-[12px] leading-relaxed text-muted-foreground', className)}
      {...props}
    />
  );
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex items-center justify-end gap-2', className)} {...props} />;
}
