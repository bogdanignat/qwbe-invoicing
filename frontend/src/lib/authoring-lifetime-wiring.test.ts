import assert from "node:assert/strict"
import test from "node:test"

import { createOperationLifetime } from "./authoring-operation-lifetime.ts"
import { lifetimeMountEffect, lifetimeRequestsEffect } from "./authoring-lifetime-wiring.ts"

/**
 * The effect bodies the authoring hooks run, played by hand: mount, cleanup and
 * mount again, in the order React would. The point is the generation capture —
 * a cleanup belonging to a session that has already been replaced must not
 * abort the session that replaced it.
 */

void test("a mount keeps the screen alive and its cleanup ends it", () => {
  const lifetime = createOperationLifetime()
  const cleanup = lifetimeMountEffect(lifetime)
  assert.equal(lifetime.isAlive(), true)
  cleanup()
  assert.equal(lifetime.isAlive(), false)
})

void test("a session cleanup aborts the requests of that session", () => {
  const lifetime = createOperationLifetime()
  const cleanup = lifetimeRequestsEffect(lifetime)
  const signal = lifetime.signal()
  assert.equal(signal.aborted, false)
  cleanup()
  assert.equal(signal.aborted, true)
})

void test("the StrictMode rehearsal leaves the screen alive with a usable signal", () => {
  const lifetime = createOperationLifetime()
  const firstMount = lifetimeMountEffect(lifetime)
  const firstRequests = lifetimeRequestsEffect(lifetime)
  firstRequests()
  firstMount()
  lifetimeMountEffect(lifetime)
  lifetimeRequestsEffect(lifetime)
  assert.equal(lifetime.isAlive(), true)
  assert.equal(lifetime.signal().aborted, false)
})

void test("a stale session cleanup never aborts the session that replaced it", () => {
  const lifetime = createOperationLifetime()
  const stale = lifetimeRequestsEffect(lifetime)
  lifetimeRequestsEffect(lifetime)
  const current = lifetime.signal()
  stale()
  assert.equal(current.aborted, false)
})
