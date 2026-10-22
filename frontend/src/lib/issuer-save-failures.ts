/**
 * The refusals of a fiscal issuer change (`cubes/invoicing/issuer/contracts/fiscal-guard.ts`),
 * keyed as `parseApiFailure` looks them up: a conflict by its `code`, the 503 by its `error`.
 * A disagreement with ANAF is a 400 whose issue is already in Romanian. They sit
 * apart from `failureMessages` only because `api-errors.ts` is at 5600 of its
 * 6000 code characters and these would take it past the size gate.
 */
export const issuerSaveFailureMessages: Readonly<Record<string, string>> = {
  vat_change_affects_issued_documents: "Regimul de TVA nu poate fi schimbat de la această dată: există facturi sau stornouri emise începând cu ea. Alege o dată de după ultimul document emis.",
  fiscal_identifier_change_has_issued_documents: "CIF-ul firmei nu mai poate fi schimbat: există deja documente emise cu el.",
  issuer_changed_concurrently: "Datele fiscale ale firmei s-au schimbat în timpul salvării. Reîncarcă pagina și încearcă din nou.",
  vat_registry_unavailable: "Registrul ANAF al plătitorilor de TVA nu răspunde acum, așa că schimbarea regimului de TVA sau a CIF-ului nu a fost salvată. Încearcă mai târziu.",
}
