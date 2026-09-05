export interface VatValues {
  readonly code: string
  readonly rate: string
}

export interface VatInference {
  readonly registered: boolean
  readonly values: VatValues
}

export interface EffectiveVat extends VatValues {
  readonly effectiveFrom: string
  readonly effectiveTo?: string
}

interface DraftTaxLine {
  readonly vatRateCode: string
  readonly vatRate: string
}

const STANDARD_VAT: VatValues = { code: "RO_STANDARD", rate: "21.00" }
const NON_VAT: VatValues = { code: "RO_NON_VAT", rate: "0.00" }

export const romanianCuiPattern = "(?:RO)?[1-9][0-9]{1,9}"
export const normalizeRomanianCui = (value: string): string => value.trim().toUpperCase()

export const inferRomanianVatDefaults = (
  countryCode: string,
  fiscalIdentifier: string,
): VatInference | undefined => {
  if (countryCode.trim().toUpperCase() !== "RO") return undefined
  const identifier = normalizeRomanianCui(fiscalIdentifier)
  if (/^RO\d+$/.test(identifier)) return { registered: true, values: STANDARD_VAT }
  if (/^\d+$/.test(identifier)) return { registered: false, values: NON_VAT }
  return undefined
}

export const vatRegistrationMismatch = (
  countryCode: string,
  fiscalIdentifier: string,
  registered: boolean,
): string | undefined => {
  const inferred = inferRomanianVatDefaults(countryCode, fiscalIdentifier)
  if (inferred === undefined || inferred.registered === registered) return undefined
  return inferred.registered
    ? "CUI-ul cu prefix RO nu poate fi salvat ca neplătitor de TVA. Elimină prefixul RO sau bifează opțiunea."
    : "CUI-ul fără prefix RO nu poate fi salvat ca plătitor de TVA. Adaugă prefixul RO sau debifează opțiunea."
}

export const resolveVatValues = (registered: boolean, entered: VatValues): VatValues => {
  if (!registered) return NON_VAT
  return isNonVat(entered) ? STANDARD_VAT : entered
}

const scaledRate = (rate: string): bigint | undefined => {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(rate.trim())
  if (match === null) return undefined
  return BigInt(match[1] as string) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"))
}

const sameRate = (left: string, right: string): boolean => {
  const scaledLeft = scaledRate(left)
  return scaledLeft !== undefined && scaledLeft === scaledRate(right)
}

export const isNonVat = (vat: VatValues): boolean => vat.code === NON_VAT.code && sameRate(vat.rate, NON_VAT.rate)

export const vatTimelineMismatch = (
  countryCode: string,
  fiscalIdentifier: string,
  configurations: ReadonlyArray<EffectiveVat>,
): string | undefined => {
  const latest = [...configurations].sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom))[0]
  return latest === undefined ? undefined : vatRegistrationMismatch(countryCode, fiscalIdentifier, !isNonVat(latest))
}

export const currentEffectiveVat = (
  configurations: ReadonlyArray<EffectiveVat>,
  date: string,
): EffectiveVat | undefined => configurations.find((configuration) =>
  configuration.effectiveFrom <= date
  && (configuration.effectiveTo === undefined || date <= configuration.effectiveTo))

export const nearestConfiguredVat = (
  configurations: ReadonlyArray<EffectiveVat>,
  date: string,
): EffectiveVat | undefined => {
  const current = currentEffectiveVat(configurations, date)
  if (current !== undefined) return current
  const ordered = [...configurations].sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom))
  return ordered.find((configuration) => configuration.effectiveFrom > date) ?? ordered.at(-1)
}

const previousDay = (date: string): string => {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() - 1)
  return value.toISOString().slice(0, 10)
}

export const updateVatTimeline = (
  configurations: ReadonlyArray<EffectiveVat>,
  selected: EffectiveVat | undefined,
  next: VatValues,
  effectiveFrom: string,
): ReadonlyArray<EffectiveVat> => {
  if (selected !== undefined
    && selected.effectiveFrom === effectiveFrom
    && selected.code === next.code
    && sameRate(selected.rate, next.rate)) return configurations
  const kept = [...configurations]
    .filter((configuration) => configuration.effectiveFrom < effectiveFrom)
    .sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom))
  const previous = kept.at(-1)
  const closed = previous === undefined ? kept : kept.map((configuration) => configuration === previous
    ? { ...configuration, effectiveTo: previousDay(effectiveFrom) }
    : configuration)
  return [...closed, { ...next, effectiveFrom }]
}

export const hasStaleDraftTax = (
  issueDate: string,
  lines: ReadonlyArray<DraftTaxLine>,
  configurations: ReadonlyArray<EffectiveVat>,
): boolean => lines.some((line) => !configurations.some((configuration) =>
  configuration.code === line.vatRateCode
  && sameRate(configuration.rate, line.vatRate)
  && configuration.effectiveFrom <= issueDate
  && (configuration.effectiveTo === undefined || issueDate <= configuration.effectiveTo)))
