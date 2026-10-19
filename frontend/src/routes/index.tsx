import { createFileRoute } from "@tanstack/react-router"

import { DashboardView } from "../views/DashboardView.tsx"

export const Route = createFileRoute("/")({ component: DashboardView })
