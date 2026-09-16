import assert from "node:assert/strict"
import test from "node:test"

import { ROMANIAN_COUNTIES } from "../cube/invoicing/index.ts"
import { ROMANIAN_COUNTIES as webCounties } from "../web/src/romanian-counties.ts"
import { fiscalIdentity, formattedRomanianAddress } from "../web/src/fiscal-identity.ts"
import { partyAddressLines, partyIdentifierLine } from "./pdf-renderer.ts"

void test("web and invoice catalogs retain exact county parity and readable PDF addresses", () => {
  assert.deepEqual(webCounties, ROMANIAN_COUNTIES)
  assert.equal(ROMANIAN_COUNTIES.length, 42)
  for (const { code } of ROMANIAN_COUNTIES) {
    for (const sector of code === "RO-B" ? [1, 2, 3, 4, 5, 6] : [undefined]) {
      const address = { countryCode: "RO", city: "Localitate", street: "Strada 1", county: code,
        ...(sector === undefined ? {} : { sector }), postalCode: "123456" }
      const party = { name: "Firma", fiscalIdentifier: "12345674", vatRegistered: true, address }
      assert.equal(partyAddressLines(party).join(", "), formattedRomanianAddress(address))
    }
  }
})

void test("web and PDF derive VAT identity solely from the frozen explicit flag", () => {
  for (const partyType of ["company", "individual"] as const) {
    for (const vatRegistered of partyType === "individual" ? [false] : [true, false]) {
      for (const fiscalIdentifier of partyType === "individual" ? ["", "1800101221144"] : ["12345674"]) {
        const party = { name: "Parte", partyType, vatRegistered, fiscalIdentifier,
          address: { countryCode: "RO", city: "Iași", street: "Strada 1", county: "RO-IS" } }
        const identity = fiscalIdentity(party)
        const line = partyIdentifierLine(party)
        if (fiscalIdentifier === "") assert.equal(line, undefined)
        else assert.equal(line, `${partyType === "individual" ? "CNP" : "CUI"}: ${fiscalIdentifier}${identity.vatIdentifier === null ? "" : ` · Cod TVA: ${identity.vatIdentifier}`}`)
      }
    }
  }
})
