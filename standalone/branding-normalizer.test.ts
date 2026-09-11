import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"
import sharp from "sharp"

import { brandingNormalizer } from "./branding-normalizer.ts"

const raster = (width = 64, height = 32) => sharp({
  create: { width, height, channels: 4, background: { r: 20, g: 90, b: 140, alpha: 0.5 } },
})

const rejects = async (bytes: Uint8Array): Promise<void> => {
  const result = await Effect.runPromise(Effect.either(brandingNormalizer.normalize(bytes)))
  assert.equal(result._tag, "Left")
  assert.equal(result.left._tag, "ValidationFailure")
}

void test("normalizes PNG and JPEG to deterministic metadata-free PNG, preserving dimensions and transparency", async () => {
  for (const input of [await raster().png().toBuffer(), await raster().jpeg().toBuffer()]) {
    const first = await Effect.runPromise(brandingNormalizer.normalize(input))
    const second = await Effect.runPromise(brandingNormalizer.normalize(input))
    assert.deepEqual(first, second)
    assert.equal(first.width, 64)
    assert.equal(first.height, 32)
    const bytes = Buffer.from(first.pngBase64, "base64")
    const metadata = await sharp(bytes).metadata()
    assert.equal(metadata.format, "png")
    assert.equal(metadata.space, "srgb")
    assert.equal(metadata.exif, undefined)
    assert.equal(metadata.icc, undefined)
    assert.ok(bytes.length <= 256 * 1024)
    assert.deepEqual(await Effect.runPromise(brandingNormalizer.normalize(bytes)), first)
  }
  const image = await Effect.runPromise(brandingNormalizer.normalize(await raster().png().toBuffer()))
  assert.equal((await sharp(Buffer.from(image.pngBase64, "base64")).metadata()).hasAlpha, true)
})

void test("normalizes JPEG EXIF orientation before storing and strips the metadata", async () => {
  const input = await raster(80, 20).jpeg().withMetadata({ orientation: 6 }).toBuffer()
  const result = await Effect.runPromise(brandingNormalizer.normalize(input))
  assert.equal(result.width, 20)
  assert.equal(result.height, 80)
  const metadata = await sharp(Buffer.from(result.pngBase64, "base64")).metadata()
  assert.equal(metadata.orientation, undefined)
  assert.equal(metadata.exif, undefined)
})

void test("rejects SVG, GIF, WebP and arbitrary content regardless of caller MIME or filename", async () => {
  await rejects(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>'))
  await rejects(await raster().gif().toBuffer())
  await rejects(await raster().webp().toBuffer())
  await rejects(Buffer.from("not a raster"))
  await rejects(Buffer.from([0xff, 0xd8, 0xff, 0, 1, 2, 3]))
})

void test("rejects APNG framing, truncated PNG/JPEG and corrupted PNG pixels", async () => {
  const png = await raster().png().toBuffer()
  const animation = Buffer.alloc(20)
  animation.writeUInt32BE(8, 0)
  animation.write("acTL", 4, "ascii")
  animation.writeUInt32BE(2, 8)
  await rejects(Buffer.concat([png.subarray(0, 33), animation, png.subarray(33)]))
  await rejects(png.subarray(0, png.length - 6))
  const jpeg = await raster().jpeg().toBuffer()
  await rejects(jpeg.subarray(0, Math.floor(jpeg.length / 2)))
  const corrupt = Buffer.from(png)
  const dataOffset = corrupt.indexOf("IDAT") + 4
  assert.ok(dataOffset > 4)
  corrupt[dataOffset] = (corrupt[dataOffset] ?? 0) ^ 0xff
  await rejects(corrupt)
})

void test("enforces byte, per-axis and decoded pixel limits, without minimum size or aspect restrictions", async () => {
  await rejects(new Uint8Array(256 * 1024 + 1))
  await rejects(await raster(2049, 1).png().toBuffer())
  await rejects(await raster(2001, 2000).png().toBuffer())
  for (const [width, height] of [[1, 1], [2048, 1], [1, 2048]] as const) {
    const result = await Effect.runPromise(brandingNormalizer.normalize(await raster(width, height).png().toBuffer()))
    assert.equal(result.width, width)
    assert.equal(result.height, height)
  }
})

void test("rejects a small JPEG whose canonical PNG would exceed the storage bound", async () => {
  const pixels = Buffer.alloc(400 * 400 * 3)
  let seed = 173
  for (let index = 0; index < pixels.length; index++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    pixels[index] = seed >>> 24
  }
  const jpeg = await sharp(pixels, { raw: { width: 400, height: 400, channels: 3 } }).jpeg({ quality: 80 }).toBuffer()
  assert.ok(jpeg.length < 256 * 1024)
  await rejects(jpeg)
})
