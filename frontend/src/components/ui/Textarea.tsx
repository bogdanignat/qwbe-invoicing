import type { ComponentPropsWithRef } from "react"

export const Textarea = ({ className, ...props }: ComponentPropsWithRef<"textarea">) =>
  <textarea {...props} className={["control", className].filter(Boolean).join(" ")} />
