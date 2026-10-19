import { createFileRoute } from "@tanstack/react-router"

import { DraftView } from "../../views/DraftView.tsx"

export const Route = createFileRoute("/drafts/$id")({ component: DraftPage })

/** `key`: another id is another document, so the screen starts over instead of carrying the last one's state. */
function DraftPage() {
  const { id } = Route.useParams()
  return <DraftView key={id} id={id} />
}
