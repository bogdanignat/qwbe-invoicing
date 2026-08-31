import type { ReactNode } from "react"

interface ShellProps {
  readonly unlocked: boolean
  readonly route: string
  readonly children: ReactNode
}

const links = [
  { href: "#/invoices", section: "invoices", label: "Facturi", icon: "▤" },
  { href: "#/customers", section: "customers", label: "Clienți", icon: "♙" },
  { href: "#/settings", section: "settings", label: "Firmă", icon: "⚙" },
] as const

export const Shell = ({ unlocked, route, children }: ShellProps) => {
  const section = route.split("/")[1] ?? ""
  return <div className={unlocked ? "shell antialiased" : "shell locked antialiased"}>
    <a className="skip-link" href="#main-content">Sari la conținut</a>
    <aside className="sidebar">
      <a className="brand" href={unlocked ? "#/invoices" : "#/unlock"}><span className="brand-mark">Q</span><span><strong>QWBE</strong><small>Invoicing</small></span></a>
      <nav aria-label="Navigare principală">{links.map((link) => <a key={link.section} href={link.href} aria-current={unlocked && section === link.section ? "page" : undefined}><span aria-hidden="true">{link.icon}</span>{link.label}</a>)}</nav>
      <div className="sidebar-foot"><span className="status-dot" aria-hidden="true" /> API conectat</div>
    </aside>
    <main id="main-content"><div id="app">{children}</div></main>
  </div>
}
