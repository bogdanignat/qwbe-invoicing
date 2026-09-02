import { InvoiceAuthoringView } from "./InvoiceAuthoringView.tsx"

export const NewInvoiceView = ({ notify }: { readonly notify: (message: string) => void }) => <InvoiceAuthoringView notify={notify} />
