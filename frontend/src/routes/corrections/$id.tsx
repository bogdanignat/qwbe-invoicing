import { createFileRoute } from "@tanstack/react-router"

import { CorrectionDetailView } from "../../views/CorrectionDetailView.tsx"

export const Route = createFileRoute("/corrections/$id")({ component: CorrectionDetailPage })

/** `key`: another id is another document, so the screen starts over instead of carrying the last one's state. */
function CorrectionDetailPage() {
  const { id } = Route.useParams()
  return <CorrectionDetailView key={id} id={id} />
}
