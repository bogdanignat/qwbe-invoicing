import assert from "node:assert/strict"
import test from "node:test"

import { beginBrandImageSelection, brandingDraftFromSaved, brandingImageSaveIssue, changeBrandImage, changeBrandText, createRevisionGuard, detectRasterMime, issuerBrandImageMaxBytes, normalizeBrandText, removeBrandImage, removeBranding, validateBrandingDimensions, validateBrandingFile } from "./issuer-branding.ts"

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])

void test("prevents silent saving while a logo is pending or rejected", () => {
  assert.equal(brandingImageSaveIssue(false, null), null)
  assert.equal(brandingImageSaveIssue(true, null), "Așteaptă validarea imaginii înainte de salvare.")
  const rejected = new Error("Imaginea poate avea maximum 256 KiB.")
  assert.equal(brandingImageSaveIssue(false, rejected), rejected.message)
  assert.equal(brandingImageSaveIssue(true, rejected), "Așteaptă validarea imaginii înainte de salvare.")
})

void test("allows only matching PNG and JPEG MIME and magic bytes within 256 KiB", () => {
  assert.equal(detectRasterMime(png), "image/png")
  assert.equal(detectRasterMime(jpeg), "image/jpeg")
  assert.equal(validateBrandingFile("image/png", png.length, png), "image/png")
  assert.equal(validateBrandingFile("image/jpeg", jpeg.length, jpeg), "image/jpeg")
  assert.throws(() => validateBrandingFile("image/svg+xml", png.length, png), /PNG sau JPEG/)
  assert.throws(() => validateBrandingFile("image/png", jpeg.length, jpeg), /nu corespunde/)
  assert.throws(() => validateBrandingFile("image/png", issuerBrandImageMaxBytes + 1, png), /256 KiB/)
  assert.throws(() => validateBrandingFile("image/png", 4, new Uint8Array([1, 2, 3, 4])), /nu corespunde/)
})

void test("validates decoded raster dimensions", () => {
  assert.doesNotThrow(() => { validateBrandingDimensions(2048, 1000) })
  assert.throws(() => { validateBrandingDimensions(2049, 10) }, /2048 px/)
  assert.throws(() => { validateBrandingDimensions(2001, 2000) }, /4 megapixeli/)
  assert.throws(() => { validateBrandingDimensions(0, 10) }, /2048 px/)
})

void test("normalizes optional brand text by Unicode code points and rejects controls", () => {
  assert.equal(normalizeBrandText("  QWBE  "), "QWBE")
  assert.equal(normalizeBrandText("   "), null)
  assert.equal(normalizeBrandText("😀".repeat(80)), "😀".repeat(80))
  assert.throws(() => normalizeBrandText("😀".repeat(81)), /maximum 80/)
  assert.throws(() => normalizeBrandText("QWBE\u0000"), /control/)
})

void test("invalidates stale file selections, saves, removes, and resets", () => {
  const guard = createRevisionGuard()
  const first = guard.begin()
  const second = guard.begin()
  assert.equal(guard.isCurrent(first), false)
  assert.equal(guard.isCurrent(second), true)
  guard.invalidate()
  assert.equal(guard.isCurrent(second), false)
  const saved = brandingDraftFromSaved({ text: "QWBE", image: { pngBase64: "png", width: 120, height: 40 } })
  const selected = changeBrandImage(changeBrandText(saved, "Nou"), { dataBase64: "jpeg", previewUrl: "data:image/jpeg;base64,jpeg", width: 80, height: 50 })
  assert.deepEqual(removeBrandImage(selected), { text: "Nou", image: null })
  assert.deepEqual(removeBranding(), { text: "", image: null })
})

void test("keeps a new image selection when an older save succeeds before image decoding", () => {
  const files = createRevisionGuard()
  const edits = createRevisionGuard()
  const saveRevision = edits.current()
  const selection = beginBrandImageSelection(files, edits)
  // The same onSuccess decision used by the settings hook.
  if (edits.isCurrent(saveRevision)) files.invalidate()
  assert.equal(edits.isCurrent(saveRevision), false)
  assert.equal(files.isCurrent(selection), true, "decode success must still apply the selected image")
})
