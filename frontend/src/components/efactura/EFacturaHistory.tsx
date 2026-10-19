import { EmptyState, ErrorAlert } from "../AsyncState.tsx"
import { EFacturaErrors } from "./EFacturaErrors.tsx"
import { EFacturaFiles } from "./EFacturaFiles.tsx"
import type { EFacturaFilesModel } from "../../hooks/use-efactura-files.ts"
import type { SubmissionRow } from "../../lib/efactura-history.ts"

/** Every submission of the document, newest first, each linked to the one that replaced it. */
export const EFacturaHistory = ({ rows, files }: {
  readonly rows: ReadonlyArray<SubmissionRow>
  readonly files: EFacturaFilesModel
}) => <div className="grid gap-2">
  <h3 className="m-0">Istoricul trimiterilor</h3>
  {rows.length === 0
    ? <EmptyState>Documentul nu a fost trimis încă în e-Factura.</EmptyState>
    : <ol className="m-0 list-none p-0">
      {rows.map((row) => <li key={row.id} id={row.anchorId} className="draft-item">
        <div className="draft-item-main">
          <strong>{row.title}</strong>
          <small>{row.stateLine}</small>
          {row.uploadIndex === undefined ? null : <small>Index de încărcare: {row.uploadIndex}</small>}
          {row.replaces === undefined ? null : <small><a href={row.replaces.href}>{row.replaces.label}</a></small>}
          {row.replacedBy === undefined ? null : <small><a href={row.replacedBy.href}>{row.replacedBy.label}</a></small>}
          <EFacturaErrors errors={row.errors} title="Mesaje" />
        </div>
        {row.files
          ? <div className="draft-item-actions">
            <EFacturaFiles submissionId={row.id} files={files} response={row.responseLabel !== undefined}
              xmlLabel={row.xmlLabel} responseLabel={row.responseLabel} />
          </div>
          : null}
      </li>)}
    </ol>}
  {files.failure === undefined ? null : <ErrorAlert error={files.failure} />}
</div>
