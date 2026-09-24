import { CorrectionDetailView } from "../../../views/CorrectionDetailView.tsx"

export default async function CorrectionDetailPage({ params }: PageProps<"/corrections/[id]">) {
  const { id } = await params
  return <CorrectionDetailView id={id} />
}
