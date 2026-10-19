import assert from "node:assert/strict"
import test from "node:test"

import type { AnafCompany, OpenapiCompany } from "../contracts/providers.ts"
import { countyFromName } from "./address.ts"
import { proposalFromAnaf, proposalFromOpenapi, suggestionsFromOpenapi } from "./proposal.ts"

// Synthetic companies only: invented names and CUIs with a valid check digit.
const anaf = (overrides: Partial<AnafCompany> = {}): AnafCompany => ({
  date_generale: { cui: 12345674, denumire: " EXEMPLU TEST SRL ", nrRegCom: "J32/100/2020", stare_inregistrare: "INREGISTRAT din data 01.02.2020" },
  inregistrare_scop_Tva: { scpTVA: true },
  stare_inactiv: { statusInactivi: false, dataRadiere: "" },
  adresa_sediu_social: {
    sdenumire_Strada: "Str. Exemplului", snumar_Strada: "12", sdenumire_Localitate: "Mun. Sibiu",
    scod_JudetAuto: "SB", scod_Postal: "550001",
  },
  ...overrides,
})

void test("ANAF: a company outside Bucharest maps field by field", () => {
  assert.deepEqual(proposalFromAnaf(anaf()), {
    name: "EXEMPLU TEST SRL", cui: "12345674", vatRegistered: true, tradeRegisterNumber: "J32/100/2020",
    inactive: false, deregistered: false,
    address: { county: "RO-SB", city: "Mun. Sibiu", street: "Str. Exemplului nr. 12", postalCode: "550001" },
  })
})

void test("ANAF: Bucharest takes the sector from the locality and restores the postal code's leading zero", () => {
  const proposal = proposalFromAnaf(anaf({ adresa_sediu_social: {
    sdenumire_Strada: "Şos. Exemplu", snumar_Strada: "148", sdenumire_Localitate: "Sector 6 Mun. Bucureşti",
    scod_JudetAuto: "B", scod_Postal: "60787",
  } }))
  assert.deepEqual(proposal.address, { county: "RO-B", sector: 6, city: "București", street: "Şos. Exemplu nr. 148", postalCode: "060787" })
})

void test("ANAF: a Bucharest locality without a sector leaves the sector out instead of guessing", () => {
  const proposal = proposalFromAnaf(anaf({ adresa_sediu_social: { sdenumire_Localitate: "Mun. Bucureşti", scod_JudetAuto: "B", scod_Postal: "" } }))
  assert.deepEqual(proposal.address, { county: "RO-B", city: "București" })
  const outside = proposalFromAnaf(anaf({ adresa_sediu_social: { sdenumire_Localitate: "Sector 2", scod_JudetAuto: "IF" } }))
  assert.deepEqual(outside.address, { county: "RO-IF", city: "Sector 2" }, "a sector only exists in Bucharest")
})

void test("ANAF: an inactive, deregistered, non-VAT company says so", () => {
  const proposal = proposalFromAnaf(anaf({
    inregistrare_scop_Tva: { scpTVA: false },
    stare_inactiv: { statusInactivi: true, dataRadiere: "" },
    date_generale: { cui: 1235, denumire: "INACTIV TEST SRL", stare_inregistrare: "RADIERE din data 10.03.2024" },
  }))
  assert.deepEqual([proposal.vatRegistered, proposal.inactive, proposal.deregistered], [false, true, true])
  assert.equal("tradeRegisterNumber" in proposal, false)
  assert.equal(proposalFromAnaf(anaf({ stare_inactiv: { dataRadiere: "2024-03-10" } })).deregistered, true)
})

void test("ANAF: missing, blank, null or unknown fields stay absent", () => {
  const proposal = proposalFromAnaf({
    date_generale: { cui: 1235, denumire: "GOL TEST SRL", nrRegCom: "", stare_inregistrare: null },
    inregistrare_scop_Tva: { scpTVA: false },
  })
  assert.deepEqual(proposal, { name: "GOL TEST SRL", cui: "1235", vatRegistered: false, inactive: false, deregistered: false, address: {} })
  const odd = proposalFromAnaf(anaf({ adresa_sediu_social: {
    sdenumire_Strada: " ", snumar_Strada: "7", sdenumire_Localitate: null, scod_JudetAuto: "XX", scod_Postal: "5500",
  } }))
  assert.deepEqual(odd.address, {}, "a number without a street, an unknown county and a short postal code are dropped")
  assert.deepEqual(proposalFromAnaf(anaf({ adresa_sediu_social: { scod_JudetAuto: "SB", scod_Postal: "50001" } })).address,
    { county: "RO-SB" }, "outside Bucharest a five-digit postal code is not padded")
})

const openapi = (overrides: Partial<OpenapiCompany> = {}): OpenapiCompany => ({
  cif: "12345674", denumire: "EXEMPLU TEST SRL", numar_reg_com: "J32/100/2020",
  adresa: "Str. Exemplului 12, Sibiu", judet: "Sibiu", cod_postal: "550001", tva: "2020-02-01", radiata: false,
  ...overrides,
})

void test("openapi.ro: only the county and the postal code are taken from the address; the line is kept as is", () => {
  assert.deepEqual(proposalFromOpenapi(openapi()), {
    name: "EXEMPLU TEST SRL", cui: "12345674", vatRegistered: true, tradeRegisterNumber: "J32/100/2020", deregistered: false,
    address: { county: "RO-SB", postalCode: "550001", original: "Str. Exemplului 12, Sibiu" },
  })
})

void test("openapi.ro: no VAT date means not VAT registered, and a deregistered company says so", () => {
  const proposal = proposalFromOpenapi(openapi({ tva: null, radiata: true, judet: "Municipiul Bucureşti", cod_postal: "060787", cif: "RO1235" }))
  assert.deepEqual([proposal.vatRegistered, proposal.deregistered, proposal.cui], [false, true, "1235"])
  assert.deepEqual(proposal.address, { county: "RO-B", postalCode: "060787", original: "Str. Exemplului 12, Sibiu" })
  assert.equal("inactive" in proposal, false, "openapi.ro does not state inactivity")
})

void test("openapi.ro: an unknown county or a missing address stays absent", () => {
  assert.deepEqual(proposalFromOpenapi(openapi({ judet: "Ținutul Nou", cod_postal: null, adresa: "", numar_reg_com: null })).address, {})
})

void test("county names match whatever the diacritics, case, hyphen or prefix", () => {
  for (const [name, code] of [["Bistrita Nasaud", "RO-BN"], ["BISTRIȚA-NĂSĂUD", "RO-BN"], ["Judetul Iaşi", "RO-IS"], ["București", "RO-B"],
    ["Mun. Bucuresti", "RO-B"], ["Satu Mare", "RO-SM"], ["Caras-Severin", "RO-CS"]] as const) assert.equal(countyFromName(name), code, name)
  for (const name of ["", "Sibiu-Brasov", "Bucuresti Sector 1", undefined, null]) assert.equal(countyFromName(name), undefined, String(name))
})

void test("openapi.ro search: suggestions keep a lookupable CUI and a name", () => {
  assert.deepEqual(suggestionsFromOpenapi([
    { cif: "12345674", denumire: " EXEMPLU TEST SRL ", judet: "Sibiu" },
    { cif: "RO1235", denumire: "ALT EXEMPLU SRL", judet: null },
    { cif: "12345675", denumire: "CIFRA GRESITA SRL" },
    { cif: "98765438", denumire: " " },
  ]), [
    { cui: "12345674", name: "EXEMPLU TEST SRL", county: "RO-SB" },
    { cui: "1235", name: "ALT EXEMPLU SRL" },
  ])
})
