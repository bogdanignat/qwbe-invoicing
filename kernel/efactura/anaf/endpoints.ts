import type { AnafEnvironment } from "../../../cubes/invoicing/efactura/connection/index.ts"

/**
 * ANAF's addresses, as constants: nothing in a request, the configuration or
 * the database can point a call anywhere else. The environment only picks the
 * base, and `prod` is used only when `ANAF_ENVIRONMENT=prod` is written out.
 * Tests replace the transport, never these URLs.
 */
export const ANAF_API_BASES: Readonly<Record<AnafEnvironment, string>> = {
  test: "https://api.anaf.ro/test/FCTEL/rest",
  prod: "https://api.anaf.ro/prod/FCTEL/rest",
}

/**
 * `validare` exists only on ANAF's public production service, without OAuth:
 * ANAF TEST answers 404 to it (with a token) and 401 (without). It only checks
 * the XML and registers nothing in SPV, so both environments use it, and no
 * token is ever sent to it.
 */
const VALIDATION_BASE = "https://webservicesp.anaf.ro/prod/FCTEL/rest"

const OAUTH_BASE = "https://logincert.anaf.ro/anaf-oauth2/v1"

export const ANAF_OAUTH = {
  authorize: `${OAUTH_BASE}/authorize`,
  token: `${OAUTH_BASE}/token`,
  revoke: `${OAUTH_BASE}/revoke`,
} as const

export interface ListWindow {
  readonly cif: string
  /** Epoch milliseconds; ANAF accepts at most 60 days between the two. */
  readonly startTime: number
  readonly endTime: number
  /** 1-based. */
  readonly page: number
}

const query = (parameters: Readonly<Record<string, string>>): string => new URLSearchParams(parameters).toString()

/** The e-Factura calls of one environment; `validate` is the same public URL in both (see `VALIDATION_BASE`). */
export const anafApi = (environment: AnafEnvironment) => {
  const base = ANAF_API_BASES[environment]
  return {
    validate: (standard: "FACT1" | "FCN") => `${VALIDATION_BASE}/validare/${standard}`,
    upload: (standard: "UBL" | "CN", cif: string) => `${base}/upload?${query({ standard, cif })}`,
    status: (uploadIndex: string) => `${base}/stareMesaj?${query({ id_incarcare: uploadIndex })}`,
    list: (window: ListWindow) => `${base}/listaMesajePaginatieFactura?${query({
      startTime: String(window.startTime), endTime: String(window.endTime), cif: window.cif, pagina: String(window.page),
    })}`,
    download: (downloadId: string) => `${base}/descarcare?${query({ id: downloadId })}`,
  }
}

/** Every ANAF call: 30 seconds for the whole exchange, at most 11 MB read (a 10 MB XML plus its envelope). */
export const ANAF_HTTP = { timeoutMs: 30_000, maxBodyBytes: 11 * 1024 * 1024 } as const
