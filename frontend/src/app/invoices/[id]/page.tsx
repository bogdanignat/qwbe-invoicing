import { InvoiceDetailView } from "../../../views/InvoiceDetailView.tsx"

/**
 * The segment is read on the server and handed down as a plain string.
 *
 * `params` is a promise in this App Router version, and awaiting it here keeps
 * the client view free of route plumbing: it receives an id and nothing else,
 * so it can be reasoned about without a router in the picture.
 */
export default async function InvoiceDetailPage({ params }: PageProps<"/invoices/[id]">) {
  const { id } = await params
  return <InvoiceDetailView id={id} />
}
