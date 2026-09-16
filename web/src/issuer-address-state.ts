import type { Address } from "./models.ts"

export const issuerAddressSelection = (
  saved: Address | undefined, countyOverride: string | undefined, sectorOverride: number | undefined,
) => ({
  county: countyOverride ?? saved?.county ?? "",
  sector: sectorOverride ?? (countyOverride === undefined ? saved?.sector : undefined),
})
