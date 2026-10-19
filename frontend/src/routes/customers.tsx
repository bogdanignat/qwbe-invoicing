import { createFileRoute } from "@tanstack/react-router"

import { CustomersView } from "../views/CustomersView.tsx"

export const Route = createFileRoute("/customers")({ component: CustomersView })
