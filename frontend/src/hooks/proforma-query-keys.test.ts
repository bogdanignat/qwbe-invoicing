import assert from "node:assert/strict"
import test from "node:test"

import { proformaQueryKey, proformasQueryKey, staleProformaKeys } from "./proforma-query-keys.ts"

/**
 * What a proforma write invalidates, as data: the hook only loops over these
 * keys, so the rule that a conversion also stales the proforma it started from
 * is checked here rather than through a mounted query client.
 */

void test("a write that names no proforma stales the registry alone", () => {
  assert.deepEqual(staleProformaKeys(undefined), [proformasQueryKey])
})

void test("a conversion stales the source proforma too, or its screen keeps offering the conversion", () => {
  assert.deepEqual(staleProformaKeys("prf-1"), [proformasQueryKey, proformaQueryKey("prf-1")])
})

void test("the two keys never collide: the registry is not a prefix of one document", () => {
  assert.notDeepEqual(proformaQueryKey("prf-1"), proformaQueryKey("prf-2"))
  assert.equal(proformaQueryKey("prf-1")[0], "proforma")
  assert.notEqual(proformasQueryKey[0], proformaQueryKey("prf-1")[0])
})
