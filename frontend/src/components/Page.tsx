import type { ReactNode } from "react"

interface PageProps {
  readonly title: string
  readonly eyebrow: string
  readonly actions?: ReactNode
  readonly children: ReactNode
}

export const Page = ({ title, eyebrow, actions, children }: PageProps) => <>
  <header className="page-header">
    <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1></div>
    {actions === undefined ? null : <div className="page-actions">{actions}</div>}
  </header>
  {children}
</>
