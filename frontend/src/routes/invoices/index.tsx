import { createFileRoute } from "@tanstack/react-router"

import { InvoicesView } from "../../views/InvoicesView.tsx"

export const Route = createFileRoute("/invoices/")({ component: InvoicesView })
