import { boolean, literal, nullableText, object } from "./model-decoder.ts"
import { dateTime } from "./format.ts"

/**
 * The ANAF connection as Setări → Integrări shows it (`GET /api/efactura/connection`).
 * The answer never holds a token: only the state, the environment, the CIF ANAF
 * proved and whether an attempt the user started never came back.
 */
const STATUSES = ["not_configured", "disconnected", "connected", "needs_reconnect"] as const
const ENVIRONMENTS = ["test", "prod"] as const
const ATTEMPTS = ["none", "pending", "expired"] as const

export type EFacturaConnectionStatus = typeof STATUSES[number]

export interface EFacturaConnection {
  readonly status: EFacturaConnectionStatus
  readonly environment: typeof ENVIRONMENTS[number]
  readonly verifiedCif: string | null
  readonly refreshExpiresAt: string | null
  readonly refreshExpiryWarning: boolean
  readonly connectedBy: string | null
  readonly connectedAt: string | null
  readonly attempt: typeof ATTEMPTS[number]
}

export const decodeEFacturaConnection = (input: unknown): EFacturaConnection => {
  const value = object(input)
  const connection: EFacturaConnection = {
    status: literal(STATUSES, value.status, "status"),
    environment: literal(ENVIRONMENTS, value.environment, "environment"),
    verifiedCif: nullableText(value.verifiedCif, "verifiedCif"),
    refreshExpiresAt: nullableText(value.refreshExpiresAt, "refreshExpiresAt"),
    refreshExpiryWarning: boolean(value.refreshExpiryWarning, "refreshExpiryWarning"),
    connectedBy: nullableText(value.connectedBy, "connectedBy"),
    connectedAt: nullableText(value.connectedAt, "connectedAt"),
    attempt: literal(ATTEMPTS, value.attempt, "attempt"),
  }
  // A connection is one ANAF verified: without the CIF, the moment and the expiry it is not one the screen can show.
  const verified = connection.verifiedCif !== null && connection.connectedAt !== null && connection.refreshExpiresAt !== null
  if (connection.status === "connected" && !verified) throw new Error("invalid connected identity")
  return connection
}

/** The `authorize` URL is followed by a top-level navigation, so only ANAF's OAuth server is accepted. */
export const decodeAuthorizeUrl = (input: unknown): string => {
  const url = new URL(String(object(input).authorizeUrl))
  if (url.origin !== "https://logincert.anaf.ro" || !url.pathname.startsWith("/anaf-oauth2/")) throw new Error("invalid authorizeUrl")
  return url.href
}

export const environmentLabel = (connection: EFacturaConnection): string =>
  connection.environment === "prod" ? "PRODUCȚIE" : "TEST"

const STATUS_LABELS: Readonly<Record<EFacturaConnectionStatus, string>> = {
  not_configured: "Neconfigurat",
  disconnected: "Deconectat",
  connected: "Conectat",
  needs_reconnect: "Necesită reconectare",
}

export interface ConnectionFact {
  readonly label: string
  readonly value: string
}

export interface EFacturaConnectionView {
  readonly environment: string
  readonly statusLabel: string
  readonly tone: "positive" | "muted" | "danger"
  readonly explanation: string
  readonly facts: ReadonlyArray<ConnectionFact>
  readonly expiryWarning: string | undefined
  readonly attemptNote: string | undefined
  readonly connectLabel: string | undefined
  readonly canDisconnect: boolean
}

export const ATTEMPT_NOTE = "Dacă ANAF a afișat o pagină de eroare sau n-ai fost întors aici, reîncearcă peste câteva minute."
export const DISCONNECT_CONFIRM = "Deconectezi aplicația de la ANAF e-Factura? Trimiterile în curs așteaptă până te reconectezi cu certificatul."

const EXPLANATIONS: Readonly<Record<EFacturaConnectionStatus, string>> = {
  not_configured: "Serverul nu are configurată aplicația OAuth ANAF (variabilele ANAF_* din .env). Pașii sunt în docs/LOCAL_DEVELOPMENT.md și docs/EFACTURA.md.",
  disconnected: "Aplicația nu este conectată la ANAF. Conectează-te cu certificatul digital care are drept SPV pe CIF-ul firmei.",
  connected: "Facturile și documentele storno se pot trimite în e-Factura din pagina fiecărui document.",
  needs_reconnect: "ANAF nu mai acceptă conexiunea salvată. Reconectează-te cu certificatul; trimiterile în curs așteaptă până atunci.",
}

const connectedFacts = (connection: EFacturaConnection): ReadonlyArray<ConnectionFact> => [
  ...connection.verifiedCif === null ? [] : [{ label: "CIF verificat", value: connection.verifiedCif }],
  ...connection.connectedAt === null ? [] : [{
    label: "Conectat la",
    value: connection.connectedBy === null ? dateTime(connection.connectedAt) : `${dateTime(connection.connectedAt)} de ${connection.connectedBy}`,
  }],
  ...connection.refreshExpiresAt === null ? [] : [{ label: "Conexiunea expiră", value: dateTime(connection.refreshExpiresAt) }],
]

/** Every sentence and switch of the e-Factura card, decided here so the card only renders it. */
export const connectionView = (connection: EFacturaConnection): EFacturaConnectionView => {
  const { status } = connection
  const connected = status === "connected"
  const verified = connected || status === "needs_reconnect"
  return {
    environment: environmentLabel(connection),
    statusLabel: STATUS_LABELS[status],
    tone: connected ? "positive" : status === "needs_reconnect" ? "danger" : "muted",
    explanation: EXPLANATIONS[status],
    facts: verified ? connectedFacts(connection) : [],
    expiryWarning: connected && connection.refreshExpiryWarning && connection.refreshExpiresAt !== null
      ? `Conexiunea cu ANAF expiră pe ${dateTime(connection.refreshExpiresAt)}. Reconectează-te cu certificatul înainte de această dată.`
      : undefined,
    attemptNote: status !== "not_configured" && connection.attempt !== "none" ? ATTEMPT_NOTE : undefined,
    connectLabel: status === "not_configured" ? undefined : verified ? "Reconectează cu certificatul" : "Conectează cu certificatul",
    canDisconnect: verified,
  }
}
