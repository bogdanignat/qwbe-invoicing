import { useId, type ReactNode } from "react"

import type { ReportRange } from "../lib/report-period.ts"

interface DateRangeFieldsProps {
  readonly range: ReportRange
  /** Why the interval is refused, announced and tied to both inputs; undefined when it is not. */
  readonly error: string | undefined
  readonly onEdit: (field: keyof ReportRange, value: string) => void
  readonly required?: boolean
  /** A standing note under the inputs (how the dates are applied), described by both inputs. */
  readonly hint?: string | undefined
  /** The earliest date the picker offers. */
  readonly min?: string | undefined
  /** Rendered after the inputs and before the error, e.g. an apply button. */
  readonly children?: ReactNode
}

/** The two dates of an interval, laid out by the caller's `.custom-range` container. */
export const DateRangeFields = ({ range, error, onEdit, required = false, hint, min, children }: DateRangeFieldsProps) => {
  const hintId = useId()
  const errorId = useId()
  const refused = error !== undefined
  const describedIds = [...(hint === undefined ? [] : [hintId]), ...(refused ? [errorId] : [])]
  const described = describedIds.length === 0 ? undefined : describedIds.join(" ")
  return <>
    <label>De la
      <input type="date" value={range.from} required={required} min={min} aria-invalid={refused} aria-describedby={described}
        onChange={(event) => { onEdit("from", event.target.value) }} />
    </label>
    <label>Până la
      <input type="date" value={range.to} required={required} min={min} aria-invalid={refused} aria-describedby={described}
        onChange={(event) => { onEdit("to", event.target.value) }} />
    </label>
    {children}
    {hint === undefined ? null : <p className="hint" id={hintId}>{hint}</p>}
    {refused ? <p className="hint warning" id={errorId} role="alert">{error}</p> : null}
  </>
}
