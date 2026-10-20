import assert from "node:assert/strict"
import test from "node:test"

import { classifyList, classifyValidation } from "./json-replies.ts"
import { CNP_MASK, sanitizedMessages, type AnafReply } from "./replies.ts"
import { classifyStatus, classifyUpload } from "./xml-replies.ts"

/**
 * A CNP ANAF echoes back in an error never reaches the stored errors: every
 * run of exactly 13 digits is masked, before the cut to 500 characters. Upload
 * indexes and download ids (up to 20 digits) are never inside these texts, and
 * a longer run of digits is not a CNP.
 */

const CNP = "1800101221144"
const reply = (body: string): AnafReply => ({ status: 200, retryAfter: null, body })
const header = (attributes: string, children = "") =>
  `<?xml version="1.0" encoding="UTF-8"?><header xmlns="mfp:anaf:dgti:spv:respUploadFisier:v1" ${attributes}>${children}</header>`
const errors = (result: { readonly kind: string }) => "errors" in result ? result.errors : []

void test("exactly 13 digits are masked wherever they stand; shorter and longer runs of digits stay", () => {
  assert.deepEqual(sanitizedMessages([
    `cif_beneficiar=${CNP}`, `${CNP} invalid`, `(${CNP}).`, "BT-47 0000000000000", `RO${CNP}x`,
    "index 5001120362", "id 30000000012345678", "12345678901234", "123456789012",
  ]), [
    `cif_beneficiar=${CNP_MASK}`, `${CNP_MASK} invalid`, `(${CNP_MASK}).`, `BT-47 ${CNP_MASK}`, `RO${CNP_MASK}x`,
    "index 5001120362", "id 30000000012345678", "12345678901234", "123456789012",
  ])
})

void test("a CNP at the 500-character cut is masked whole, not left half visible", () => {
  const [message] = sanitizedMessages([`${"x".repeat(493)}${CNP}`])
  assert.equal(message, `${"x".repeat(493)}${CNP_MASK.slice(0, 7)}`)
  assert.doesNotMatch(message, /[0-9]/u)
})

void test("a CNP echoed by validare, upload, stareMesaj or the list is masked in what is kept", () => {
  const validation = classifyValidation(reply(JSON.stringify({ stare: "nok", trace_id: "t",
    Messages: [{ message: `E: [BR-RO-100] CNP ${CNP} invalid` }] })))
  assert.deepEqual(errors(validation), [`E: [BR-RO-100] CNP ${CNP_MASK} invalid`])
  const upload = classifyUpload(reply(header(`ExecutionStatus="1"`, `<Errors errorMessage="Cumparator ${CNP} necunoscut"/>`)))
  assert.deepEqual(upload, { kind: "refused", errors: [`Cumparator ${CNP_MASK} necunoscut`] })
  const status = classifyStatus(reply(header("", `<Errors errorMessage="Factura pentru ${CNP} nu poate fi comunicata"/>`)))
  assert.deepEqual(status, { kind: "anaf_error", errors: [`Factura pentru ${CNP_MASK} nu poate fi comunicata`] })
  const list = classifyList(reply(JSON.stringify({ numar_total_pagini: 1, mesaje: [{ data_creare: "202610191215", cif: "12345674",
    id_solicitare: "5000000001", tip: "FACTURA TRIMISA", id: "3000000001",
    detalii: `Factura cu id_incarcare=5000000001 emisa de cif_emitent=12345674 pentru cif_beneficiar=${CNP}` }] })))
  assert.ok(list.kind === "messages")
  assert.deepEqual(list.messages.map(({ details, uploadIndex }) => [uploadIndex, details]), [["5000000001",
    `Factura cu id_incarcare=5000000001 emisa de cif_emitent=12345674 pentru cif_beneficiar=${CNP_MASK}`]])
})
