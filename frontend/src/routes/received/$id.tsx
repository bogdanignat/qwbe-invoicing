import { createFileRoute } from "@tanstack/react-router"

import { ReceivedDetailView } from "../../views/ReceivedDetailView.tsx"

export const Route = createFileRoute("/received/$id")({ component: ReceivedDetailPage })

/** `key`: another id is another invoice, so the screen starts over instead of carrying the last one's state. */
function ReceivedDetailPage() {
  const { id } = Route.useParams()
  return <ReceivedDetailView key={id} id={id} />
}
