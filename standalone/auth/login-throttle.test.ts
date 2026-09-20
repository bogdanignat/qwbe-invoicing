import assert from "node:assert/strict"
import test from "node:test"

import { createLoginThrottle, loginPeerKey, type SecurityEvent } from "./login-throttle.ts"

const fixture = () => {
  let at = 1_800_000_000_000
  const events: SecurityEvent[] = []
  const throttle = createLoginThrottle({ now: () => at, monotonicNow: () => at, logger: (event) => { events.push(event) } })
  return { throttle, events, advance: (milliseconds: number) => { at += milliseconds } }
}

void test("five failures precede a bounded progressive cooldown; blocked requests do not extend it", () => {
  const { throttle, advance, events } = fixture()
  const peer = loginPeerKey("127.0.0.1")
  for (let index = 0; index < 5; index += 1) {
    throttle.failed(peer)
    assert.equal(throttle.check(peer), 0)
  }
  for (const seconds of [1, 2, 4, 8, 16, 30, 30]) {
    throttle.failed(peer)
    assert.equal(throttle.check(peer), seconds)
    const count = events.length
    for (let index = 0; index < 100; index += 1) assert.equal(throttle.check(peer), seconds)
    assert.equal(events.length, count)
    advance(seconds * 1_000 - 1)
    assert.equal(throttle.check(peer), 1)
    advance(1)
    assert.equal(throttle.check(peer), 0)
  }
  assert.ok(events.every((event) => event.failure_count <= 11 && event.retry_after_seconds <= 30))
})

void test("success and inactive TTL reset failure history while other peers remain independent", () => {
  const { throttle, advance } = fixture()
  for (let index = 0; index < 6; index += 1) throttle.failed("peer:a")
  assert.equal(throttle.check("peer:a"), 1)
  assert.equal(throttle.check("peer:b"), 0)
  throttle.succeeded("peer:a")
  throttle.failed("peer:a")
  assert.equal(throttle.check("peer:a"), 0)
  for (let index = 0; index < 5; index += 1) throttle.failed("peer:a")
  assert.equal(throttle.check("peer:a"), 1)
  advance(15 * 60 * 1_000)
  throttle.failed("peer:a")
  assert.equal(throttle.check("peer:a"), 0)
})

void test("the 10000-peer cap evicts the LRU key without evicting recently checked peers", () => {
  const { throttle } = fixture()
  for (let index = 0; index < 6; index += 1) throttle.failed("peer:oldest")
  for (let index = 0; index < 6; index += 1) throttle.failed("peer:hot")
  for (let index = 0; index < 9_998; index += 1) throttle.failed(`peer:${String(index)}`)
  assert.equal(throttle.check("peer:hot"), 1)
  throttle.failed("peer:new")
  assert.equal(throttle.check("peer:oldest"), 0)
  assert.equal(throttle.check("peer:hot"), 1)
})

void test("peer normalization canonicalizes IPv4, IPv6 and mapped IPv4 without using arbitrary text", () => {
  assert.equal(loginPeerKey("::ffff:127.0.0.1"), loginPeerKey("127.0.0.1"))
  assert.equal(loginPeerKey("0:0:0:0:0:FFFF:7F00:0001"), loginPeerKey("127.0.0.1"))
  assert.equal(loginPeerKey("2001:0DB8:0000:0000:0000:0000:0000:0001"), "peer:2001:db8::1")
  assert.equal(loginPeerKey("fe80::1%eth0"), "peer:fe80::1")
  assert.equal(loginPeerKey(undefined), "peer:unknown")
  assert.equal(loginPeerKey("\nsecret-canary"), "peer:unknown")
})

void test("telemetry only includes controlled fields and a digest, never a raw peer", () => {
  const { throttle, events } = fixture()
  const peer = loginPeerKey("203.0.113.99")
  for (let index = 0; index < 6; index += 1) throttle.failed(peer)
  throttle.check(peer)
  assert.equal(events.length, 7)
  assert.equal(events[5]?.reason, "invalid_credentials")
  assert.equal(events[6]?.reason, "cooldown")
  assert.ok(events.every((event) => /^[a-f0-9]{24}$/.test(event.client_key)))
  assert.ok(!JSON.stringify(events).includes("203.0.113.99"))
})

void test("a broken security logger cannot change throttle behavior", () => {
  const throttle = createLoginThrottle({ monotonicNow: () => 100, logger: () => { throw new Error("broken sink") } })
  for (let index = 0; index < 6; index += 1) assert.doesNotThrow(() => { throttle.failed("peer:a") })
  assert.equal(throttle.check("peer:a"), 1)
  throttle.succeeded("peer:a")
  assert.equal(throttle.check("peer:a"), 0)
})

void test("wall-clock rollback cannot extend a cooldown or its inactive lifetime", () => {
  let wallTime = 100_000
  let elapsed = 100_000
  const throttle = createLoginThrottle({
    now: () => wallTime,
    monotonicNow: () => elapsed,
    logger: () => undefined,
  })
  for (let index = 0; index < 6; index += 1) throttle.failed("peer:a")
  wallTime = 0
  elapsed += 1_000
  assert.equal(throttle.check("peer:a"), 0)
  elapsed += 15 * 60 * 1_000
  throttle.failed("peer:a")
  assert.equal(throttle.check("peer:a"), 0)
})
