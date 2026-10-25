import { ErrorAlert } from "../AsyncState.tsx"
import { Button } from "../Button.tsx"
import { StatusNote } from "../ui/StatusNote.tsx"
import type { ReceivedFetchModel } from "../../hooks/use-received-fetch.ts"

/**
 * „Preia din SPV” with what the page knows of it: the coverage and its
 * warning, the latest fetch while it runs and after, and why it was refused.
 * Everything here is a sentence the model already wrote.
 */
export const ReceivedFetchPanel = ({ model }: { readonly model: ReceivedFetchModel }) => {
  const { coverage, progress } = model
  return <section className="card grid gap-4" aria-labelledby="received-fetch-title">
    <div className="section-heading">
      <div>
        <p className="eyebrow">ANAF SPV</p>
        <h2 id="received-fetch-title">Preluare din SPV</h2>
        <p>Aplicația cere lista ANAF doar când apeși butonul; descărcarea continuă în fundal.</p>
      </div>
      <Button disabled={model.busy} onClick={model.request}>{model.busy ? "Preluare în curs…" : "Preia din SPV"}</Button>
    </div>
    {model.statusError === undefined ? null : <ErrorAlert error={model.statusError} onRetry={model.statusRetry} />}
    {coverage === undefined ? null : <p className="m-0">{coverage.text}</p>}
    {coverage?.warning === undefined ? null : <StatusNote warning>{coverage.warning}</StatusNote>}
    {progress === undefined
      ? null
      : <div className="grid gap-2">
        <StatusNote warning={progress.tone === "warning"}>{progress.text}</StatusNote>
        {progress.gap === undefined ? null : <p className="hint">{progress.gap}</p>}
        {progress.errors.length === 0 ? null : <ul className="m-0">{progress.errors.map((error, index) => <li key={`${String(index)}:${error}`}>{error}</li>)}</ul>}
      </div>}
    {model.failure === undefined ? null : <ErrorAlert error={model.failure} />}
  </section>
}
