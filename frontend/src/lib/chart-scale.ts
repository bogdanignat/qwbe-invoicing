import { formatDecimal, formatRate, parseDecimal } from "./money.ts"

/**
 * The vertical scale of the revenue chart, as a pure function of the amounts.
 *
 * Everything is in minor units (bani) and integers: the domain and the ticks
 * are exact multiples of a round step (1, 2 or 5 × 10ⁿ bani), so the labels on
 * the axis are round amounts. The only approximation is the pixel geometry the
 * component draws with; the amounts themselves are shown exact, formatted from
 * the strings the backend wrote, in the bar titles and the accessible table.
 *
 * The domain always contains zero, so a negative month (a storno, a reversed
 * payment) hangs below the zero line instead of shifting it. A series that is
 * all zero has the single tick 0 and a unit domain, so every bar is flat on
 * the line rather than a division by zero.
 */
export interface ChartScale {
  /** Bottom of the domain, ≤ 0, in minor units. */
  readonly min: number
  /** Top of the domain, ≥ 0 and > min, in minor units. */
  readonly max: number
  /** Round values from min to max, in minor units. */
  readonly ticks: ReadonlyArray<number>
}

const TARGET_INTERVALS = 4

/**
 * `"-172.50"` → `-17250`. The decoder already refused anything else. The chart
 * draws with `number`, exact up to 2^53 bani (about 90 trillion lei); past that a
 * bar is off by a few bani of height, while every amount shown stays the string.
 */
export const minorUnits = (amount: string): number => {
  const parsed = parseDecimal(amount, 2)
  if (!parsed.ok) throw new SyntaxError(`invalid amount ${JSON.stringify(amount)}`)
  return Number(parsed.units)
}

/** The smallest of 1, 2, 5 × 10ⁿ that is at least `raw`, never below one minor unit. */
const roundStep = (raw: number): number => {
  if (raw <= 1) return 1
  let magnitude = 1
  while (magnitude * 10 < raw) magnitude *= 10
  const multiple = [1, 2, 5, 10].find((candidate) => candidate * magnitude >= raw) ?? 10
  return multiple * magnitude
}

export const chartScale = (amounts: ReadonlyArray<string>): ChartScale => {
  const values = amounts.map(minorUnits)
  const low = Math.min(0, ...values)
  const high = Math.max(0, ...values)
  if (low === high) return { min: 0, max: 1, ticks: [0] }
  const step = roundStep((high - low) / TARGET_INTERVALS)
  const min = Math.floor(low / step) * step
  const max = Math.ceil(high / step) * step
  const ticks = Array.from({ length: Math.round((max - min) / step) + 1 }, (_, index) => min + index * step)
  return { min, max, ticks }
}

/** Distance from the top of a plot `height` tall to `value` (minor units). */
export const scaleY = (scale: ChartScale, value: number, height: number): number =>
  ((scale.max - value) / (scale.max - scale.min)) * height

/** The bar from the zero line to `value`: above it when positive, below it when negative. */
export const barRect = (scale: ChartScale, value: number, height: number): { readonly y: number; readonly height: number } => {
  const zero = scaleY(scale, 0, height)
  const end = scaleY(scale, value, height)
  return { y: Math.min(zero, end), height: Math.abs(zero - end) }
}

/** An axis label: a round amount in the currency's major unit, without the currency or idle zeros (`1,000,000`, `0.5`). */
export const tickLabel = (value: number): string => formatRate(formatDecimal(BigInt(value), 2))
