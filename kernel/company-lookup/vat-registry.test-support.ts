import type { Transport } from "../outbound/send.ts"
import { ANAF_URL } from "./anaf-client.ts"
import { json } from "./transport.test-support.ts"

/** Whether `cui` is registered for VAT on `date`; `undefined`: ANAF does not know the CUI. */
export type RegistryAnswer = (cui: number, date: string) => boolean | undefined

/** The test issuer `12345674`, registered for VAT on every day. */
export const registeredIssuer: RegistryAnswer = (cui) => cui === 12345674 ? true : undefined

/**
 * A transport that answers ANAF's VAT registry (`PlatitorTvaRest`) from
 * `answer` and hands every other request to `next`, so no test that saves the
 * issuer with the company-lookup plugin on reaches the live ANAF.
 */
export const anafRegistry = (answer: RegistryAnswer = registeredIssuer, next: Transport = fetch): Transport => async (url, init) => {
  if (url !== ANAF_URL) return next(url, init)
  const [asked] = JSON.parse(typeof init.body === "string" ? init.body : "[]") as ReadonlyArray<{ readonly cui: number; readonly data: string }>
  if (asked === undefined) return json({ found: [], notFound: [] })
  const registered = answer(asked.cui, asked.data)
  return registered === undefined ? json({ found: [], notFound: [asked.cui] }, 404) : json({ found: [{
    date_generale: { cui: asked.cui, denumire: "FIRMA TEST SRL", data: asked.data },
    inregistrare_scop_Tva: { scpTVA: registered, perioade_TVA: [] },
  }], notFound: [] })
}
