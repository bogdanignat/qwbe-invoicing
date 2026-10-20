import assert from "node:assert/strict"
import test from "node:test"

import { callbackCode, callbackNotice, withoutCallbackCode } from "./efactura-callback.ts"

// The codes of `cubes/invoicing/efactura/connection/domain/callback.ts`.
const CODES = [
  "conectat", "neconfigurat", "tentativa_lipsa", "tentativa_expirata", "tentativa_folosita", "refuzat_anaf",
  "cod_lipsa", "schimb_esuat", "fara_drept_cif", "verificare_esuata", "conexiune_schimbata", "eroare",
]

void test("every callback code has its own Romanian sentence; only `conectat` is a success", () => {
  const notices = CODES.map(callbackNotice)
  assert.deepEqual(notices.map((notice) => notice.tone), ["success", ...CODES.slice(1).map(() => "warning")])
  assert.equal(new Set(notices.map((notice) => notice.message)).size, CODES.length)
  for (const notice of notices) assert.doesNotMatch(notice.message, /_/u)
})

void test("the two outcomes Bogdan named read as he named them", () => {
  assert.match(callbackNotice("fara_drept_cif").message, /^Certificatul nu are drept SPV pe CIF-ul firmei/u)
  assert.match(callbackNotice("tentativa_expirata").message, /^Conectarea a expirat, reîncearcă/u)
})

void test("an unknown code, or one named after an object property, is a plain failure, never echoed", () => {
  for (const code of ["altceva", "constructor", "__proto__", "<script>"]) {
    const notice = callbackNotice(code)
    assert.equal(notice.tone, "warning")
    assert.equal(notice.message, "Conectarea la ANAF nu a reușit. Reîncearcă.")
  }
})

void test("the code is read from the address and dropped from it, the other pairs kept", () => {
  assert.equal(callbackCode("?anaf=fara_drept_cif"), "fara_drept_cif")
  assert.equal(callbackCode("?x=1"), undefined)
  assert.equal(withoutCallbackCode("?anaf=conectat"), "")
  assert.equal(withoutCallbackCode("?x=1&anaf=conectat&y=2"), "?x=1&y=2")
})
