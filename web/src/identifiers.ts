// Input shaping only: the fiscal meaning of an identifier (VAT regime, validity) is the server's.
export const romanianCuiPattern = "(?:RO)?[1-9][0-9]{1,9}"
export const normalizeRomanianCui = (value: string): string => value.trim().toUpperCase()
