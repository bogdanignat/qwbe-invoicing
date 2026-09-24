import assert from "node:assert/strict"
import test from "node:test"

import { documentFilename } from "./browser-download.ts"

// The saved file is named from the document, not from the opaque identifier the
// route carries: what lands in the downloads folder is what the user can find.
void test("a document's file name is its series and number, not its id", () => {
  assert.equal(documentFilename("factura", { series: "FCT", number: 12 }, "pdf"), "factura-FCT-12.pdf")
  assert.equal(documentFilename("storno", { series: "STR", number: 4 }, "xml"), "storno-STR-4.xml")
})

void test("the extension follows the format actually fetched", () => {
  const invoice = { series: "FCT", number: 12 }
  assert.equal(documentFilename("factura", invoice, "xml"), "factura-FCT-12.xml")
})
