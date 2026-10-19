"use client"

import Link from "next/link"

import { ErrorAlert } from "../components/AsyncState.tsx"
import { PeriodSection } from "../components/dashboard/PeriodSection.tsx"
import { SituationSection } from "../components/dashboard/SituationSection.tsx"
import { Page } from "../components/Page.tsx"
import { PrivateScreen } from "../components/PrivateScreen.tsx"
import { useAuthenticatedShell } from "../hooks/use-authenticated-shell.ts"
import { useDashboard } from "../hooks/use-dashboard.ts"

export const DashboardView = () => {
  const shell = useAuthenticatedShell()
  const dashboard = useDashboard()
  return <PrivateScreen shell={shell}>
    <Page title="Acasă" eyebrow="Tablou de bord"
      actions={<Link className="button" href="/invoices/new">Factură nouă</Link>}>
      {shell.error === undefined ? null : <ErrorAlert error={shell.error} />}
      <div className="section-stack">
        <PeriodSection dashboard={dashboard} />
        <SituationSection dashboard={dashboard} />
      </div>
    </Page>
  </PrivateScreen>
}
