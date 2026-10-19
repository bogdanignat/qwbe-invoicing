import { Suspense } from "react"

import { Loading } from "../components/AsyncState.tsx"
import { Shell } from "../components/Shell.tsx"
import { DashboardView } from "../views/DashboardView.tsx"

/**
 * The dashboard reads its filters from the address (`useSearchParams`), which
 * a prerendered page can only do under a Suspense boundary. The fallback is the
 * same frame a private screen shows while the session is checked.
 */
export default function HomePage() {
  return <Suspense fallback={<Shell unlocked={false}><Loading label="Verific sesiunea…" /></Shell>}>
    <DashboardView />
  </Suspense>
}
