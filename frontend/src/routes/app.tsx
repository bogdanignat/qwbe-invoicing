import { createFileRoute, redirect } from "@tanstack/react-router"

/** `/app` is an old alias of the dashboard. */
export const Route = createFileRoute("/app")({
  beforeLoad: () => { redirect({ to: "/", replace: true, throw: true }) },
})
