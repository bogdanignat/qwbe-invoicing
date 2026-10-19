import { createFileRoute } from "@tanstack/react-router"

import { ProformaDetailView } from "../../views/ProformaDetailView.tsx"

export const Route = createFileRoute("/proformas/$id")({ component: ProformaDetailPage })

/** `key`: another id is another document, so the screen starts over instead of carrying the last one's state. */
function ProformaDetailPage() {
  const { id } = Route.useParams()
  return <ProformaDetailView key={id} id={id} />
}
