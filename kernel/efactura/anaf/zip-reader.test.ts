import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { readReceivedUbl } from "../../../cubes/invoicing/efactura/received/index.ts"
import { RECEIVED_ZIP_LIMITS, readReceivedZip, type ZipRefusal } from "./zip-reader.ts"
import { buildZip, centralOffset, centralRecord, endOffset, endRecord, localRecord, type ZipFile } from "./zip.test-support.ts"

const FIXTURE = readFileSync(new URL("../../../cubes/invoicing/efactura/fixtures/anaf-test-received-invoice.zip", import.meta.url))
const INVOICE = `<?xml version="1.0" encoding="UTF-8"?><Invoice/>`
const SIGNATURE = `<?xml version="1.0"?><Signature/>`
const ANAF_PAIR: ReadonlyArray<ZipFile> = [{ name: "semnatura_1.xml", content: SIGNATURE }, { name: "1.xml", content: INVOICE }]
const MB = 1024 * 1024

const text = (bytes: Uint8Array | undefined): string | undefined => bytes === undefined ? undefined : new TextDecoder().decode(bytes)

const refusal = (zip: Uint8Array): ZipRefusal | "accepted" => {
  const result = readReceivedZip(zip)
  return result.ok ? "accepted" : result.refusal
}

const patched = (zip: Buffer, patch: (copy: Buffer) => void): Buffer => {
  const copy = Buffer.from(zip)
  patch(copy)
  return copy
}

void test("reads ANAF's real archive: the invoice XML, and its signature apart", () => {
  const result = readReceivedZip(FIXTURE)
  assert.ok(result.ok)
  const invoice = text(result.invoice) ?? ""
  assert.ok(invoice.startsWith(`<?xml version="1.0" encoding="UTF-8"?>\n<Invoice `))
  assert.ok(invoice.includes("<cbc:ID>TEST 19</cbc:ID>"))
  assert.ok(text(result.signature)?.includes("http://www.w3.org/2000/09/xmldsig#"))
  assert.ok(!text(result.signature)?.includes("<Invoice"))
})

void test("the real archive's invoice reads as UBL, for the CIF it was fetched for, without warnings", () => {
  const zip = readReceivedZip(FIXTURE)
  assert.ok(zip.ok)
  const read = readReceivedUbl(new TextDecoder("utf-8", { fatal: true }).decode(zip.invoice), "RO19999927")
  assert.ok(read.ok, JSON.stringify(read))
  const { document, warnings } = read
  assert.deepEqual(warnings, [])
  assert.deepEqual([document.kind, document.typeCode, document.number, document.issueDate, document.dueDate, document.currency],
    ["invoice", "380", "TEST 19", "2026-10-23", "2026-11-06", "RON"])
  assert.deepEqual(document.supplier, {
    name: "FURNIZOR TEST S.R.L.", taxRegistrationId: "19999927", registrationId: "J2020000999999",
    address: { street: "Str. \u015etefan cel Mare nr. 1", city: "Mun. Boto\u015fani", county: "RO-BT", country: "RO" },
  })
  assert.equal(document.buyer.registrationId, "19999927")
  assert.deepEqual(document.vat.breakdown, [{
    category: "O", taxable: { value: "10.00", currency: "RON" }, tax: { value: "0.00", currency: "RON" }, exemptionCode: "VATEX-EU-O",
  }])
  assert.deepEqual(document.lines.map((line) => [line.name, line.quantity, line.netAmount.value, line.vatCategory]),
    [["Proba facturi primite", { value: "1.0000", unit: "HUR" }, "10.00", "O"]])
  assert.equal(document.totals.payable.value, "10.00")
})

