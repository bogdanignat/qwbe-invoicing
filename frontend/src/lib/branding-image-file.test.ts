import assert from "node:assert/strict"
import test from "node:test"

import { readBrandingImage, type ImageSize } from "./branding-image-file.ts"

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02])
const pngFile = (): File => new File([PNG_BYTES], "logo.png", { type: "image/png" })
const size = (value: ImageSize) => (): Promise<ImageSize> => Promise.resolve(value)

void test("reading a branding file — answers the draft the form sends, with the bytes as a data URL", async () => {
  const outcome = await readBrandingImage(pngFile(), size({ width: 120, height: 40 }))
  assert.equal(outcome.kind, "ready")
  assert.equal(outcome.draft.width, 120)
  assert.equal(outcome.draft.height, 40)
  assert.equal(outcome.draft.dataBase64, Buffer.from(PNG_BYTES).toString("base64"))
  assert.equal(outcome.draft.previewUrl, `data:image/png;base64,${outcome.draft.dataBase64}`)
})

void test("reading a branding file — refuses the file before its pixels are ever read", async () => {
  let read = false
  const outcome = await readBrandingImage(
    new File([PNG_BYTES], "logo.gif", { type: "image/gif" }),
    () => { read = true; return Promise.resolve({ width: 10, height: 10 }) },
  )
  assert.deepEqual(outcome, { kind: "issue", message: "Alege o imagine PNG sau JPEG." })
  assert.equal(read, false)
})

void test("reading a branding file — refuses a raster larger than the backend accepts", async () => {
  const outcome = await readBrandingImage(pngFile(), size({ width: 4000, height: 40 }))
  assert.deepEqual(outcome, {
    kind: "issue", message: "Imaginea poate avea maximum 2048 px pe axă și 4 megapixeli.",
  })
})

void test("reading a branding file — reports a file that cannot be decoded as an image", async () => {
  const outcome = await readBrandingImage(pngFile(), () =>
    Promise.reject(new Error("Fișierul nu poate fi decodat ca imagine.")))
  assert.deepEqual(outcome, { kind: "issue", message: "Fișierul nu poate fi decodat ca imagine." })
})
