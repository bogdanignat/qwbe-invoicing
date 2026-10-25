import assert from "node:assert/strict"
import test from "node:test"

import { ValidationFailure } from "../../contracts/failures.ts"
import { itemIdentifiers, normalizeItemCode, validateBarcode } from "./item-identifiers.ts"

const issueOf = (run: () => unknown): string => {
  try {
    run()
  } catch (error) {
    return error instanceof ValidationFailure ? error.issues.join("; ") : String(error)
  }
  return "accepted"
}

void test("an article code is trimmed and then only printable ASCII: signs and inner spaces pass, diacritics do not", () => {
  assert.equal(normalizeItemCode("  SRB-M6 ", "code"), "SRB-M6")
  assert.equal(normalizeItemCode("\tSRB/M6 #1 (v2.0)\n", "code"), "SRB/M6 #1 (v2.0)")
  assert.equal(normalizeItemCode("x".repeat(50), "code"), "x".repeat(50))
  const char = (point: number) => String.fromCodePoint(point)
  for (const code of ["", "  ", "x".repeat(51), "A\tB", `A${char(0x85)}B`, `A${char(0x2028)}B`, `A${char(0x7f)}`, `A${char(0xa0)}B`,
    "ȘURUB", "Șurub", `Cafe${char(0x301)}`, "😀"]) {
    assert.equal(issueOf(() => normalizeItemCode(code, "itemCode")), "itemCode must be 1-50 printable ASCII characters", JSON.stringify(code))
  }
})

void test("a GTIN of 8, 12, 13 or 14 digits passes only with its check digit, and is never trimmed", () => {
  for (const barcode of ["96385074", "036000291452", "4006381333931", "00012345600012", "10614141000415"]) {
    assert.equal(issueOf(() => { validateBarcode(barcode) }), "accepted", barcode)
  }
  for (const barcode of ["4006381333932", "1234567", "123456789", "123456789012345", "400638133393a", " 96385074", ""]) {
    assert.equal(issueOf(() => { validateBarcode(barcode) }), "barcode must be a GTIN-8, 12, 13 or 14 with a valid check digit", barcode)
  }
})

void test("a line keeps only the identifiers it states, each checked", () => {
  assert.deepEqual(itemIdentifiers({}), {})
  assert.deepEqual(itemIdentifiers({ itemCode: " MAN " }), { itemCode: "MAN" })
  assert.deepEqual(itemIdentifiers({ barcode: "00012345600012" }), { barcode: "00012345600012" })
  assert.equal(issueOf(() => itemIdentifiers({ itemCode: "MAN", barcode: "96385075" })), "barcode must be a GTIN-8, 12, 13 or 14 with a valid check digit")
})
