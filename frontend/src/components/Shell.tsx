import type { ReactNode } from "react"

interface ShellProps {
  readonly unlocked: boolean
  readonly logoutPending?: boolean
  readonly onLogout?: () => void
  readonly children: ReactNode
}

export const Shell = ({ unlocked, logoutPending = false, onLogout, children }: ShellProps) => <div className={unlocked ? "shell" : "shell locked"}>
  <a className="skip-link" href="#main-content">Sari la conținut</a>
  <aside className="sidebar">
    <a className="brand" aria-label="QWBE Invoicing" href={unlocked ? "/invoices" : "/unlock"}><span className="brand-mark">Q</span><span><strong>QWBE</strong><small>Invoicing</small></span></a>
    <nav aria-label="Navigare principală"><a href="/invoices" aria-current={unlocked ? "page" : undefined}><span aria-hidden="true">▤</span>Facturi</a></nav>
    {unlocked ? <div className="sidebar-foot"><span className="status-dot" aria-hidden="true" /><span>Sesiune activă</span><button type="button" disabled={logoutPending} onClick={onLogout}>{logoutPending ? "Se închide…" : "Ieșire"}</button></div> : null}
  </aside>
  <main id="main-content"><div id="app">{children}</div></main>
</div>
