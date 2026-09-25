import assert from "node:assert/strict"
import test from "node:test"

import {
  documentSeriesNotice, documentSeriesPayload, documentTypeValue, newDocumentSeriesForm, seriesInputValue,
} from "./document-series-form.ts"
import type { DocumentSeries } from "./draft-models.ts"

const existing: ReadonlyArray<DocumentSeries> = [
  { organizationId: "org-1", documentType: "invoice", series: "FACT" },
  { organizationId: "org-1", documentType: "proforma", series: "PRO" },
]

void test("series form — starts on an invoice series and nothing typed", () => {
  assert.deepEqual(newDocumentSeriesForm(), { documentType: "invoice", series: "" })
})

void test("series input — is stored upper-case, as the backend keeps it", () => {
  assert.equal(seriesInputValue("fact-2026"), "FACT-2026")
  assert.equal(documentTypeValue("proforma"), "proforma")
  assert.equal(documentTypeValue("invoice"), "invoice")
  assert.equal(documentTypeValue("receipt"), "invoice")
})

void test("series payload — sends the upper-cased, trimmed series for the chosen type", () => {
  assert.deepEqual(documentSeriesPayload({ documentType: "invoice", series: "  fact-2026 " }, existing), {
    kind: "ready", payload: { documentType: "invoice", series: "FACT-2026" },
  })
  assert.deepEqual(documentSeriesPayload({ documentType: "proforma", series: "A" }, existing), {
    kind: "ready", payload: { documentType: "proforma", series: "A" },
  })
  assert.deepEqual(documentSeriesPayload({ documentType: "invoice", series: "A".repeat(20) }, []), {
    kind: "ready", payload: { documentType: "invoice", series: "A".repeat(20) },
  })
})

void test("series payload — refuses an empty series", () => {
  assert.deepEqual(documentSeriesPayload({ documentType: "invoice", series: "   " }, existing), {
    kind: "issue", field: "series", message: "Seria este obligatorie.",
  })
})

void test("series payload — refuses everything outside the accepted alphabet", () => {
  const message = "Seria are 1–20 de caractere: litere mari, cifre, „_” sau „-”, și începe cu o literă sau o cifră."
  for (const series of ["FACT 2026", "-FACT", "_FACT", "FACTĂ", "A".repeat(21), "FACT/1"]) {
    assert.deepEqual(documentSeriesPayload({ documentType: "invoice", series }, []), {
      kind: "issue", field: "series", message,
    })
  }
})

void test("series payload — refuses a series that already numbers that document type", () => {
  assert.deepEqual(documentSeriesPayload({ documentType: "invoice", series: "fact" }, existing), {
    kind: "issue", field: "series", message: "Seria FACT există deja pentru factură.",
  })
  assert.deepEqual(documentSeriesPayload({ documentType: "proforma", series: "PRO" }, existing), {
    kind: "issue", field: "series", message: "Seria PRO există deja pentru proformă.",
  })
})

void test("series payload — the same series may number the other document type", () => {
  assert.deepEqual(documentSeriesPayload({ documentType: "proforma", series: "FACT" }, existing), {
    kind: "ready", payload: { documentType: "proforma", series: "FACT" },
  })
})

void test("series notice — names what was added", () => {
  assert.equal(
    documentSeriesNotice({ organizationId: "org-1", documentType: "invoice", series: "FACT-2026" }),
    "Seria FACT-2026 pentru factură a fost adăugată.",
  )
  assert.equal(
    documentSeriesNotice({ organizationId: "org-1", documentType: "proforma", series: "PRO" }),
    "Seria PRO pentru proformă a fost adăugată.",
  )
})
