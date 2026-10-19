import { createFileRoute } from "@tanstack/react-router"

import { NewInvoiceView } from "../../views/NewInvoiceView.tsx"

export const Route = createFileRoute("/invoices/new")({ component: NewInvoiceView })
