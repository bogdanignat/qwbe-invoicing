import { createFileRoute } from "@tanstack/react-router"

import { IntegrationsView } from "../views/IntegrationsView.tsx"

export const Route = createFileRoute("/integrations")({ component: IntegrationsView })
