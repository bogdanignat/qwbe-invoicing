import type { ComponentPropsWithRef } from "react"

export const Button = ({ className, type = "button", ...props }: ComponentPropsWithRef<"button">) =>
  <button {...props} className={["button", className].filter(Boolean).join(" ")} type={type} />
