import { ApiFailure } from "./api-errors.ts"

/**
 * What the e-Factura screens say when the backend refuses, in Romanian. The
 * `409` answers carry a code and no message (`DomainConflict`), so each code
 * the plugin can answer has its sentence here; the rest keep the shared wording
 * of `api-errors.ts`. The browser never checks a grant itself: the `403` is the answer.
 */
const RETRY_SOON = "Reîncearcă peste un minut."
const MESSAGES: ReadonlyMap<string, string> = new Map(Object.entries({
  efactura_not_configured: "Serverul nu are configurată aplicația OAuth ANAF. Vezi Integrări.",
  efactura_not_connected: "Aplicația nu este conectată la ANAF. Conectează-te cu certificatul din Integrări.",
  efactura_issuer_cif_invalid: "Datele firmei nu au un CIF pe care ANAF să-l poată verifica. Corectează CIF-ul în Setări, la datele firmei.",
  efactura_cif_mismatch: "CIF-ul emitentului de pe document nu este CIF-ul pentru care a fost verificată conexiunea ANAF.",
  efactura_xml_too_large: "XML-ul documentului depășește limita ANAF de 10 MB.",
  efactura_not_unknown: "Trimiterea nu mai are starea „necunoscut” (a fost legată, retrimisă sau a avansat). Reîncarcă pagina.",
  efactura_connection_refreshing: `Conexiunea cu ANAF se reîmprospătează. ${RETRY_SOON}`,
  efactura_rate_limited: `ANAF a cerut o pauză sau s-a atins limita de apeluri. ${RETRY_SOON}`,
  efactura_anaf_unavailable: `ANAF nu a răspuns clar. ${RETRY_SOON}`,
  efactura_no_right: "ANAF spune că certificatul conectat nu are drept SPV pe acest CIF. Reconectează-te cu certificatul potrivit.",
  efactura_index_not_listed: "Indexul nu apare în lista ANAF pentru acest CIF și această perioadă, așa că nu a fost legat.",
  efactura_index_linked: "Indexul este deja legat de altă trimitere.",
}))

const DENIED = "Nu ai permisiunea pentru această operație e-Factura. Cere-i administratorului aplicației dreptul necesar."

export const efacturaFailureMessage = (error: unknown): string => {
  if (!(error instanceof Error)) return "A apărut o eroare neașteptată."
  if (!(error instanceof ApiFailure)) return error.message
  if (error.status === 403) return DENIED
  return (error.code === undefined ? undefined : MESSAGES.get(error.code)) ?? error.message
}

/** The failure as the shared alert shows it: an `Error` whose message is already the sentence above. */
export const efacturaFailure = (error: unknown): Error | undefined =>
  error === null || error === undefined ? undefined : new Error(efacturaFailureMessage(error))

/**
 * A fetch of received invoices is refused for the issuer's CIF, not a
 * document's: the shared sentence for `efactura_cif_mismatch` names a document,
 * so this one says which CIF and where to fix it. The rest are the plugin's own.
 */
const RECEIVED_CIF_MISMATCH = "Conexiunea ANAF este verificată pentru alt CIF decât cel din datele firmei. "
  + "Reconectează-te din Integrări cu certificatul firmei sau corectează CIF-ul în Setări."

export const receivedFetchFailure = (error: unknown): Error | undefined =>
  error instanceof ApiFailure && error.code === "efactura_cif_mismatch" ? new Error(RECEIVED_CIF_MISMATCH) : efacturaFailure(error)
