"use client"

import { usePathname } from "next/navigation"
import type { ReactNode } from "react"

import { shellNavigation } from "../lib/shell-navigation.ts"

interface ShellProps {
  readonly unlocked: boolean
  readonly logoutPending?: boolean
  readonly onLogout?: () => void
  readonly children: ReactNode
}

/**
 * The frame every screen is rendered in. The navigation model is computed in
 * `lib/shell-navigation.ts`: this component only renders it, and the current
 * section comes from the router's own path rather than from a prop each view
 * would have to remember to pass.
 */
export const Shell = ({ unlocked, logoutPending = false, onLogout, children }: ShellProps) => {
  const pathname = usePathname()
  const links = shellNavigation(pathname, unlocked)
  return <div className={unlocked ? "shell" : "shell locked"}>
    <a className="skip-link" href="#main-content">Sari la conținut</a>
    <aside className="sidebar">
      <a className="brand" aria-label="QWBE Invoicing" href={unlocked ? "/invoices" : "/unlock"}><span className="brand-mark">Q</span><span><strong>QWBE</strong><small>Invoicing</small></span></a>
      <nav aria-label="Navigare principală">
        {links.map((link) => <a key={link.section} href={link.href} aria-current={link.current ? "page" : undefined}>
          <span aria-hidden="true">{link.icon}</span>{link.label}
        </a>)}
      </nav>
      {unlocked ? <div className="sidebar-foot"><span className="status-dot" aria-hidden="true" /><span>Sesiune activă</span><button type="button" disabled={logoutPending} onClick={onLogout}>{logoutPending ? "Se închide…" : "Ieșire"}</button></div> : null}
    </aside>
    <main id="main-content"><div id="app">{children}</div></main>
  </div>
}
