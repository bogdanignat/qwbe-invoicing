import assert from "node:assert/strict"
import test from "node:test"

import { classifyDownload, classifyList, classifyValidation, validationEvent } from "./json-replies.ts"
import type { AnafReply } from "./replies.ts"
import { fiscalTransition } from "./states.ts"

const reply = (body: unknown, status = 200, retryAfter: string | null = null): AnafReply =>
  ({ status, retryAfter, body: typeof body === "string" ? body : JSON.stringify(body) })
const bytes = (body: Uint8Array | string, status = 200): AnafReply<Uint8Array> =>
  ({ status, retryAfter: null, body: typeof body === "string" ? new TextEncoder().encode(body) : body })

void test("validare: ok passes, nok with messages fails, anything else is asked again", () => {
  assert.deepEqual(classifyValidation(reply({ stare: "ok", trace_id: "t" })), { kind: "valid" })
  const invalid = classifyValidation(reply({ stare: "nok", Messages: [{ message: "E: [BR-RO-010] lipseste" }, { other: 1 }], trace_id: "t" }))
  assert.deepEqual(invalid, { kind: "invalid", errors: ["E: [BR-RO-010] lipseste"] })
  assert.equal(fiscalTransition("validating", validationEvent(invalid)), "refused")
  assert.equal(fiscalTransition("validating", validationEvent({ kind: "valid" })), "uploading")
  for (const answer of [reply({ stare: "nok", Messages: [] }), reply({ stare: "nok" }), reply({ eroare: "x" }), reply("[]"), reply("<x/>"),
    reply({ stare: "ok" }, 500), reply({ stare: "ok" }, 302), reply("", 401), reply("", 429, "3")]) {
    assert.equal(fiscalTransition("validating", validationEvent(classifyValidation(answer))), "queued", answer.body)
  }
  assert.deepEqual(classifyValidation(reply("", 429, "3")), { kind: "rate_limited", retryAfterSeconds: 3 })
})

const message = { data_creare: "202610191215", cif: "12345674", id_solicitare: "5001120362", detalii: "Factura cu id_incarcare=5001120362 emisa de cif_emitent=12345674", tip: "FACTURA TRIMISA", id: "3001293434" }
const page = (mesaje: ReadonlyArray<unknown>) => ({ mesaje, serial: "s", cui: "12345674", titlu: "Lista Mesaje", numar_total_pagini: 1, index_pagina_curenta: 1 })

void test("lista: the messages, field by field, and an empty window still proves the right on the CIF", () => {
  assert.deepEqual(classifyList(reply(page([message]))), { kind: "messages", pages: 1, messages: [{
    id: "3001293434", uploadIndex: "5001120362", cif: "12345674", type: "FACTURA TRIMISA", createdAt: "202610191215", details: message.detalii,
  }] })
  assert.deepEqual(classifyList(reply({ eroare: "Nu exista mesaje in intervalul selectat", titlu: "Lista Mesaje" })), { kind: "messages", messages: [], pages: 0 })
})

void test("lista: a missing right is its own answer; errors, throttles and odd shapes prove nothing", () => {
  assert.deepEqual(classifyList(reply({ eroare: "Nu aveti drept in SPV pentru CIF=12345674", titlu: "Lista Mesaje" })), { kind: "no_right" })
  assert.deepEqual(classifyList(reply({ eroare: "CIF introdus= 1x nu este un numar" })), { kind: "anaf_error", errors: ["CIF introdus= 1x nu este un numar"] })
  assert.deepEqual(classifyList(reply("", 403)), { kind: "auth_refused" })
  for (const answer of [reply(page([{ ...message, id: 3001293434 }])), reply(page([{ ...message, tip: undefined }])), reply({ ...page([message]), numar_total_pagini: "1" }),
    reply({ mesaje: [] }), reply({}), reply("not json"), reply(page([message]), 500), reply({ eroare: 1 })]) {
    assert.deepEqual(classifyList(answer), { kind: "unrecognized" }, answer.body)
  }
})

void test("descarcare: a ZIP by its signature, ANAF's error in JSON with 200, nothing else", () => {
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])
  assert.deepEqual(classifyDownload(bytes(zip)), { kind: "archive", archive: zip })
  assert.deepEqual(classifyDownload(bytes(JSON.stringify({ eroare: "Pentru id=1 nu exista inregistrata nici o factura", titlu: "Descarcare mesaj" }))),
    { kind: "anaf_error", errors: ["Pentru id=1 nu exista inregistrata nici o factura"] })
  assert.deepEqual(classifyDownload({ ...bytes(""), status: 429, retryAfter: "1" }), { kind: "rate_limited", retryAfterSeconds: 1 })
  for (const answer of [bytes(zip, 500), bytes(new Uint8Array([0x50, 0x4b, 0x05, 0x06])), bytes("{}"), bytes(""), bytes(new Uint8Array([0xff, 0xfe, 0x00]))]) {
    assert.deepEqual(classifyDownload(answer), { kind: "unrecognized" })
  }
})
