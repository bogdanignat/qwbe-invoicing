import { useId, type ComponentPropsWithRef, type ReactNode } from "react"

type SwitchProps = Omit<ComponentPropsWithRef<"input">, "type" | "role" | "aria-describedby"> & {
  readonly label: ReactNode
  readonly description?: ReactNode
}

/**
 * An on/off control: a native checkbox announced as a switch, with its label
 * and an optional description it is described by.
 */
export const Switch = ({ label, description, ...props }: SwitchProps) => {
  const descriptionId = useId()
  return <div className="grid gap-1">
    <label className="checkbox-label">
      <input {...props} type="checkbox" role="switch" aria-describedby={description === undefined ? undefined : descriptionId} />
      {label}
    </label>
    {description === undefined ? null : <p className="hint" id={descriptionId}>{description}</p>}
  </div>
}
