import type { ComponentPropsWithRef } from "react"

export const Input = ({ className, ...props }: ComponentPropsWithRef<"input">) =>
  <input {...props} className={["control", className].filter(Boolean).join(" ")} />
