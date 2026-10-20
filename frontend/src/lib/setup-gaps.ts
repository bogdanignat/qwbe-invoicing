import type { LookupProvider } from "./company-lookup-settings.ts"
import type { DocumentSeries } from "./draft-models.ts"
import type { EFacturaConnection } from "./efactura-connection.ts"

/**
 * What the installation still lacks, as the dashboard's „Configurare incompletă”
 * card lists it. Each check is a read the settings screens already make; a
 * plugin's check counts only while the plugin runs.
 *
 * Nothing is listed until every check that counts has answered, so the card
 * never grows row by row; a check that failed adds no row, since its own
 * screen already shows the error.
 */
export type SetupCheck<Value> =
  | { readonly kind: "pending" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly value: Value }

export interface SetupState {
  readonly plugins: { readonly companyLookup: boolean; readonly efactura: boolean }
  /** The issuer profile, `null` while it has never been saved. */
  readonly issuer: SetupCheck<object | null>
  readonly series: SetupCheck<ReadonlyArray<Pick<DocumentSeries, "documentType">>>
  readonly lookupProvider: SetupCheck<LookupProvider>
  readonly anaf: SetupCheck<Pick<EFacturaConnection, "status" | "refreshExpiryWarning">>
}

export type SetupGapCode =
  | "issuer" | "invoice_series" | "proforma_series" | "company_lookup"
  | "anaf_not_configured" | "anaf_disconnected" | "anaf_needs_reconnect" | "anaf_expiring"

export interface SetupGap {
  readonly code: SetupGapCode
  readonly message: string
  /** Where it is fixed; absent when the fix is on the server, not in the app. */
  readonly action: { readonly label: string; readonly href: string } | undefined
}

const SETTINGS = "/settings"
const INTEGRATIONS = "/integrations"

const gap = (code: SetupGapCode, message: string, action?: SetupGap["action"]): SetupGap => ({ code, message, action })
const fix = (label: string, href: string): SetupGap["action"] => ({ label, href })

const issuerGaps = (issuer: object | null): ReadonlyArray<SetupGap> => issuer === null
  ? [gap("issuer", "Datele firmei emitente nu sunt completate.", fix("Completează datele firmei", SETTINGS))]
  : []

const seriesGaps = (series: ReadonlyArray<Pick<DocumentSeries, "documentType">>): ReadonlyArray<SetupGap> => [
  ...series.some((item) => item.documentType === "invoice") ? []
    : [gap("invoice_series", "Nu există nicio serie pentru facturi.", fix("Adaugă o serie de facturi", SETTINGS))],
  ...series.some((item) => item.documentType === "proforma") ? []
    : [gap("proforma_series", "Nu există nicio serie pentru proforme.", fix("Adaugă o serie de proforme", SETTINGS))],
]

// The backend reads an openapi.ro key it cannot open as no provider, so `none` covers that case too.
const lookupGaps = (provider: LookupProvider): ReadonlyArray<SetupGap> => provider === "none"
  ? [gap("company_lookup", "Căutarea firmelor după CUI nu are niciun furnizor pornit.", fix("Alege un furnizor", INTEGRATIONS))]
  : []

const RECONNECT = "Reconectează-te la ANAF"

const anafGaps = (connection: Pick<EFacturaConnection, "status" | "refreshExpiryWarning">): ReadonlyArray<SetupGap> => {
  switch (connection.status) {
    case "not_configured":
      return [gap("anaf_not_configured", "ANAF e-Factura nu este configurată pe server: lipsesc variabilele ANAF_* (pașii sunt în ghidul de instalare).")]
    case "disconnected":
      return [gap("anaf_disconnected", "ANAF e-Factura: aplicația nu este conectată.", fix("Conectează-te la ANAF", INTEGRATIONS))]
    case "needs_reconnect":
      return [gap("anaf_needs_reconnect", "ANAF e-Factura: conexiunea necesită reconectare.", fix(RECONNECT, INTEGRATIONS))]
    case "connected":
      return connection.refreshExpiryWarning
        ? [gap("anaf_expiring", "ANAF e-Factura: conexiunea expiră curând.", fix(RECONNECT, INTEGRATIONS))]
        : []
  }
}

const answered = <Value>(check: SetupCheck<Value>, rows: (value: Value) => ReadonlyArray<SetupGap>): ReadonlyArray<SetupGap> =>
  check.kind === "ready" ? rows(check.value) : []

/** The rows to show, or `undefined` while a check that counts has not answered yet. */
export const setupGaps = (state: SetupState): ReadonlyArray<SetupGap> | undefined => {
  const counted = [
    state.issuer, state.series,
    ...state.plugins.companyLookup ? [state.lookupProvider] : [],
    ...state.plugins.efactura ? [state.anaf] : [],
  ]
  if (counted.some((check) => check.kind === "pending")) return undefined
  return [
    ...answered(state.issuer, issuerGaps),
    ...answered(state.series, seriesGaps),
    ...state.plugins.companyLookup ? answered(state.lookupProvider, lookupGaps) : [],
    ...state.plugins.efactura ? answered(state.anaf, anafGaps) : [],
  ]
}
