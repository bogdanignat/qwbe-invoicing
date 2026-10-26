import assert from "node:assert/strict"
import test from "node:test"

import { textOf } from "./fields.ts"
import { readReceivedUbl } from "./reader.ts"
import type { UblNode } from "./xml-tree.ts"
import { BUYER_CIF, sampleXml } from "../../received-samples.test-support.ts"

const node = (text: string): UblNode => ({ namespace: undefined, local: "Note", attributes: {}, children: [], text })

void test("only tab, LF, CR and space are cut, and only at the two ends", () => {
  assert.equal(textOf(node("\t\r\n FX  100 \n\t\r")), "FX  100")
  assert.equal(textOf(node("FX 100")), "FX 100")
  assert.equal(textOf(node("x")), "x")
  assert.equal(textOf(node(" FX 100 ")), " FX 100 ")
  assert.equal(textOf(node("\fFX\v")), "\fFX\v")
})

void test("an empty or all-whitespace element, or none at all, is absent", () => {
  assert.equal(textOf(node("")), undefined)
  assert.equal(textOf(node(" \t\r\n ")), undefined)
  assert.equal(textOf(undefined), undefined)
})

void test("a million inner spaces are trimmed in linear time, alone and in a whole invoice", () => {
  const spaces = " ".repeat(1_000_000)
  const started = performance.now()
  assert.equal(textOf(node(` a${spaces}b `)), `a${spaces}b`)
  const read = readReceivedUbl(sampleXml({ header: `<cbc:Note>a${spaces}b</cbc:Note>` }), BUYER_CIF)
  const elapsed = performance.now() - started
  assert.ok(read.ok, JSON.stringify(!read.ok && read.failure))
  assert.deepEqual(read.document.notes, [`a${spaces}b`])
  assert.ok(elapsed < 1_000, `took ${elapsed.toFixed(0)} ms`)
})
