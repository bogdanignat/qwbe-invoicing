import { InvoiceAuthoringView } from "./InvoiceAuthoringView.tsx"

export const DraftView = ({ id, notify }: { readonly id: string; readonly notify: (message: string) => void }) => <InvoiceAuthoringView id={id} notify={notify} />
