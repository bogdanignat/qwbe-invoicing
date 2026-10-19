import assert from "node:assert/strict"
import test from "node:test"

import { ApiFailure } from "./api-errors.ts"
import type { CompanyLookupAvailability, CompanyProposal } from "./company-lookup-model.ts"
import {
  QUOTA_EXCEEDED, cuiLookupQuery, lookupFailureMessage, lookupOutcome, nameSearchQuery, searchNote,
  usableAvailability,
} from "./company-lookup-query.ts"
import { isValidRomanianCui } from "./romanian-cui.ts"
import { normalizeRomanianCui } from "./vat-defaults.ts"

const anaf: CompanyLookupAvailability = { provider: "anaf", nameSearch: false, minCuiDigits: 4, minNameLetters: 6 }
const openapi: CompanyLookupAvailability = { ...anaf, provider: "openapi", nameSearch: true }
const read = <T>(data: T | undefined, error: unknown = null) => ({ data, isPending: data === undefined && error === null, error })
const proposal: CompanyProposal = { name: "Exemplu SRL", cui: "13548146", vatRegistered: true, deregistered: false, address: {} }

void test("the check digit is the backend's: valid CUIs pass, a changed last digit does not", () => {
  for (const cui of ["13548146", "14399840", "1006", "108"]) assert.equal(isValidRomanianCui(cui), true, cui)
  for (const cui of ["13548147", "1007", "0135481", "12345678901", "1", "", "12a4"]) assert.equal(isValidRomanianCui(cui), false, cui)
})

void test("a CUI is normalized before it is judged: RO prefix, spaces and case go", () => {
  assert.equal(normalizeRomanianCui(" ro 13548146 "), "13548146")
  assert.equal(normalizeRomanianCui("RO13548146"), "13548146")
  assert.equal(cuiLookupQuery(anaf, "ro 13548146"), "13548146")
})

void test("no CUI query below 4 digits, with letters, or with a wrong check digit", () => {
  for (const raw of ["", "1", "10", "108", "RO108", "13548147", "1354814A", "RO", "13 548146", "-1006"]) {
    assert.equal(cuiLookupQuery(anaf, raw), undefined, raw)
  }
  assert.equal(cuiLookupQuery(anaf, "1006"), "1006", "four digits with a valid check digit is enough")
  assert.equal(cuiLookupQuery({ ...anaf, minCuiDigits: 5 }, "1006"), undefined, "the server may only raise the threshold")
  assert.equal(cuiLookupQuery({ ...anaf, minCuiDigits: 2 }, "108"), undefined, "and never lower it")
})

void test("without a usable provider there is no query at all", () => {
  assert.equal(cuiLookupQuery(undefined, "13548146"), undefined)
  assert.equal(nameSearchQuery(undefined, "Exemplu Construct"), undefined)
  assert.equal(usableAvailability(read({ ...anaf, provider: "none" })), undefined, "provider none")
  assert.equal(usableAvailability(read(undefined, new ApiFailure({ message: "no", status: 403 }))), undefined, "403: no feature, no error")
  assert.equal(usableAvailability(read(undefined)), undefined, "still loading")
  assert.deepEqual(usableAvailability(read(anaf)), anaf)
})

void test("names are searched only with nameSearch, from 6 letters, at most 100 characters", () => {
  assert.equal(nameSearchQuery(anaf, "Exemplu Construct"), undefined, "ANAF has no name search")
  assert.equal(nameSearchQuery(openapi, "Exemp"), undefined)
  assert.equal(nameSearchQuery(openapi, "Ex 1234 56"), undefined, "digits are not letters")
  assert.equal(nameSearchQuery(openapi, "  Ștefăn  "), "Ștefăn", "six letters with diacritics, trimmed")
  assert.equal(nameSearchQuery(openapi, "a".repeat(101)), undefined)
  assert.equal(nameSearchQuery({ ...openapi, minNameLetters: 8 }, "Exemplu"), undefined)
})

void test("failures are one short sentence; quota has its own; NotFound is not a failure", () => {
  assert.equal(lookupFailureMessage(new ApiFailure({ message: "x", status: 429 })), QUOTA_EXCEEDED)
  assert.equal(QUOTA_EXCEEDED, "Cererile openapi.ro s-au terminat.")
  const auth = new ApiFailure({ message: "openapi.ro a refuzat cheia configurată.", status: 502 })
  assert.equal(lookupFailureMessage(auth), auth.message)
  assert.match(lookupFailureMessage(new ApiFailure({ message: "Failed to fetch" })), /manual/u)
  assert.match(lookupFailureMessage(new Error("invalid name")), /manual/u)
  assert.deepEqual(lookupOutcome("13548146", read(undefined, new ApiFailure({ message: "x", status: 404 })), undefined), { kind: "not-found" })
  assert.deepEqual(lookupOutcome("13548146", read(undefined, new ApiFailure({ message: "x", status: 429 })), undefined),
    { kind: "failed", message: QUOTA_EXCEEDED })
})

void test("the outcome: idle without a query, pending, found, and applied once copied in", () => {
  assert.deepEqual(lookupOutcome(undefined, read(proposal), undefined), { kind: "idle" })
  assert.deepEqual(lookupOutcome("13548146", read(undefined), undefined), { kind: "pending" })
  assert.deepEqual(lookupOutcome("13548146", read(proposal), undefined), { kind: "found", proposal })
  assert.deepEqual(lookupOutcome("13548146", read(proposal), "13548146"), { kind: "applied" })
  assert.deepEqual(lookupOutcome("13548146", read(proposal), "14399840"), { kind: "found", proposal })
})

void test("the search note: nothing without a query, then searching, none found, or the failure", () => {
  assert.equal(searchNote(undefined, read(undefined)), undefined)
  assert.equal(searchNote("Exemplu", read(undefined)), "Se caută firme…")
  assert.equal(searchNote("Exemplu", read([])), "Nu am găsit nicio firmă cu acest nume.")
  assert.equal(searchNote("Exemplu", read([{}])), undefined)
  assert.equal(searchNote("Exemplu", read(undefined, new ApiFailure({ message: "x", status: 429 }))), QUOTA_EXCEEDED)
})
