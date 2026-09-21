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
