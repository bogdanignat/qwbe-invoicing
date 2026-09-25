import { EmptyState } from "../AsyncState.tsx"
import { DOCUMENT_TYPE_LABELS } from "../../lib/document-series-form.ts"
import type { DocumentSeries } from "../../lib/draft-models.ts"

/**
 * The series already configured. There is no action on a row: a series that has
 * numbered a document cannot be renamed or removed without breaking the
 * numbering it guarantees.
 */
export const DocumentSeriesTable = ({ series }: { readonly series: ReadonlyArray<DocumentSeries> }) =>
  series.length === 0
    ? <EmptyState>Nu există încă serii configurate. Adaugă cel puțin o serie de factură pentru a putea crea drafturi.</EmptyState>
    : <div className="table-wrap">
      <table>
        <caption className="sr-only">Seriile de documente configurate</caption>
        <thead><tr><th scope="col">Tip document</th><th scope="col">Serie</th></tr></thead>
        <tbody>
          {series.map((item) => <tr key={`${item.documentType}:${item.series}`}>
            <td data-label="Tip document">{DOCUMENT_TYPE_LABELS[item.documentType]}</td>
            <td data-label="Serie"><strong>{item.series}</strong></td>
          </tr>)}
        </tbody>
      </table>
    </div>
