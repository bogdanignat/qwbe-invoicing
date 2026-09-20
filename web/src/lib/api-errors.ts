import { Data } from "effect"

export class ApiFailure extends Data.TaggedError("ApiFailure")<{
  readonly message: string
  readonly status?: number
  readonly code?: string
  readonly issues: ReadonlyArray<string>
}> {}

const failureMessages: Readonly<Record<string, string>> = {
  AuthenticationRequired: "Sesiunea a expirat. Introdu din nou tokenul API.",
  csrf_validation_failed: "Sesiunea nu a putut valida cererea. Reîncarcă pagina și încearcă din nou.",
  invalid_credentials: "Tokenul API este incorect.",
  too_many_attempts: "Prea multe încercări. Așteaptă puțin și încearcă din nou.",
  origin_not_allowed: "Originea cererii de autentificare nu este permisă.",
  ResourceNotFound: "Resursa cerută nu mai există. Reîncarcă pagina și încearcă din nou.",
  customer_has_open_drafts: "Clientul are drafturi deschise.",
  document_series_exists: "Seria există deja pentru acest tip de document.",
  invoice_already_corrected: "Factura are deja un document storno integral.",
  draft_already_issued: "Draftul a fost deja emis și nu mai poate fi folosit pentru un alt document.",
  proforma_already_converted: "Proforma a fost deja transformată într-un draft de factură.",
  invoice_already_issued: "Draftul a fost deja emis ca factură și este blocat.",
  idempotency_key_reused: "Cheia de siguranță a fost folosită pentru altă cerere. Reîncarcă pagina înainte de a continua.",
  payment_already_reversed: "Plata a fost deja anulată.",
}

export const parseApiFailure = (input: unknown, status: number): ApiFailure => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return new ApiFailure({ message: `Cererea a eșuat (${String(status)}).`, status, issues: [] })
  }
  const value = input as Readonly<Record<string, unknown>>
  const code = typeof value.code === "string" ? value.code : undefined
  const issues = Array.isArray(value.issues)
    ? value.issues.filter((issue): issue is string => typeof issue === "string")
    : []
  const error = typeof value.error === "string" ? value.error : undefined
  const localizedCode = code === undefined ? undefined : failureMessages[code]
  const message = localizedCode ?? (typeof value.message === "string"
    ? value.message
    : issues[0] ?? (code === undefined
      ? (error === undefined ? `Cererea a eșuat (${String(status)}).` : failureMessages[error] ?? error)
      : error ?? code))
  return new ApiFailure({ message, status, issues, ...(code === undefined ? {} : { code }) })
}
