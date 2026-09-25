export class ApiFailure extends Error {
  readonly status: number | undefined
  readonly code: string | undefined
  readonly issues: ReadonlyArray<string>

  constructor(input: { readonly message: string; readonly status?: number; readonly code?: string; readonly issues?: ReadonlyArray<string> }) {
    super(input.message)
    this.name = "ApiFailure"
    this.status = input.status
    this.code = input.code
    this.issues = input.issues ?? []
  }
}

/**
 * A logout the server never confirmed, which is not the same as a session ended.
 */
export class LogoutUnconfirmedError extends Error {
  constructor(cause: unknown) {
    const detail = cause instanceof Error ? ` ${cause.message}` : ""
    super(`Serverul nu a confirmat ieșirea; sesiunea poate rămâne activă.${detail}`)
    this.name = "LogoutUnconfirmedError"
  }
}

const failureMessages: Readonly<Record<string, string>> = {
  AuthenticationRequired: "Sesiunea a expirat. Introdu din nou tokenul API.",
  csrf_validation_failed: "Sesiunea nu a putut valida cererea. Reîncarcă pagina și încearcă din nou.",
  invalid_credentials: "Tokenul API este incorect.",
  too_many_attempts: "Prea multe încercări. Așteaptă puțin și încearcă din nou.",
  origin_not_allowed: "Originea cererii de autentificare nu este permisă.",
  upstream_unavailable: "Serviciul API nu este disponibil momentan.",
  upstream_timeout: "Serviciul API nu a răspuns la timp.",
  not_ready: "Serviciul API nu este pregătit momentan.",
  invalid_session_cookie: "Cookie-ul sesiunii este invalid. Șterge cookie-ul de sesiune al acestui site și încearcă din nou.",
  invalid_host: "Adresa publică a aplicației nu este configurată corect.",
  invalid_forwarded_headers: "Proxy-ul public nu este configurat corect.",
  authorization_not_allowed: "Browserul nu poate trimite autentificare Bearer către această rută.",
  request_body_too_large: "Cererea este prea mare.",
  not_found: "Ruta API cerută nu există.",
  // The fiscal API answers a missing document with the bare tag `ResourceNotFound`
  // (standalone/api/schema-errors-session.ts:23) and a missing renderable document
  // with `DocumentNotFound`. Without an entry here `parseApiFailure` falls through
  // to `error` itself and the screen prints the tag.
  ResourceNotFound: "Documentul cerut nu există sau nu mai este disponibil.",
  DocumentNotFound: "Documentul cerut nu există sau nu mai este disponibil.",
  PermissionDenied: "Nu ai acces la acest document.",
  DocumentsPermissionDenied: "Nu ai acces la acest document.",
  ArtifactConflict: "Documentul este generat chiar acum. Încearcă din nou în câteva momente.",
  DocumentRenderingFailure: "Documentul nu a putut fi generat. Încearcă din nou.",
  DocumentPersistenceFailure: "Documentul nu a putut fi salvat. Încearcă din nou.",
  PersistenceFailure: "Datele nu au putut fi citite. Încearcă din nou.",
  internal_failure: "Serviciul API a întâmpinat o eroare. Încearcă din nou.",
  // `DomainConflict` answers carry a programmatic `code` and no `message`
  // (standalone/api/schema-errors-session.ts:25). Without an entry here
  // `parseApiFailure` falls back to the bare `error` tag and the screen shows
  // `DomainConflict` instead of what actually happened.
  idempotency_key_reused: "Cheia de idempotență a fost deja folosită pentru un alt document. Verifică registrul de facturi înainte de a încerca din nou.",
  draft_creation_result_deleted: "Draftul creat sub această cheie a fost între timp șters. Începe un document nou.",
  invoice_already_issued: "Factura a fost deja emisă. Deschide-o din registrul de facturi.",
  derived_draft_cannot_be_deleted: "Draftul provine dintr-o proformă și nu poate fi șters.",
}

/**
 * Whether the failure is one a second identical request could survive.
 *
 * The answer is read from the HTTP status rather than from the message: a
 * network failure carries no status at all, a `429` and any `5xx` are the
 * server saying *not now*, and everything else — `400`, `403`, `404`, `409` —
 * is a settled answer that retrying only repeats. A `401` is not offered a
 * retry either: the session controller already turns it into a re-unlock.
 */
export const isTransientFailure = (error: unknown): boolean => {
  if (!(error instanceof ApiFailure)) return false
  const { status } = error
  return status === undefined || status === 408 || status === 429 || status >= 500
}

export const parseApiFailure = (input: unknown, status: number): ApiFailure => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return new ApiFailure({ message: `Cererea a eșuat (${String(status)}).`, status })
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
