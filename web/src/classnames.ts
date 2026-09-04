import { cnMerge, createTV, type ClassValue, type TWMergeConfig } from "tailwind-variants"

const twMergeConfig = {
  extend: {
    classGroups: {
      rounded: [{ rounded: ["invoice-control", "invoice-container", "invoice-panel", "invoice-pill"] }],
    },
  },
} satisfies TWMergeConfig

export const cn = (...classNames: ClassValue[]): string => cnMerge(...classNames)({ twMergeConfig }) ?? ""

export const tv = createTV({ twMergeConfig })

export type { VariantProps } from "tailwind-variants"
