"use client"

import { Button } from "../Button.tsx"
import { DocumentSeriesTable } from "./DocumentSeriesTable.tsx"
import { ErrorAlert, Loading } from "../AsyncState.tsx"
import { Field } from "../ui/Field.tsx"
import { FieldIssue } from "../registry/FieldIssue.tsx"
import { Input } from "../ui/Input.tsx"
import { Select } from "../ui/Select.tsx"
import { useRefusedFieldFocus } from "../../hooks/use-refused-field-focus.ts"
import { SERIES_FORM, registryFieldAria } from "../../lib/registry-fields.ts"
import {
  SERIES_MAX_LENGTH, SERIES_PATTERN, documentTypeValue, seriesInputValue,
} from "../../lib/document-series-form.ts"
import type { DocumentSeriesModel } from "../../hooks/use-document-series.ts"

/** The series configured for invoices and proformas, and the add-only form under them. */
export const DocumentSeriesCard = ({ model }: { readonly model: DocumentSeriesModel }) => {
  const { load, form, issue } = model
  useRefusedFieldFocus(SERIES_FORM, issue?.field)
  const aria = registryFieldAria(SERIES_FORM, issue?.field)
  return <section className="card form-card" aria-labelledby="document-series-title">
    <div className="section-heading"><div>
      <h2 id="document-series-title">Serii de documente</h2>
      <p>Adaugă separat seriile permise pentru facturi și proforme. Seriile adăugate rămân disponibile și nu pot fi editate aici.</p>
    </div></div>
    {load.kind === "loading" ? <Loading label="Se încarcă seriile…" /> : null}
    {load.kind === "error" ? <ErrorAlert error={load.error} onRetry={model.retry} /> : null}
    {load.kind === "ready" ? <DocumentSeriesTable series={model.series} /> : null}
    {model.notice === undefined ? null : <p className="status-note" role="status">{model.notice}</p>}
    {model.error === null || model.error === undefined ? null : <ErrorAlert error={model.error} />}
    <form className="document-series-form"
      onSubmit={(event) => { event.preventDefault(); model.submit() }}>
      <div className="form-grid">
        <Field label="Tip document" required>
          <Select required disabled={model.pending} value={form.documentType} {...aria("documentType")}
            onChange={(event) => { model.change({ documentType: documentTypeValue(event.currentTarget.value) }) }}>
            <option value="invoice">Factură</option>
            <option value="proforma">Proformă</option>
          </Select>
        </Field>
        <Field label="Serie" required>
          <Input required disabled={model.pending} value={form.series} {...aria("series")}
            maxLength={SERIES_MAX_LENGTH} pattern={SERIES_PATTERN} autoCapitalize="characters" spellCheck={false}
            title="1–20 caractere: litere mari, cifre, underscore sau cratimă"
            onChange={(event) => { model.change({ series: seriesInputValue(event.currentTarget.value) }) }} />
          <FieldIssue issue={issue} field="series" form={SERIES_FORM} />
        </Field>
      </div>
      <p className="hint">Folosește 1–20 de caractere: litere mari, cifre, „_” sau „-”. Operația este doar de adăugare.</p>
      <div className="button-row">
        <Button className="secondary" type="submit" disabled={model.pending || load.kind !== "ready"}>
          {model.pending ? "Se adaugă…" : "Adaugă seria"}
        </Button>
      </div>
    </form>
  </section>
}
