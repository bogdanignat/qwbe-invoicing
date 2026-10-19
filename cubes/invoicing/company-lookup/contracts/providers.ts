/**
 * Provider answers as the host hands them over: already decoded from JSON, field
 * names kept as the providers spell them. ANAF writes an empty value as `""`;
 * a field may also be missing or `null`, and the mapping treats all three alike.
 */
type Text = string | null | undefined

/** `found[0]` of `POST /api/PlatitorTvaRest/v9/tva`. */
export interface AnafCompany {
  readonly date_generale: {
    readonly cui: number
    readonly denumire: string
    readonly nrRegCom?: Text
    readonly stare_inregistrare?: Text
  }
  readonly inregistrare_scop_Tva: { readonly scpTVA: boolean }
  readonly stare_inactiv?: { readonly statusInactivi?: boolean | undefined; readonly dataRadiere?: Text } | undefined
  readonly adresa_sediu_social?: {
    readonly sdenumire_Strada?: Text
    readonly snumar_Strada?: Text
    readonly sdenumire_Localitate?: Text
    readonly scod_JudetAuto?: Text
    /** Text, as ANAF sends it; some Bucharest codes come with five digits, the leading zero missing from the data. */
    readonly scod_Postal?: Text
  } | undefined
}

/** `GET /api/companies/{cif}` of openapi.ro. `adresa` is one free-text line. */
export interface OpenapiCompany {
  readonly cif: string
  readonly denumire: string
  readonly numar_reg_com?: Text
  readonly adresa?: Text
  readonly judet?: Text
  readonly cod_postal?: Text
  readonly tva?: Text
  readonly radiata?: boolean | undefined
}

/** One entry of `data[]` from `POST /api/companies/search` of openapi.ro. */
export interface OpenapiSuggestion {
  readonly cif: string
  readonly denumire: string
  readonly judet?: Text
}