void test("reads an archive written in ANAF's layout, a stored one without descriptor, and one without signature", () => {
  const anaf = readReceivedZip(buildZip(ANAF_PAIR))
  assert.ok(anaf.ok)
  assert.deepEqual([text(anaf.invoice), text(anaf.signature)], [INVOICE, SIGNATURE])
  const stored = readReceivedZip(buildZip([{ name: "1.xml", content: INVOICE, method: 0, flags: 0x0800 }, { name: "readme.txt", content: "x" }]))
  assert.ok(stored.ok)
  assert.deepEqual([text(stored.invoice), stored.signature], [INVOICE, undefined])
})

void test("a compression bomb is refused, whether its size is declared or hidden", () => {
  const zeros = new Uint8Array(20 * MB)
  assert.equal(refusal(buildZip([{ name: "1.xml", content: zeros }])), "too_large")
  assert.equal(refusal(buildZip([{ name: "1.xml", content: zeros, size: 1_000 }])), "size_mismatch")
  const seven = new Uint8Array(7 * MB)
  assert.equal(refusal(buildZip([{ name: "1.xml", content: seven }, { name: "2.txt", content: seven }])), "too_large")
})

void test("the limits hold for stored entries and for the archive itself", () => {
  assert.equal(refusal(buildZip([{ name: "1.xml", content: new Uint8Array(RECEIVED_ZIP_LIMITS.maxFileBytes + 1), method: 0 }])), "too_large")
  assert.equal(refusal(buildZip([{ name: "1.xml", content: new Uint8Array(RECEIVED_ZIP_LIMITS.maxFileBytes), method: 0 }])), "accepted")
  assert.equal(refusal(new Uint8Array(RECEIVED_ZIP_LIMITS.maxZipBytes + 1)), "too_large")
  assert.equal(refusal(buildZip([{ name: "1.xml", content: INVOICE, method: 0, size: 10 }])), "size_mismatch")
})

void test("a wrong CRC or a deflate stream that does not inflate is refused", () => {
  assert.equal(refusal(buildZip([{ name: "1.xml", content: INVOICE, crc: 1234 }])), "crc")
  const broken = patched(buildZip([{ name: "1.xml", content: INVOICE }]), (zip) => { zip.fill(0xff, 35, 40) })
  assert.ok(["corrupt", "crc", "size_mismatch"].includes(refusal(broken)))
})

void test("the local header must repeat the central directory's name, method and flags", () => {
  assert.equal(refusal(buildZip([{ name: "1.xml", content: INVOICE, localName: "2.xml" }])), "header_mismatch")
  const zip = buildZip(ANAF_PAIR)
  assert.equal(refusal(patched(zip, (copy) => copy.writeUInt16LE(0x0008, 6))), "header_mismatch")
  assert.equal(refusal(patched(zip, (copy) => copy.writeUInt16LE(0, 8))), "header_mismatch")
  assert.equal(refusal(patched(zip, (copy) => copy.writeUInt32LE(0, 0))), "header_mismatch")
})

void test("the data descriptor must repeat the central directory's CRC and sizes; its signature is optional", () => {
  const zip = buildZip([{ name: "1.xml", content: INVOICE }])
  const descriptor = 30 + "1.xml".length + zip.readUInt32LE(centralOffset(zip, 0) + 20)
  assert.equal(zip.readUInt32LE(descriptor), 0x08074b50)
  assert.equal(refusal(patched(zip, (copy) => copy.writeUInt32LE(1234, descriptor + 4))), "header_mismatch")
  assert.equal(refusal(patched(zip, (copy) => copy.writeUInt32LE(INVOICE.length + 1, descriptor + 12))), "header_mismatch")
  const unsigned = readReceivedZip(buildZip([{ name: "semnatura_1.xml", content: SIGNATURE, signedDescriptor: false },
    { name: "1.xml", content: INVOICE, signedDescriptor: false }]))
  assert.ok(unsigned.ok)
  assert.deepEqual([text(unsigned.invoice), text(unsigned.signature)], [INVOICE, SIGNATURE])
})

