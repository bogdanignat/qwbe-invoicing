import assert from "node:assert/strict"
import test from "node:test"

import { createOperationLifetime } from "./authoring-operation-lifetime.ts"

void test("a fresh lifetime is alive and its signal is usable before any effect runs", () => {
  const lifetime = createOperationLifetime()
  assert.equal(lifetime.isAlive(), true)
  assert.equal(lifetime.signal().aborted, false)
})

void test("a session boundary hands out a fresh signal and abandons the old one", () => {
  const lifetime = createOperationLifetime()
  const first = lifetime.beginRequests()
  const firstSignal = lifetime.signal()
  lifetime.endRequests(first)
  assert.equal(firstSignal.aborted, true)
  lifetime.beginRequests()
  const secondSignal = lifetime.signal()
  assert.notEqual(secondSignal, firstSignal)
  assert.equal(secondSignal.aborted, false)
})

void test("the cleanup of an old session never aborts the session that replaced it", () => {
  const lifetime = createOperationLifetime()
  const stale = lifetime.beginRequests()
  lifetime.beginRequests()
  const currentSignal = lifetime.signal()
  lifetime.endRequests(stale)
  assert.equal(currentSignal.aborted, false)
})

void test("a StrictMode remount leaves the screen alive with a fresh signal", () => {
  const lifetime = createOperationLifetime()
  lifetime.activate()
  const first = lifetime.beginRequests()
  const firstSignal = lifetime.signal()
  lifetime.deactivate()
  lifetime.endRequests(first)
  lifetime.activate()
  lifetime.beginRequests()
  assert.equal(lifetime.isAlive(), true)
  assert.equal(firstSignal.aborted, true)
  assert.equal(lifetime.signal().aborted, false)
})

void test("unmount ends the screen and the requests it still had in flight", () => {
  const lifetime = createOperationLifetime()
  lifetime.activate()
  lifetime.beginRequests()
  const signal = lifetime.signal()
  lifetime.deactivate()
  assert.equal(lifetime.isAlive(), false)
  assert.equal(signal.aborted, true)
})

void test("a session change does not end the mount: only the epoch checks decide ownership", () => {
  const lifetime = createOperationLifetime()
  lifetime.activate()
  const first = lifetime.beginRequests()
  lifetime.endRequests(first)
  lifetime.beginRequests()
  assert.equal(lifetime.isAlive(), true)
})

void test("activation is idempotent", () => {
  const lifetime = createOperationLifetime()
  lifetime.activate()
  lifetime.activate()
  assert.equal(lifetime.isAlive(), true)
})
