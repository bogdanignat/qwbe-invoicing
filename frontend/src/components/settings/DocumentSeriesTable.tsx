import { Button } from "../Button.tsx"
import { EmptyState } from "../AsyncState.tsx"
import { DOCUMENT_TYPE_LABELS } from "../../lib/document-series-form.ts"
import {
  archiveActionLabel, archiveActionText, seriesKey, seriesStateLabel,
} from "../../lib/document-series-archive.ts"
import type { DocumentSeries } from "../../lib/draft-models.ts"

/**
 * The series already configured, each with its state and the one action it
 * allows: archive or reactivate. A series is never renamed or removed, since
 * that would break the numbering it guarantees. The button stays enabled while
 * a toggle is in flight (the hook ignores the click), so the focus is kept.
 */
export const DocumentSeriesTable = ({ series, archiving, onToggleArchived }: {
  readonly series: ReadonlyArray<DocumentSeries>
  readonly archiving: string | undefined
  readonly onToggleArchived: (series: DocumentSeries) => void
}) =>
  series.length === 0
    ? <EmptyState>Nu există încă serii configurate. Adaugă cel puțin o serie de factură pentru a putea crea drafturi.</EmptyState>
    : <div className="table-wrap">
      <table>
        <caption className="sr-only">Seriile de documente configurate</caption>
        <thead><tr>
          <th scope="col">Tip document</th><th scope="col">Serie</th><th scope="col">Stare</th><th scope="col">Acțiune</th>
        </tr></thead>
        <tbody>
          {series.map((item) => {
            const busy = archiving === seriesKey(item)
            return <tr key={seriesKey(item)}>
              <td data-label="Tip document">{DOCUMENT_TYPE_LABELS[item.documentType]}</td>
              <td data-label="Serie"><strong>{item.series}</strong></td>
              <td data-label="Stare">
                <span className={item.archived ? "badge muted" : "badge positive"}>{seriesStateLabel(item)}</span>
              </td>
              <td data-label="Acțiune">
                <Button className="secondary small" aria-label={archiveActionLabel(item, busy)} aria-busy={busy}
                  onClick={() => { onToggleArchived(item) }}>
                  {busy ? "Se salvează…" : archiveActionText(item)}
                </Button>
              </td>
            </tr>
          })}
        </tbody>
      </table>
    </div>