void test("encryption, other methods, ZIP64 and several disks are refused", () => {
  assert.equal(refusal(buildZip([{ name: "1.xml", content: INVOICE, flags: 0x0809 }])), "encrypted")
  assert.equal(refusal(buildZip([{ name: "1.xml", content: INVOICE, method: 12 }])), "method")
  const zip = buildZip(ANAF_PAIR)
  assert.equal(refusal(patched(zip, (copy) => copy.writeUInt32LE(0xffffffff, centralOffset(copy, 1) + 20))), "zip64")
  assert.equal(refusal(patched(zip, (copy) => copy.writeUInt32LE(0xffffffff, centralOffset(copy, 0) + 42))), "zip64")
  assert.equal(refusal(patched(zip, (copy) => copy.writeUInt16LE(0xffff, endOffset(copy) + 10))), "zip64")
  const locator = Buffer.alloc(20)
  locator.writeUInt32LE(0x07064b50, 0)
  assert.equal(refusal(Buffer.concat([zip.subarray(0, endOffset(zip)), locator, zip.subarray(endOffset(zip))])), "zip64")
  assert.equal(refusal(patched(zip, (copy) => copy.writeUInt16LE(1, endOffset(copy) + 4))), "multidisk")
  assert.equal(refusal(patched(zip, (copy) => copy.writeUInt16LE(1, centralOffset(copy, 0) + 34))), "multidisk")
})

void test("more than four entries, duplicate names and names that are not UTF-8 are refused", () => {
  const five = ["a", "b", "c", "d", "e"].map((name) => ({ name: `${name}.txt`, content: name }))
  assert.equal(refusal(buildZip([...ANAF_PAIR, ...five.slice(0, 2)])), "accepted")
  assert.equal(refusal(buildZip([...ANAF_PAIR, ...five.slice(0, 3)])), "too_many_entries")
  assert.equal(refusal(buildZip([...ANAF_PAIR, { name: "1.xml", content: INVOICE }])), "duplicate_name")
  assert.equal(refusal(buildZip([{ name: "factură.xml", content: INVOICE, flags: 0x0008 }])), "name")
})

void test("the invoice XML must be exactly one: two invoices, two signatures or none are refused", () => {
  assert.equal(refusal(buildZip([...ANAF_PAIR, { name: "2.xml", content: INVOICE }])), "ambiguous")
  assert.equal(refusal(buildZip([...ANAF_PAIR, { name: "semnatura_2.xml", content: SIGNATURE }])), "ambiguous")
  assert.equal(refusal(buildZip([{ name: "semnatura_1.xml", content: SIGNATURE }, { name: "1.txt", content: INVOICE }])), "no_invoice")
  assert.equal(refusal(buildZip([])), "no_invoice")
})

void test("a truncated archive, offsets outside the buffer and overlapping entries are refused", () => {
  const zip = buildZip(ANAF_PAIR)
  assert.equal(refusal(zip.subarray(0, zip.length - 10)), "truncated")
  assert.equal(refusal(zip.subarray(0, 100)), "truncated")
  assert.equal(refusal(new Uint8Array()), "truncated")
  assert.equal(refusal(patched(zip, (copy) => copy.writeUInt32LE(copy.length + 100, centralOffset(copy, 1) + 42))), "out_of_bounds")
  assert.equal(refusal(patched(zip, (copy) => copy.writeUInt32LE(copy.length, endOffset(copy) + 16))), "out_of_bounds")
  assert.equal(refusal(patched(zip, (copy) => copy.writeUInt32LE(99_999, centralOffset(copy, 0) + 20))), "out_of_bounds")

  const inner: ZipFile = { name: "b.xml", content: INVOICE }
  const outer: ZipFile = { name: "a.txt", content: localRecord(inner), method: 0 }
  const local = localRecord(outer)
  const directory = Buffer.concat([centralRecord(outer, 0), centralRecord(inner, 30 + outer.name.length)])
  assert.equal(refusal(Buffer.concat([local, directory, endRecord(2, directory.length, local.length)])), "overlap")
})
