import { createFileRoute } from "@tanstack/react-router"

import { InvoiceDetailView } from "../../views/InvoiceDetailView.tsx"

export const Route = createFileRoute("/invoices/$id")({ component: InvoiceDetailPage })

/** `key`: another id is another document, so the screen starts over instead of carrying the last one's state. */
function InvoiceDetailPage() {
  const { id } = Route.useParams()
  return <InvoiceDetailView key={id} id={id} />
}
