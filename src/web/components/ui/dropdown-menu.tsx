import { Menu } from '@base-ui/react/menu';
import type { ComponentProps } from 'react';
import { cn } from '@/web/lib/utils';

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuSeparator = Menu.Separator;

interface DropdownMenuContentProps extends ComponentProps<typeof Menu.Popup> {
  align?: ComponentProps<typeof Menu.Positioner>['align'];
  sideOffset?: number;
}

export function DropdownMenuContent({
  className,
  align = 'end',
  sideOffset = 4,
  children,
  ...props
}: DropdownMenuContentProps) {
  return (
    <Menu.Portal>
      <Menu.Positioner align={align} sideOffset={sideOffset} className="z-50">
        <Menu.Popup
          className={cn(
            'min-w-40 rounded-control border-[0.5px] border-border bg-background p-1 outline-none',
            className,
          )}
          {...props}
        >
          {children}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  );
}

interface DropdownMenuItemProps extends ComponentProps<typeof Menu.Item> {
  danger?: boolean;
}

export function DropdownMenuItem({ className, danger, ...props }: DropdownMenuItemProps) {
  return (
    <Menu.Item
      className={cn(
        'flex h-7 cursor-default items-center gap-2 rounded-control px-2 text-[12px] text-foreground outline-none select-none',
        'data-highlighted:bg-muted data-disabled:pointer-events-none data-disabled:opacity-50',
        danger && 'text-danger data-highlighted:bg-danger/10',
        className,
      )}
      {...props}
    />
  );
}
