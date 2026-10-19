import assert from "node:assert/strict"
import test from "node:test"

import { sanitizedMessages, type AnafReply } from "./replies.ts"
import { fiscalTransition } from "./states.ts"
import { UPLOAD_EVENTS, classifyStatus, classifyUpload, statusEvent } from "./xml-replies.ts"

const reply = (body: string, status = 200, retryAfter: string | null = null): AnafReply => ({ status, retryAfter, body })
const header = (attributes: string, children = "") =>
  `<?xml version="1.0" encoding="UTF-8"?><header xmlns="mfp:anaf:dgti:spv:respUploadFisier:v1" ${attributes}>${children}</header>`
const error = (message: string) => `<Errors errorMessage="${message}"/>`

void test("an upload is indexed only by ExecutionStatus 0 with a numeric index and no error", () => {
  assert.deepEqual(classifyUpload(reply(header(`ExecutionStatus="0" index_incarcare="5001120362"`))), { kind: "indexed", uploadIndex: "5001120362" })
  assert.deepEqual(classifyUpload(reply(header(`ExecutionStatus="1"`, error("Nu aveti drept")))), { kind: "refused", errors: ["Nu aveti drept"] })
})

void test("an explicit 401/403 is the only upload answer that sends the submission back to the queue", () => {
  for (const status of [401, 403]) {
    const result = classifyUpload(reply("", status))
    assert.deepEqual(result, { kind: "auth_refused" })
    assert.equal(fiscalTransition("uploading", UPLOAD_EVENTS[result.kind]), "queued")
  }
})

void test("every other upload answer is ambiguous and makes the submission unknown", () => {
  const answers = [
    reply("", 429, "5"), reply("", 500), reply("", 502), reply("", 302), reply("", 400), reply("<html>busy</html>"), reply(""),
    reply(header(`ExecutionStatus="0"`)), reply(header(`ExecutionStatus="0" index_incarcare="abc"`)),
    reply(header(`ExecutionStatus="0" index_incarcare="1"`, error("x"))), reply(header(`ExecutionStatus="1"`)),
    reply(header(`ExecutionStatus="1" index_incarcare="1"`, error("x"))), reply(header(`ExecutionStatus="2" index_incarcare="1"`)),
    reply(`<other ExecutionStatus="0" index_incarcare="1"/>`), reply(header(`ExecutionStatus="0" index_incarcare="1"`), 201),
    reply(`<!DOCTYPE header [<!ENTITY x "1">]><header ExecutionStatus="0" index_incarcare="&x;"/>`),
  ]
  for (const answer of answers) {
    const result = classifyUpload(answer)
    assert.deepEqual(result, { kind: "ambiguous" }, `${String(answer.status)} ${answer.body}`)
    assert.equal(fiscalTransition("uploading", UPLOAD_EVENTS[result.kind]), "unknown")
  }
})

void test("stareMesaj: ok and nok decide with a download id, in prelucrare waits", () => {
  const status = (attributes: string, children = "") => classifyStatus(reply(header(attributes, children)))
  assert.deepEqual(status(`stare="ok" id_descarcare="3001293434"`), { kind: "accepted", downloadId: "3001293434" })
  assert.deepEqual(status(`stare="nok" id_descarcare="3001293435"`), { kind: "rejected", downloadId: "3001293435" })
  assert.deepEqual(status(`stare="in prelucrare"`), { kind: "pending" })
  assert.deepEqual(status(`stare="XML cu erori nepreluat de sistem" id_descarcare="7"`), { kind: "rejected", downloadId: "7" })
  assert.deepEqual(status(`stare="XML cu erori nepreluat de sistem"`), { kind: "refused", errors: ["XML cu erori nepreluat de sistem"] })
  assert.equal(statusEvent(status(`stare="ok" id_descarcare="1"`)), "processing_accepted")
  assert.equal(statusEvent(status(`stare="nok" id_descarcare="1"`)), "processing_rejected")
  assert.equal(statusEvent(status(`stare="XML cu erori nepreluat de sistem"`)), "processing_refused")
  assert.equal(statusEvent(status(`stare="in prelucrare"`)), undefined)
})

void test("stareMesaj: an error in HTTP 200, a throttle, a refused token or anything unknown decides nothing", () => {
  const noRight = classifyStatus(reply(header("", error("Nu aveti dreptul de inteorgare pentru id_incarcare= 1"))))
  assert.deepEqual(noRight, { kind: "anaf_error", errors: ["Nu aveti dreptul de inteorgare pentru id_incarcare= 1"] })
  assert.deepEqual(classifyStatus(reply("", 429, "12")), { kind: "rate_limited", retryAfterSeconds: 12 })
  assert.deepEqual(classifyStatus(reply("", 429, "Wed, 21 Oct 2026 07:28:00 GMT")), { kind: "rate_limited", retryAfterSeconds: 30 })
  assert.deepEqual(classifyStatus(reply("", 401)), { kind: "auth_refused" })
  for (const answer of [reply(header(`stare="ok"`)), reply(header(`stare="ok" id_descarcare="x1"`)), reply(header(`stare="nok"`)),
    reply(header(`stare="altceva" id_descarcare="1"`)), reply("", 500), reply("{}"), reply(`<header stare="ok" id_descarcare="1">`)]) {
    const result = classifyStatus(answer)
    assert.deepEqual(result, { kind: "unrecognized" }, answer.body)
    assert.equal(statusEvent(result), undefined)
  }
})

void test("ANAF's messages are kept as plain bounded text", () => {
  assert.deepEqual(sanitizedMessages(["  a\u0007b\n\tc  ", 4, null, "", "x".repeat(600)]), ["a b c", "x".repeat(500)])
  assert.equal(sanitizedMessages(Array.from({ length: 30 }, (_, index) => String(index))).length, 20)
})
