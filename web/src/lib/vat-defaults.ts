export type { FallbackVatRegistration, VatHistoryItem } from "./vat-selection.ts"
export {
  activeOn, defaultVatCode, fallbackVatRegistration, issuerVatRegistrationOn,
  normalizeRomanianCui, presetVatCode, romanianCuiPattern, vatRatesForIssuer,
  vatRegistrationHistory,
} from "./vat-selection.ts"
export {
  hasStaleDraftTax, issuerForIssueDate, staleDraftLineIds, vatTreatmentLabel,
} from "./vat-snapshots.ts"
