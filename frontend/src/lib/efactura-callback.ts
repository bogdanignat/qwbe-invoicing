import { parseSearch, stringifySearch } from "./search-params.ts"

/**
 * The code ANAF's callback leaves in `?anaf=` (`GET /api/anaf/callback`, always
 * a 303 to `/integrations?anaf=<code>`), as Integrări says it.
 * The query is shown once and then dropped from the address, so a refresh or a
 * bookmark never repeats an outcome that is no longer current.
 */
export interface CallbackNotice {
  readonly tone: "success" | "warning"
  readonly message: string
}

const RETRY = "Pornește din nou conectarea."
const MESSAGES: ReadonlyMap<string, string> = new Map(Object.entries({
  neconfigurat: "Serverul nu are configurată aplicația OAuth ANAF. Conexiunea nu a fost salvată.",
  tentativa_lipsa: `Conectarea nu a mai putut fi recunoscută (a fost pornită alta între timp sau din alt browser). ${RETRY}`,
  tentativa_expirata: `Conectarea a expirat, reîncearcă. Ai la dispoziție 10 minute de la apăsarea butonului.`,
  tentativa_folosita: `Această conectare a fost deja folosită. ${RETRY}`,
  refuzat_anaf: `ANAF a refuzat autorizarea. ${RETRY}`,
  cod_lipsa: `ANAF nu a trimis codul de autorizare. ${RETRY}`,
  schimb_esuat: "ANAF nu a emis tokenul de acces. Reîncearcă peste câteva minute.",
  fara_drept_cif: "Certificatul nu are drept SPV pe CIF-ul firmei. Conexiunea nu a fost salvată.",
  verificare_esuata: "Dreptul pe CIF-ul firmei nu a putut fi verificat la ANAF. Conexiunea nu a fost salvată; reîncearcă peste câteva minute.",
  conexiune_schimbata: "Conexiunea s-a schimbat între timp (altă conectare sau o deconectare), așa că aceasta nu a fost salvată.",
  eroare: "Conectarea a eșuat din cauza unei erori a serverului. Reîncearcă peste câteva minute.",
}))

/** The notice for a code; an unknown code still says that the connection did not go through, never a raw value. */
export const callbackNotice = (code: string): CallbackNotice => code === "conectat"
  ? { tone: "success", message: "Conectat la ANAF e-Factura. Dreptul SPV pe CIF-ul firmei a fost verificat." }
  : { tone: "warning", message: MESSAGES.get(code) ?? "Conectarea la ANAF nu a reușit. Reîncearcă." }

/** The `anaf` code of an address, if it carries one. */
export const callbackCode = (searchStr: string): string | undefined => parseSearch(searchStr).anaf

/** The same address without `anaf`, the other pairs kept. */
export const withoutCallbackCode = (searchStr: string): string => {
  const pairs = parseSearch(searchStr)
  delete pairs.anaf
  return stringifySearch(pairs)
}
