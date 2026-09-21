import type { ReactNode } from "react"

export const Page = ({ title, eyebrow, children }: { readonly title: string; readonly eyebrow: string; readonly children: ReactNode }) => <>
  <header className="page-header"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1></div></header>
  {children}
</>
