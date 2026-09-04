import { tv, type VariantProps } from "../../classnames.ts"

export const buttonVariants = tv({
  base: [
    "inline-flex cursor-pointer items-center justify-center rounded-invoice-control border border-transparent no-underline font-[750]",
    "transition-[transform,background-color,border-color,color] duration-[120ms]",
    "focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-invoice-focus focus-visible:shadow-[0_0_0_2px_var(--color-invoice-primary)]",
    "disabled:cursor-not-allowed disabled:opacity-[.45] [&:not(:disabled):hover]:-translate-y-px",
  ],
  variants: {
    variant: {
      primary: "bg-invoice-primary text-invoice-on-primary [&:not(:disabled):hover]:bg-invoice-primary-hover",
      secondary: "border-invoice-secondary-border bg-invoice-secondary-surface text-invoice-primary",
      ghost: "bg-transparent text-invoice-muted",
      danger: "bg-transparent text-invoice-danger [&:not(:disabled):hover]:bg-invoice-danger-soft",
    },
    size: {
      default: "min-h-[2.55rem] px-4 py-[.65rem] text-[.83rem]",
      small: "min-h-8 px-[.55rem] py-[.4rem] text-xs",
    },
    fullWidth: {
      true: "w-full",
    },
  },
  defaultVariants: {
    variant: "primary",
    size: "default",
  },
})

export type ButtonVariantProps = VariantProps<typeof buttonVariants>
