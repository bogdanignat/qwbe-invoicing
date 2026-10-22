import assert from "node:assert/strict"
import test from "node:test"

import { addressCountyName } from "../index.ts"

void test("an address names its county only when the city does not already", () => {
  assert.equal(addressCountyName("București", "RO-B"), undefined)
  assert.equal(addressCountyName("BUCURESTI", "RO-B"), undefined, "case and diacritics do not count")
  assert.equal(addressCountyName("Botoșani", "RO-BT"), undefined)
  assert.equal(addressCountyName("Bistrița Năsăud", "RO-BN"), undefined, "a space reads as the hyphen")
  assert.equal(addressCountyName("Satu  Mare", "RO-SM"), undefined, "spaces inside do not count")
  assert.equal(addressCountyName("Suceava", "RO-SV"), undefined)
  assert.equal(addressCountyName("Cluj-Napoca", "RO-CJ"), "Cluj")
  assert.equal(addressCountyName("Dorohoi", "RO-BT"), "Botoșani")
  assert.equal(addressCountyName("București", "RO-XX"), undefined, "an unknown code has no name")
})
