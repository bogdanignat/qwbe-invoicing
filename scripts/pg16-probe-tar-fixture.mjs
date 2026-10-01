// Writes an uncompressed tar holding the member names a restore parser has to
// survive: a space, a newline, a duplicate, a symlink, a traversal and an
// absolute path. Used by scripts/pg16-probe.sh probe (c); it exists to observe
// what the real `tar` in the pinned image does, not to ship anything.
import { Buffer } from "node:buffer"
import { writeFileSync } from "node:fs"

const BLOCK = 512
const pad = (value, length) => Buffer.concat([Buffer.from(value, "utf8"), Buffer.alloc(length)]).subarray(0, length)
const octal = (value, length) => pad(`${value.toString(8).padStart(length - 2, "0")} `, length)

const header = ({ name, size = 0, type = "0", link = "" }) => {
  const fields = Buffer.concat([
    pad(name, 100), octal(0o644, 8), octal(0, 8), octal(0, 8), octal(size, 12), octal(0, 12),
    pad("        ", 8), pad(type, 1), pad(link, 100), pad("ustar\0", 6), pad("00", 2),
    pad("root", 32), pad("root", 32), octal(0, 8), octal(0, 8), pad("", 155), Buffer.alloc(12),
  ])
  let sum = 0
  for (const byte of fields) sum += byte
  fields.set(octal(sum, 8), 148)
  return fields
}

const body = (content) => {
  const data = Buffer.from(content, "utf8")
  return Buffer.concat([data, Buffer.alloc((BLOCK - (data.length % BLOCK)) % BLOCK)])
}

const members = [
  { name: "a b.txt", content: "space in name" },
  { name: "line\nbreak.txt", content: "newline in name" },
  { name: "dup.txt", content: "first" },
  { name: "dup.txt", content: "second" },
  { name: "link", type: "2", link: "/etc/passwd" },
  { name: "hard", type: "1", link: "dup.txt" },
  { name: "../escape.txt", content: "traversal" },
  { name: "/abs.txt", content: "absolute" },
  { name: "sub/./nested.txt", content: "dot segment" },
]

const archive = Buffer.concat([
  ...members.flatMap((member) => [
    header({ name: member.name, size: member.content ? Buffer.byteLength(member.content) : 0, type: member.type, link: member.link }),
    member.content ? body(member.content) : Buffer.alloc(0),
  ]),
  Buffer.alloc(BLOCK * 2),
])

const target = process.argv[2]
if (target === undefined) {
  console.error("usage: node scripts/pg16-probe-tar-fixture.mjs <output.tar>")
  process.exitCode = 2
} else {
  writeFileSync(target, archive)
  console.log(`wrote ${String(members.length)} members to ${target}`)
}
