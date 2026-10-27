import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/web/lib/utils';

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-control text-xs font-medium whitespace-nowrap outline-none select-none disabled:pointer-events-none disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-ring/40',
  {
    variants: {
      variant: {
        primary: 'bg-primary-solid text-primary-solid-foreground hover:bg-primary-solid-hover',
        outline: 'border-[0.5px] border-input bg-transparent text-foreground hover:bg-muted',
        ghost: 'bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
      },
      size: {
        default: 'h-7 px-2.5',
        sm: 'h-6 px-2',
      },
    },
    defaultVariants: { variant: 'outline', size: 'default' },
  },
);

export function Button({
  className,
  variant,
  size,
  ...props
}: ComponentProps<typeof ButtonPrimitive> & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
