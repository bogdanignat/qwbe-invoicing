import type { SyntheticEvent } from "react"

export type FormSubmitEvent = SyntheticEvent<HTMLFormElement, SubmitEvent>

export const formField = (form: HTMLFormElement, name: string): string => {
  const value = new FormData(form).get(name)
  return typeof value === "string" ? value.trim() : ""
}
