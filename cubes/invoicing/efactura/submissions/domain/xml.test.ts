import assert from "node:assert/strict"
import test from "node:test"

import { childrenNamed, localName, parseStrictXml, type XmlLimits, type XmlRefusal } from "./xml.ts"

const refusal = (source: string, limits?: XmlLimits): XmlRefusal | undefined => {
  const parsed = parseStrictXml(source, limits)
  return parsed.ok ? undefined : parsed.refusal
}

const UPLOAD = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<header xmlns="mfp:anaf:dgti:spv:respUploadFisier:v1" dateResponse="202610191200" ExecutionStatus="1">
  <Errors errorMessage="Fisierul transmis nu este valid. &quot;cbc:ID&quot; lipseste &amp; altele &#x219;i &#537;"/>
  <Errors errorMessage='second'/>
</header>`

void test("reads ANAF's header: attributes, children, entities and character references", () => {
  const parsed = parseStrictXml(UPLOAD)
  assert.ok(parsed.ok)
  const { root } = parsed
  assert.equal(localName(root.name), "header")
  assert.equal(root.attributes.ExecutionStatus, "1")
  assert.equal(root.attributes.xmlns, "mfp:anaf:dgti:spv:respUploadFisier:v1")
  assert.deepEqual(childrenNamed(root, "Errors").map((error) => error.attributes.errorMessage),
    ["Fisierul transmis nu este valid. \"cbc:ID\" lipseste & altele și ș", "second"])
  assert.equal(localName("ns2:header"), "header")
})

void test("keeps text, nesting and a byte-order mark; prefixed names are kept as written", () => {
  const parsed = parseStrictXml(`${String.fromCharCode(0xfeff)}<a:root><b>x &lt; y</b><c/></a:root>`)
  assert.ok(parsed.ok)
  assert.equal(parsed.root.name, "a:root")
  assert.deepEqual(parsed.root.children.map((child) => [child.name, child.text]), [["b", "x < y"], ["c", ""]])
})

void test("a DOCTYPE, an internal subset or an external entity is refused before anything is expanded", () => {
  assert.equal(refusal(`<?xml version="1.0"?><!DOCTYPE header [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><header a="&xxe;"/>`), "doctype")
  assert.equal(refusal(`<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;">]><lolz>&lol2;</lolz>`), "doctype")
  assert.equal(refusal(`<header a="&xxe;"/>`), "entity")
  assert.equal(refusal(`<header>&lol;</header>`), "entity")
  assert.equal(refusal(`<header>a & b</header>`), "entity")
  assert.equal(refusal(`<header a="a&b"/>`), "entity")
  assert.equal(refusal(`<header>&#0;</header>`), "entity")
  assert.equal(refusal(`<header>&#x110000;</header>`), "entity")
})

void test("comments, CDATA and processing instructions are not part of an ANAF answer", () => {
  assert.equal(refusal(`<header><!-- note --></header>`), "declaration")
  assert.equal(refusal(`<header><![CDATA[x]]></header>`), "declaration")
  assert.equal(refusal(`<header><?php echo 1 ?></header>`), "processing_instruction")
  assert.equal(refusal(`<?xml-stylesheet href="x"?><header/>`), "processing_instruction")
})

void test("size, depth, element and attribute counts are bounded", () => {
  const limits: XmlLimits = { maxChars: 200, maxDepth: 3, maxElements: 5, maxAttributes: 2 }
  assert.equal(refusal(`<a>${"x".repeat(200)}</a>`, limits), "too_large")
  assert.equal(refusal("<a><b><c/></b></a>", limits), undefined)
  assert.equal(refusal("<a><b><c><d/></c></b></a>", limits), "too_deep")
  assert.equal(refusal("<a><b/><b/><b/><b/></a>", limits), undefined)
  assert.equal(refusal("<a><b/><b/><b/><b/><b/></a>", limits), "too_many_elements")
  assert.equal(refusal(`<a x="1" y="2" z="3"/>`, limits), "malformed")
  assert.equal(refusal(`<a>${"<b>".repeat(5_000)}`), "too_deep")
})

void test("anything malformed is refused, never repaired", () => {
  for (const source of [
    "", "   ", "text", "<a>", "<a></b>", "<a/><b/>", "<a/>trailing", "lead<a/>", "<a x=1/>", `<a x="1" x="2"/>`, `<a x="1"y="2"/>`,
    `<a x="<"/>`, "<1a/>", "</a>", "<a><b></a></b>", `<?xml version="1.0" encoding="ISO-8859-2"?><a/>`, `<a>${String.fromCharCode(1)}</a>`,
    `<a>${String.fromCharCode(0xffff)}</a>`,
  ]) assert.equal(refusal(source), "malformed", JSON.stringify(source))
})
