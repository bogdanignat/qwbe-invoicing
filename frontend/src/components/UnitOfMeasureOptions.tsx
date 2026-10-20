import type { UnitOfMeasure } from "../lib/draft-models.ts"

interface UnitOfMeasureOptionsProps {
  readonly units: ReadonlyArray<UnitOfMeasure>
}

/** The unit choices of a select: the name is shown, the code is the value that gets saved. */
export const UnitOfMeasureOptions = ({ units }: UnitOfMeasureOptionsProps) =>
  units.map((unit) => <option key={unit.code} value={unit.code}>{unit.name}</option>)
