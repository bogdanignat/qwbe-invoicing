import assert from "node:assert/strict"
import test from "node:test"

import {
  maximumRequestBodyBytes,
  readBoundedRequestBody,
  RequestBodyAborted,
  RequestBodyTimeout,
  RequestBodyTooLarge,
} from "./proxy-body.ts"

void test("body reader preserves absent bodies and enforces the byte limit while streaming", async () => {
  assert.equal(await readBoundedRequestBody(new Request("https://example.test")), undefined)
  const exact = new Uint8Array(maximumRequestBodyBytes)
  assert.equal((await readBoundedRequestBody(new Request("https://example.test", { method: "POST", body: exact })))?.byteLength,
    maximumRequestBodyBytes)
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(maximumRequestBodyBytes))
      controller.enqueue(new Uint8Array(1))
      controller.close()
    },
  })
  await assert.rejects(readBoundedRequestBody(new Request("https://example.test", {
    method: "POST", body: stream, duplex: "half",
  } as RequestInit & { duplex: "half" })), RequestBodyTooLarge)
})

void test("body reader deadlines and request aborts cancel stalled streams", async () => {
  let timeoutCancelled = 0
  const stalled = new ReadableStream<Uint8Array>({ cancel() { timeoutCancelled += 1 } })
  await assert.rejects(readBoundedRequestBody(new Request("https://example.test", {
    method: "POST", body: stalled, duplex: "half",
  } as RequestInit & { duplex: "half" }), Date.now() + 10), RequestBodyTimeout)
  assert.equal(timeoutCancelled, 1)

  let abortCancelled = 0
  const controller = new AbortController()
  const aborted = readBoundedRequestBody(new Request("https://example.test", {
    method: "POST", body: new ReadableStream<Uint8Array>({ cancel() { abortCancelled += 1 } }),
    duplex: "half", signal: controller.signal,
  } as RequestInit & { duplex: "half" }), Date.now() + 1_000)
  controller.abort()
  await assert.rejects(aborted, RequestBodyAborted)
  assert.equal(abortCancelled, 1)
})
