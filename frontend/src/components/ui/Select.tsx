import type { ComponentPropsWithRef } from "react"

export const Select = ({ className, ...props }: ComponentPropsWithRef<"select">) =>
  <select {...props} className={["control", className].filter(Boolean).join(" ")} />
