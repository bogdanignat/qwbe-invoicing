import type { ReactNode } from "react"

/** A sentence about the screen's state: a warning is announced at once, anything else politely. */
export const StatusNote = ({ warning = false, id, children }: {
  readonly warning?: boolean
  readonly id?: string
  readonly children: ReactNode
}) => <p id={id} className={warning ? "status-note warning" : "status-note"} role={warning ? "alert" : "status"}>{children}</p>
