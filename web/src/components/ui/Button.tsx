import type { ComponentPropsWithRef } from "react"

import { cn } from "../../classnames.ts"
import { buttonVariants, type ButtonVariantProps } from "./button-variants.ts"

export type ButtonProps = ComponentPropsWithRef<"button"> & ButtonVariantProps

export const Button = ({ className, variant, size, fullWidth, type = "button", ...props }: ButtonProps) =>
  <button {...props} data-slot="button" className={cn(buttonVariants({ variant, size, fullWidth }), className)} type={type} />
