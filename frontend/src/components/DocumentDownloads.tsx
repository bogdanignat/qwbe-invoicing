import { Button } from "./Button.tsx"
import type { DocumentDownloadAction } from "../hooks/use-document-download.ts"

export const DocumentDownloads = ({ actions }: { readonly actions: ReadonlyArray<DocumentDownloadAction> }) => <>
  {actions.map((action) => <Button
    key={action.key}
    className="secondary"
    disabled={action.disabled}
    onClick={action.start}
  >{action.label}</Button>)}
</>
