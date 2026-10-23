import assert from "node:assert/strict"
import test from "node:test"

import { RECEIVED_XML_LIMITS, readReceivedUbl } from "./reader.ts"
import { BUYER_CIF, largeInvoiceXml, sampleXml } from "../../received-samples.test-support.ts"

void test("a realistic invoice at the 10 MB limit is read whole", () => {
  const result = readReceivedUbl(largeInvoiceXml(RECEIVED_XML_LIMITS.maxChars - 64 * 1024), BUYER_CIF)
  assert.ok(result.ok, JSON.stringify(!result.ok && result.failure))
  assert.ok(result.document.lines.length > 7_000)
})

void test("a flood of the shortest UBL elements is refused for its count, well under the size limit", () => {
  const flood = sampleXml({ header: "<cbc:Note/>".repeat(RECEIVED_XML_LIMITS.maxElements) })
  assert.ok(flood.length < RECEIVED_XML_LIMITS.maxChars / 2)
  assert.deepEqual(readReceivedUbl(flood, BUYER_CIF), { ok: false, failure: { reason: "xml", refusal: "too_many_elements" } })
})
