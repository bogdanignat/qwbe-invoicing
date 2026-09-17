import { readFileSync } from "node:fs"
import { relative } from "node:path"

import ts from "typescript"

import { discoverCubeUnits, isTestFile, sourceFilesOwnedBy, toPosix } from "./source-tree.mjs"

/**
 * A comment, wherever it sits between two tokens.
 *
 * This expression is only ever run over trivia, which holds nothing but
 * whitespace and comments. None of the constructs a scanner gets wrong — a
 * string, a regular expression, a template literal — can appear there, so
 * matching is unambiguous: at a `//` the first branch wins and eats the line,
 * at a `/*` only the second can match and it stops at the first close.
 */
const COMMENT = /\/\/[^\n\r\u2028\u2029]*|\/\*[\s\S]*?\*\//gu

const isJsDoc = (node) =>
  node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode

/**
 * The comment ranges of a file, read from the trivia the parser left between
 * its tokens rather than from a bare scanner.
 *
 * A standalone scanner cannot lex a template literal on its own: after the
 * first `${...}` it needs to be told to re-scan the closing brace as a template
 * continuation, and without that it reads the rest of the template as ordinary
 * code. Both errors then follow — a `//` inside the template tail is counted as
 * a comment and dropped, and the real comments after it are no longer
 * recognised and are counted as code.
 *
 * `getLeadingCommentRanges` resolves that, but answers a narrower question: it
 * starts collecting at the start of the file or after a line break, so a
 * comment that shares a line with the code before it is never returned and gets
 * counted as code. What the parser does record unconditionally is where every
 * token begins and where the previous one ended. Everything in between is
 * trivia — leading, trailing and the JSDoc a token's start deliberately skips —
 * and scanning those spans finds each comment exactly once, because the spans
 * of distinct tokens cannot overlap.
 */
const commentRanges = (source, fileName) => {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const ranges = []
  const visit = (node) => {
    // A JSDoc node lives inside a comment, so its own tokens would report spans
    // carved out of text that is a comment in full. Its owner's leading trivia
    // already covers it.
    const children = node.getChildren(file).filter((child) => !isJsDoc(child))
    if (children.length > 0) {
      for (const child of children) visit(child)
      return
    }
    const from = node.getFullStart()
    for (const match of source.slice(from, node.getStart(file)).matchAll(COMMENT)) {
      ranges.push({ pos: from + match.index, end: from + match.index + match[0].length })
    }
  }
  visit(file)
  return ranges
}

export const stripCommentsAndBlankLines = (source, fileName = "source.ts") => {
  let result = ""
  let cursor = 0
  for (const range of commentRanges(source, fileName)) {
    result += source.slice(cursor, range.pos)
    cursor = range.end
  }
  result += source.slice(cursor)

  return result.split("\n").filter((line) => line.trim() !== "").join("\n")
}

export const measureFile = (path) => {
  const raw = readFileSync(path, "utf8")
  return { raw: raw.length, code: stripCommentsAndBlankLines(raw, path).length }
}

export const inspectSizes = (root, cubeRoots) => {
  const units = discoverCubeUnits(root, cubeRoots)
  const files = []
  const measuredUnits = units.map((unit) => {
    const owned = sourceFilesOwnedBy(unit, units).filter((path) => !isTestFile(path))
    const measured = owned.map((path) => ({ path: toPosix(relative(root, path)), ...measureFile(path) }))
    files.push(...measured)
    return {
      id: unit.id,
      files: measured.length,
      code: measured.reduce((total, file) => total + file.code, 0),
      raw: measured.reduce((total, file) => total + file.raw, 0),
    }
  })
  return { files: files.sort((left, right) => left.path.localeCompare(right.path)), units: measuredUnits }
}

export const sizeViolations = (measurement, caps) => ({
  files: measurement.files.filter((file) => file.code > caps.maxCharsPerFile),
  units: measurement.units.filter(
    (unit) => unit.code > caps.maxCharsPerUnit || unit.files > caps.maxFilesPerUnit,
  ),
})
