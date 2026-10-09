import assert from "node:assert/strict"
import test from "node:test"

import { characterCount, normalizeSpace } from "../cube/efactura/decimals.ts"
import { ROMANIAN_COUNTIES } from "../cube/invoicing/index.ts"
import { CIUS_TEXT_LIMITS, ciusTextLength } from "../cube/invoicing/domain/validation.ts"
import { validateIssuerForIssuance } from "../cube/invoicing/issuer/index.ts"
import { CIUS_TEXT_LIMITS as FRONTEND_CIUS_TEXT_LIMITS } from "../frontend/src/lib/cius-text-limits.ts"
import { issuerIssuanceWarning } from "../frontend/src/lib/invoice-authoring-workflow.ts"
import { ROMANIAN_COUNTIES as FRONTEND_COUNTIES } from "../frontend/src/lib/romanian-counties.ts"

// The frontend mirrors these rules instead of importing the cube. Nothing else
// notices when one side changes alone (T-1651), so this probe holds them equal.

void test("the frontend county list is the cube's, code and name, in the same order", () => {
  assert.deepEqual(FRONTEND_COUNTIES, ROMANIAN_COUNTIES)
})

void test("the frontend text limits are the cube's CIUS-RO limits", () => {
  assert.deepEqual(FRONTEND_CIUS_TEXT_LIMITS, CIUS_TEXT_LIMITS)
})

void test("the cube counts a text the way the e-Factura export counts it", () => {
  const samples = ["", "a", " a ", "\ta\r\n b\t", "a ", " a ", "﻿a", "😀😀", "  ș  ț  ", "a   b"]
  for (const sample of samples) {
    assert.equal(ciusTextLength(sample), characterCount(normalizeSpace(sample)), JSON.stringify(sample))
  }
})

void test("the editor warns about the issuer exactly when issuance would refuse it", () => {
  const complete = { legalForm: "srl", tradeRegistryNumber: "J40/123/2020", socialCapital: "200.00", iban: "", bankName: "" }
  const cases = [
    complete,
    { ...complete, socialCapital: "" },
    { ...complete, legalForm: "pfa", socialCapital: "" },
    { ...complete, tradeRegistryNumber: "" },
  ]
  for (const issuer of cases) {
    let refused = false
    try { validateIssuerForIssuance(issuer) } catch { refused = true }
    assert.equal(issuerIssuanceWarning(issuer) !== undefined, refused, JSON.stringify(issuer))
  }
})
