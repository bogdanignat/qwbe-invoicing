import type { ComponentPropsWithRef } from "react"

import { cn } from "../../classnames.ts"
import { buttonVariants, type ButtonVariantProps } from "./button-variants.ts"

export type ButtonLinkProps = Omit<ComponentPropsWithRef<"a">, "href"> & ButtonVariantProps & {
  readonly href: string
}

export const ButtonLink = ({ className, variant, size, fullWidth, ...props }: ButtonLinkProps) =>
  <a {...props} data-slot="button" className={cn(buttonVariants({ variant, size, fullWidth }), className)} />
