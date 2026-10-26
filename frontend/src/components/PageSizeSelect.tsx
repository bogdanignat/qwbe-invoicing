import { useId } from "react"

import { Field } from "./ui/Field.tsx"
import { Select } from "./ui/Select.tsx"
import { PAGE_SIZES, pageSizeFrom, type PageSize } from "../lib/register-page-size.ts"

interface PageSizeSelectProps {
  readonly value: PageSize
  readonly onChange: (size: PageSize) => void
}

/** How many rows a page asks the server for. */
export const PageSizeSelect = ({ value, onChange }: PageSizeSelectProps) => {
  const id = useId()
  return <Field label="Rânduri pe pagină" htmlFor={id}>
    <Select id={id} value={String(value)} onChange={(event) => {
      const size = pageSizeFrom(event.target.value)
      if (size !== undefined) onChange(size)
    }}>
      {PAGE_SIZES.map((size) => <option key={size} value={String(size)}>{size}</option>)}
    </Select>
  </Field>
}
