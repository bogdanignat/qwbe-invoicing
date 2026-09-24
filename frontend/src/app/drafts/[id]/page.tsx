import { DraftView } from "../../../views/DraftView.tsx"

/**
 * The segment is read on the server and handed down as a plain string, the
 * same pattern as the invoice detail route, so the client view receives an id
 * and nothing else.
 */
export default async function DraftPage({ params }: PageProps<"/drafts/[id]">) {
  const { id } = await params
  return <DraftView id={id} />
}
