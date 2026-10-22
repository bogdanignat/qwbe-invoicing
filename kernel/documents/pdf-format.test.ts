import assert from "node:assert/strict"
import test from "node:test"

import { partyAddressLines } from "./pdf-format.ts"

const party = (address: Parameters<typeof partyAddressLines>[0]["address"]) =>
  ({ vatRegistered: true, name: "ORANGE ROMANIA SA", fiscalIdentifier: "9010105", address })

// T-1985: Bucharest's county is named `București`, like its city, and printed twice.
void test("a PDF address prints the county once, and only when the city does not name it", () => {
  assert.deepEqual(
    partyAddressLines(party({ countryCode: "RO", city: "București", street: "Bd. Lascăr Catargiu 47-53", county: "RO-B", sector: 1 })),
    ["Bd. Lascăr Catargiu 47-53", "București, Sector 1", "RO"],
  )
  assert.deepEqual(
    partyAddressLines(party({ countryCode: "RO", city: "Botoșani", street: "Strada Mare 1", county: "RO-BT", postalCode: "710001" })),
    ["Strada Mare 1", "Botoșani, 710001", "RO"],
  )
  assert.deepEqual(
    partyAddressLines(party({ countryCode: "RO", city: "Dorohoi", street: "Strada Mică 2", county: "RO-BT" })),
    ["Strada Mică 2", "Dorohoi, Botoșani", "RO"],
  )
})
