"use client"

import Link from "next/link"

import { Button } from "./Button.tsx"
import { Field } from "./ui/Field.tsx"
import { Select } from "./ui/Select.tsx"
import type { ProformaConversionModel } from "../hooks/use-proforma-conversion.ts"
import { CONVERSION_SERIES_MISSING } from "../lib/proforma-conversion.ts"

/**
 * The conversion, rendered from the model and nothing else: which of the two
 * buttons may be pressed, whether a series still has to be chosen and what a
 * proforma already converted links to are all decided in the hook, so this file
 * never asks a question of its own.
 */
const SERIES_NOTE = "proforma-conversion-series-note"
const DUE_DATE_NOTE = "proforma-conversion-due-date-note"

export const ProformaConversionSection = ({ conversion }: { readonly conversion: ProformaConversionModel }) => {
  const { outcome } = conversion
  if (outcome.kind === "unknown") return null
  // Why the buttons are inert, said where a screen reader reaches it: a disabled
  // button is not focusable, so the notes are attached to the control that is.
  const describedBy = [
    conversion.seriesMissing ? SERIES_NOTE : undefined,
    conversion.dueDateIssue === null ? undefined : DUE_DATE_NOTE,
  ].filter((id) => id !== undefined).join(" ")
  return <section className="card">
    <div className="section-heading">
      <div>
        <h2>Emitere factură</h2>
        <p>Factura preia exact datele și totalurile acestei proforme și primește propriul număr fiscal. O proformă se convertește o singură dată.</p>
      </div>
    </div>
    {conversion.unconfirmedMessage === undefined
      ? null
      : <p className="status-note warning">{conversion.unconfirmedMessage}</p>}
    {conversion.alreadyConverted === undefined
      ? null
      : <p className="status-note warning" role="alert">{conversion.alreadyConverted}</p>}
    {outcome.kind === "available"
      ? <>
        <Field label="Serie factură" required>
          <Select
            value={conversion.selectedSeries}
            disabled={conversion.pending || conversion.seriesOptions.length === 0}
            aria-describedby={describedBy === "" ? undefined : describedBy}
            onChange={(event) => { conversion.selectSeries(event.currentTarget.value) }}
          >
            <option value="" disabled>Alege seria facturii</option>
            {conversion.seriesOptions.map((series) => <option key={series} value={series}>{series}</option>)}
          </Select>
        </Field>
        {conversion.seriesMissing ? <p className="status-note warning" id={SERIES_NOTE}>{CONVERSION_SERIES_MISSING}</p> : null}
        {conversion.dueDateIssue === null ? null : <p className="status-note warning" id={DUE_DATE_NOTE}>{conversion.dueDateIssue}</p>}
        <div className="button-row">
          <Button
            disabled={!conversion.canIssueInvoice} onClick={conversion.issueInvoice}
            aria-describedby={conversion.dueDateIssue === null ? undefined : DUE_DATE_NOTE}
          >
            {conversion.pending ? "Operație în curs…" : "Emite factura"}
          </Button>
          <Button className="secondary" disabled={!conversion.canCreateDraft} onClick={conversion.createDraft}>
            Creează draft de factură
          </Button>
        </div>
      </>
      : <>
        <p className="conversion-state">
          <span className={`badge ${outcome.status.tone}`}>{outcome.status.label}</span>
        </p>
        <Link className="button secondary" href={outcome.href}>{outcome.label}</Link>
      </>}
  </section>
}
