import { Button } from "../Button.tsx"
import type { EFacturaFilesModel } from "../../hooks/use-efactura-files.ts"

interface EFacturaFilesProps {
  readonly submissionId: string
  readonly files: EFacturaFilesModel
  readonly response: boolean
  /** Accessible names when the same buttons repeat on the page; the visible text stays in them. */
  readonly xmlLabel?: string | undefined
  readonly responseLabel?: string | undefined
}

/** The submitted XML of one submission and, once stored, ANAF's ZIP answer. */
export const EFacturaFiles = ({ submissionId, files, response, xmlLabel, responseLabel }: EFacturaFilesProps) => {
  const busy = files.pendingKey !== undefined
  return <div className="button-row">
    <Button className="secondary small" disabled={busy} aria-label={xmlLabel} onClick={() => { files.download(submissionId, "xml") }}>
      {files.pendingKey === `${submissionId}:xml` ? "Se descarcă…" : "Descarcă XML trimis"}
    </Button>
    {response
      ? <Button className="secondary small" disabled={busy} aria-label={responseLabel} onClick={() => { files.download(submissionId, "zip") }}>
        {files.pendingKey === `${submissionId}:zip` ? "Se descarcă…" : "Descarcă răspunsul ANAF"}
      </Button>
      : null}
  </div>
}
