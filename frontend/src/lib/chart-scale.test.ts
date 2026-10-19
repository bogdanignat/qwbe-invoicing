import assert from "node:assert/strict"
import test from "node:test"

import { barRect, chartScale, minorUnits, scaleY, tickLabel } from "./chart-scale.ts"

const isRound = (value: number, step: number): boolean => value % step === 0

void test("amounts become exact minor units, sign included", () => {
  assert.equal(minorUnits("0.00"), 0)
  assert.equal(minorUnits("1234.56"), 123456)
  assert.equal(minorUnits("-172.00"), -17200)
  assert.equal(minorUnits("-0.05"), -5)
  assert.ok(Object.is(minorUnits("-0.00"), 0))
})

void test("a positive series starts at zero and ends on a round tick above the maximum", () => {
  const scale = chartScale(["242.00", "363.00", "60.50", "0.00"])
  assert.equal(scale.min, 0)
  assert.equal(scale.max, 40000)
  assert.deepEqual(scale.ticks, [0, 10000, 20000, 30000, 40000])
  assert.deepEqual(scale.ticks.map(tickLabel), ["0", "100", "200", "300", "400"])
})

void test("a series that is all zero has one tick and flat bars on the line", () => {
  const scale = chartScale(["0.00", "0.00"])
  assert.deepEqual(scale, { min: 0, max: 1, ticks: [0] })
  assert.deepEqual(barRect(scale, 0, 200), { y: 200, height: 0 })
  assert.deepEqual(chartScale([]), { min: 0, max: 1, ticks: [0] })
})

void test("an all-negative series hangs from zero at the top", () => {
  const scale = chartScale(["-121.00", "-30.00"])
  assert.equal(scale.max, 0)
  assert.ok(scale.min <= -12100)
  assert.equal(scaleY(scale, 0, 200), 0)
  const bar = barRect(scale, -12100, 200)
  assert.equal(bar.y, 0)
  assert.ok(bar.height > 0 && bar.height <= 200)
})

void test("a mixed series keeps zero inside the domain: positive bars above it, negative below", () => {
  const scale = chartScale(["342.00", "-172.00", "50.00"])
  assert.ok(scale.min < 0 && scale.max > 0)
  assert.ok(scale.ticks.includes(0))
  const step = (scale.ticks[1] ?? 0) - (scale.ticks[0] ?? 0)
  assert.ok(scale.ticks.every((tick) => isRound(tick, step)))
  assert.ok(scale.min <= -17200 && scale.max >= 34200)
  const zero = scaleY(scale, 0, 200)
  const up = barRect(scale, 34200, 200)
  const down = barRect(scale, -17200, 200)
  assert.ok(Math.abs(up.y + up.height - zero) < 1e-9)
  assert.equal(down.y, zero)
  assert.ok(up.height > down.height)
})

void test("ticks are 1, 2 or 5 × 10ⁿ apart and labelled in whole units with Romanian grouping", () => {
  const steps = [["7.00"], ["99.99"], ["1234.00"], ["98765.43"], ["0.03"]].map((amounts) => {
    const scale = chartScale(amounts)
    return (scale.ticks[1] ?? 0) - (scale.ticks[0] ?? 0)
  })
  for (const step of steps) assert.match(String(step), /^[125]0*$/u)
  assert.equal(tickLabel(100000000), "1.000.000")
  assert.equal(tickLabel(-150000), "-1.500")
})
