import { ProformaDetailView } from "../../../views/ProformaDetailView.tsx"

/**
 * The segment is read on the server and handed down as a plain string, the same
 * pattern as the invoice detail route, so the client view receives an id and
 * nothing else.
 */
export default async function ProformaDetailPage({ params }: PageProps<"/proformas/[id]">) {
  const { id } = await params
  return <ProformaDetailView id={id} />
}
