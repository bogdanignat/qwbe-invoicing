import { Outlet, createRootRoute } from "@tanstack/react-router"

import { AppProviders } from "../components/AppProviders.tsx"
import { NotFoundView } from "../views/NotFoundView.tsx"

/**
 * The root stays mounted for the whole visit: the query client and the session
 * controller in `AppProviders` live here, so moving between screens never
 * recreates them. An address no route matches is rendered in this root's
 * outlet, so the not-found screen sits inside the same providers.
 */
export const Route = createRootRoute({ component: RootLayout, notFoundComponent: NotFoundView })

function RootLayout() {
  return <AppProviders><Outlet /></AppProviders>
}
