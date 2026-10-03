import assert from "node:assert/strict"
import test from "node:test"

import {
  brandTextIssue, brandTextValue, brandingDimensionsIssue, brandingFileCheck,
  brandingFileInfoIssue, brandingImageSaveIssue, detectRasterMime,
  savedBrandText, savedBrandingImage,
} from "./issuer-branding.ts"

const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
const JPEG_HEADER = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])

void test("brand text — treats an empty field as no brand text", () => {
  assert.equal(brandTextValue("   "), null)
  assert.equal(brandTextValue("  Marca  "), "Marca")
  assert.equal(brandTextIssue("   "), undefined)
})

void test("brand text — refuses more than eighty code points and any control character", () => {
  assert.equal(brandTextIssue("ă".repeat(80)), undefined)
  assert.equal(brandTextIssue("ă".repeat(81)), "Textul de brand poate avea maximum 80 de caractere.")
  assert.equal(brandTextIssue("Marca\nSRL"), "Textul de brand nu poate conține caractere de control.")
})

void test("saved branding — reads the stored PNG as its own preview", () => {
  const draft = savedBrandingImage({ text: "Marca", image: { pngBase64: "AAA", width: 120, height: 40 } })
  assert.deepEqual(draft, { dataBase64: "AAA", previewUrl: "data:image/png;base64,AAA", width: 120, height: 40 })
  assert.equal(savedBrandText({ text: "Marca", image: null }), "Marca")
})

void test("saved branding — answers nothing for an issuer with no branding", () => {
  assert.equal(savedBrandingImage(null), null)
  assert.equal(savedBrandingImage({ text: "Marca", image: null }), null)
  assert.equal(savedBrandText(null), "")
  assert.equal(savedBrandText({ text: null, image: null }), "")
})

void test("branding file — detects the encoding from the signature", () => {
  assert.equal(detectRasterMime(PNG_HEADER), "image/png")
  assert.equal(detectRasterMime(JPEG_HEADER), "image/jpeg")
  assert.equal(detectRasterMime(new Uint8Array([0x89, 0x50])), null)
  assert.equal(detectRasterMime(new Uint8Array([0x47, 0x49, 0x46, 0x38])), null)
})

void test("branding file — refuses a type that is not raster and a file over 256 KiB", () => {
  assert.equal(brandingFileInfoIssue("image/svg+xml", 10), "Alege o imagine PNG sau JPEG.")
  assert.equal(brandingFileInfoIssue("image/png", 256 * 1024), undefined)
  assert.equal(brandingFileInfoIssue("image/png", 256 * 1024 + 1), "Imaginea poate avea maximum 256 KiB.")
})

void test("branding file — refuses bytes that contradict the declared type", () => {
  assert.deepEqual(brandingFileCheck("image/png", 9, PNG_HEADER), { kind: "ready", mime: "image/png" })
  assert.deepEqual(brandingFileCheck("image/png", 4, JPEG_HEADER), {
    kind: "issue", message: "Conținutul fișierului nu corespunde unei imagini PNG sau JPEG valide.",
  })
  assert.deepEqual(brandingFileCheck("image/jpeg", 300 * 1024, JPEG_HEADER), {
    kind: "issue", message: "Imaginea poate avea maximum 256 KiB.",
  })
})

void test("branding file — refuses dimensions outside the backend's own limits", () => {
  assert.equal(brandingDimensionsIssue(2048, 1953), undefined)
  assert.equal(brandingDimensionsIssue(2049, 10), "Imaginea poate avea maximum 2048 px pe axă și 4 megapixeli.")
  assert.equal(brandingDimensionsIssue(2048, 2048), "Imaginea poate avea maximum 2048 px pe axă și 4 megapixeli.")
  assert.equal(brandingDimensionsIssue(0, 10), "Imaginea poate avea maximum 2048 px pe axă și 4 megapixeli.")
  assert.equal(brandingDimensionsIssue(10.5, 10), "Imaginea poate avea maximum 2048 px pe axă și 4 megapixeli.")
})

void test("save issue — waits for a validation in flight and keeps a refusal", () => {
  assert.equal(brandingImageSaveIssue(true, undefined), "Așteaptă validarea imaginii înainte de salvare.")
  assert.equal(brandingImageSaveIssue(false, "Alege o imagine PNG sau JPEG."), "Alege o imagine PNG sau JPEG.")
  assert.equal(brandingImageSaveIssue(false, undefined), undefined)
})
